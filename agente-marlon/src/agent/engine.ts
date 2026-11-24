import { DateTime } from "luxon";
import { config, artigoAgente } from "../config.js";
import { firstName, type Button } from "../channels/messenger.js";
import { hasCallConsent, isWithinContactWindow, nextContactWindow } from "../compliance/rules.js";
import type { Channel, Lead, Message } from "../domain/types.js";
import { emit, type Deps } from "../deps.js";
import { onPedidoLigacao, onRetornoCombinado } from "../queue/cadences.js";
import type { Brain } from "./brain/types.js";
import {
  autoFixOutput,
  checkOutput,
  detectCrisis,
  detectEntryOrigin,
  detectMarlonQuestion,
  detectMinor,
  detectOptout,
  detectRefund,
  detectRobotQuestion,
  mentionsVirtualAssistant,
  norm,
  shortenForVoice,
} from "./guardrails.js";
import { agentIntro, escolherAudio, sendWhatsAppParts, sendWhatsAppText, splitParts } from "./outbound.js";
import { applyOptout, newTurnState, runTool, type ToolContext, type TurnState } from "./tools.js";

export interface TurnResult {
  text: string; // o que foi enviado/falado ("" = nada)
  state: TurnState;
  guard?: "crise" | "menor" | "optout" | "reembolso" | "robo" | "pausada" | "bloqueado" | "fora_do_horario";
  violations: string[];
  hangup?: boolean;
}

export const QUICK_REPLIES: Button[] = [
  { id: "quero_link", title: "Quero o link" },
  { id: "duvida", title: "Tenho uma dúvida" },
  { id: "falar_equipe", title: "Falar com a equipe" },
];

const SAFE_FALLBACK = "Vou confirmar isso com a equipe para não te passar nada errado. Já te retorno por aqui.";

export class Engine {
  constructor(
    public deps: Deps,
    public brain: Brain,
  ) {}

  // ---------------------------------------------------------------- WhatsApp

  /** Entrada de uma mensagem do lead no WhatsApp (texto já transcrito, se era áudio). */
  async handleWhatsApp(input: { from: string; name?: string | null; text: string; replyId?: string; source?: string; transcribed?: boolean; adHeadline?: string; waMessageId?: string }): Promise<TurnResult> {
    const { store } = this.deps;
    let lead = await store.getLeadByPhone(input.from);
    if (!lead) {
      lead = await store.upsertLeadByPhone({ phone: input.from, name: input.name ?? null, source: input.source ?? "whatsapp_inbound" });
      await store.addEvent({ leadId: lead.id, type: "contato", channel: "whatsapp", data: { origem: lead.source } });
    } else if (!lead.name && input.name) {
      lead = await store.updateLead(lead.id, { name: input.name });
    }
    const firstInbound = !(await store.listMessages(lead.id, 200)).some((m) => m.author === "lead");
    lead = await store.updateLead(lead.id, { lastInboundAt: this.deps.now().toISOString() });

    if (firstInbound && input.adHeadline) {
      await store.addMessage({
        leadId: lead.id,
        channel: "whatsapp",
        direction: "out",
        author: "system",
        text: `A pessoa chegou por um anúncio com o título: "${input.adHeadline.slice(0, 120)}". Comece a partir do que o anúncio falou.`,
      });
    }
    // Mensagens prontas das páginas/site: contexto para a IA conduzir a triagem certa.
    const origin = detectEntryOrigin(input.text);
    if (origin) {
      const ORIGIN_NOTES = {
        pagina_leao:
          "A pessoa veio da página do TREINO DO LEÃO (treino para falhas na rigidez). Faça a triagem: é falha na rigidez, rapidez, ou os dois (e o que veio primeiro)? Lembre: o TREINO DO LEÃO ainda não está na base; se for falha na rigidez, transfira para a equipe.",
        suporte_controle2:
          "A pessoa pediu suporte do CONTROLE 2.0. Descubra se já é cliente (acesso, dúvida de aula) ou se ainda está conhecendo. Dúvida sobre exercício ou aula vai para a equipe.",
        consulta_site: "A pessoa veio do site perguntando sobre a consulta online com o Marlon. Explique como funciona e ofereça os horários.",
      } as const;
      await store.addMessage({ leadId: lead.id, channel: "whatsapp", direction: "out", author: "system", text: ORIGIN_NOTES[origin] });
    }
    const text = this.replyToText(input.replyId, input.text);
    await store.addMessage({
      leadId: lead.id,
      channel: "whatsapp",
      direction: "in",
      author: "lead",
      text,
      meta: { ...(input.replyId ? { replyId: input.replyId } : {}), ...(input.transcribed ? { audio: true } : {}) },
    });
    emit(this.deps, { type: "message", leadId: lead.id });
    if (firstInbound) await store.addEvent({ leadId: lead.id, type: "conversa", channel: "whatsapp", data: {} });
    if (lead.stage === "novo") lead = await store.updateLead(lead.id, { stage: "conversa" });

    // Botões com ação determinística
    const special = await this.handleSpecialReply(lead, input.replyId);
    if (special) return special;

    const result = await this.turn(lead, "whatsapp", text, [], undefined, { deferSends: true });
    const semIntro = result.text;
    if (result.text) result.text = await this.withIntro(lead, result.text);
    const introAdicionada = Boolean(semIntro) && result.text !== semIntro;
    const deferred = result.state.deferred;
    result.state.deferred = [];
    const runDeferred = async () => {
      // Links e confirmações das tools ("te mandei o link aqui 👇" e, logo abaixo, o link).
      while (deferred.length) await deferred.shift()!();
    };
    if (result.text) {
      const fresh = (await store.getLead(lead.id))!;
      const escolha = escolherAudio(splitParts(result.text), {
        modo: config.WA_AUDIO_REPLIES,
        leadMandouAudio: Boolean(input.transcribed),
        temVoz: Boolean(this.deps.tts && this.deps.messenger.sendAudio),
        parteComIntro: introAdicionada ? 0 : null,
      });
      const parts = escolha.parts;
      const showSlots = result.state.listedSlots.length && !result.state.toolLog.some((t) => t.name === "agendar_consulta");
      const list = showSlots ? { label: "Ver horários", rows: result.state.listedSlots.slice(0, 6).map((s) => ({ id: `slot:${s.start}`, title: s.label })) } : undefined;
      // O link entra logo depois da mensagem que aponta para ele; se nenhuma apontar, vai no fim.
      const pointer = deferred.length ? parts.findIndex((p) => /👇|aqui embaixo|logo abaixo|te mandei|te mando|segue o link/i.test(p)) : -1;
      const cut = pointer >= 0 ? pointer + 1 : parts.length;
      await sendWhatsAppParts(this.deps, fresh, parts.slice(0, cut), { inboundMessageId: input.waMessageId, list: cut === parts.length ? list : undefined, audioIndex: escolha.audioIndex });
      await runDeferred();
      if (cut < parts.length) await sendWhatsAppParts(this.deps, fresh, parts.slice(cut), { inboundMessageId: input.waMessageId, list, audioIndex: escolha.audioIndex - cut });
    }
    await runDeferred();
    await this.maybeSummarize(lead.id);
    return result;
  }

  /** Identificação obrigatória: a primeira mensagem da IA no WhatsApp diz que é assistente virtual. */
  private async withIntro(lead: Lead, text: string): Promise<string> {
    if (!text || mentionsVirtualAssistant(text)) return text;
    const history = await this.deps.store.listMessages(lead.id, 200);
    if (history.some((m) => m.direction === "out" && m.author !== "system" && mentionsVirtualAssistant(m.text))) return text;
    return `${agentIntro(lead)}\n${text}`;
  }

  private replyToText(replyId: string | undefined, text: string): string {
    if (!replyId) return text;
    if (replyId.startsWith("slot:")) return `Escolho o horário ${text} (${replyId})`;
    return text;
  }

  private async handleSpecialReply(lead: Lead, replyId?: string): Promise<TurnResult | null> {
    if (!replyId) return null;
    const state = newTurnState();
    if (replyId === "falar_equipe") {
      // O próprio pedido é o consentimento explícito para a ligação; guardamos data, origem e texto.
      const consent = { given: true, at: this.deps.now().toISOString(), origin: "pedido_do_lead", text: "Tocou no botão 'Falar com a equipe' no WhatsApp" };
      if (!lead.optOutVoz) {
        await this.deps.store.updateLead(lead.id, { callConsent: consent });
        await this.deps.store.addConsentLog({ leadId: lead.id, kind: "ligacao", granted: true, origin: consent.origin, text: consent.text });
        await onPedidoLigacao(this.deps, (await this.deps.store.getLead(lead.id))!);
      }
      const inWindow = isWithinContactWindow(this.deps.now());
      const text = lead.optOutVoz
        ? "Combinado. Como você pediu para não receber ligações, sigo com você por aqui. Qual é a sua dúvida?"
        : inWindow
          ? "Combinado! Alguém da equipe te liga nos próximos minutos. Se preferir, pode continuar por aqui também."
          : `Combinado! Nosso horário de ligação é das 9h às 20h, de segunda a sábado. Te ligamos ${DateTime.fromJSDate(nextContactWindow(this.deps.now())).setZone(config.TZ_OPERACAO).toFormat("dd/MM 'a partir das' H'h'")}.`;
      const final = await this.withIntro(lead, text);
      await sendWhatsAppText(this.deps, lead, final);
      return { text: final, state, violations: [] };
    }
    const m = replyId.match(/^(confirmo|remarcar):(.+)$/);
    if (m) {
      const appt = await this.deps.store.getAppointment(m[2]);
      if (appt && appt.leadId === lead.id) {
        await this.deps.store.updateAppointment(appt.id, { status: m[1] === "confirmo" ? "confirmada" : "remarcar" });
        if (m[1] === "confirmo") {
          await this.deps.scheduler.cancelForLead(lead.id, (j) => j.type === "confirmacao_por_voz" && j.payload?.appointmentId === appt.id);
          const text = await this.withIntro(lead, "Obrigada por confirmar! Até lá.");
          await sendWhatsAppText(this.deps, lead, text);
          return { text, state, violations: [] };
        }
        // Remarcar: segue para o agente oferecer novos horários.
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- Núcleo

  /** Um turno de conversa em qualquer canal. Não envia nada: devolve o texto final, já verificado. */
  async turn(
    leadIn: Lead,
    channel: Channel,
    text: string,
    extraNotes: string[] = [],
    historyOverride?: Message[],
    opts: { deferSends?: boolean } = {},
  ): Promise<TurnResult> {
    const { store } = this.deps;
    let lead = leadIn;
    const state = newTurnState();
    state.deferSends = Boolean(opts.deferSends);
    const ctx: ToolContext = { deps: this.deps, lead, channel, state };
    const done = (t: string, guard?: TurnResult["guard"], hangup = false): TurnResult => ({ text: t, state, guard, violations: [], hangup });

    if (lead.blockedMinor) return done("", "bloqueado");
    if (lead.aiPaused) return done("", "pausada");

    // 1) Risco: acolher, indicar o CVV e transferir com urgência alta.
    if (detectCrisis(text)) {
      await runTool("transferir_humano", { motivo: "sinais de sofrimento intenso ou risco", urgencia: "alta" }, ctx);
      const t =
        channel === "voz"
          ? "Sinto muito que você esteja passando por isso. Você não está sozinho. Se estiver em risco agora, ligue 188, o CVV, que atende 24 horas. Vou pedir para alguém da equipe falar com você."
          : "Sinto muito que você esteja passando por isso. Você não está sozinho.\nSe estiver em risco agora, ligue para o CVV no 188 (24h, gratuito) ou procure o pronto-socorro mais próximo.\nJá chamei alguém da equipe para falar com você.";
      return done(t, "crise");
    }

    // 2) Menor de idade: encerra com educação, sem oferecer nada.
    if (detectMinor(text)) {
      await store.updateLead(lead.id, { blockedMinor: true, stage: "encerrado" });
      await this.deps.scheduler.cancelForLead(lead.id);
      emit(this.deps, { type: "lead", leadId: lead.id });
      const t = "Obrigada por me contar. Nosso atendimento é só para maiores de 18 anos, então não posso seguir com você por aqui. Se precisar de apoio, converse com um adulto de confiança. Cuide-se!";
      return done(t, "menor", true);
    }

    // 3) Opt-out: na hora, sem tentar de novo.
    const optout = detectOptout(text, channel);
    if (optout) {
      await applyOptout(this.deps, lead, optout, channel);
      state.optedOut = true;
      const t =
        optout === "voz"
          ? "Combinado, obrigada por avisar. Não vamos mais te ligar."
          : "Tudo bem, obrigada por avisar. Não vamos mais entrar em contato. Se um dia quiser, é só mandar mensagem.";
      return done(t, "optout", channel === "voz");
    }

    // 4) Reembolso: direto para um humano, sem dificultar.
    if (detectRefund(text)) {
      await runTool("transferir_humano", { motivo: "pedido de reembolso", urgencia: "media" }, ctx);
      await store.addEvent({ leadId: lead.id, type: "reembolso", channel, data: { origem: "pedido_na_conversa" } });
      const t = "Claro. Já passei para a equipe cuidar do seu reembolso, sem complicação. Eles te respondem por aqui.";
      return done(t, "reembolso");
    }

    // 5a) "É o Marlon? É o doutor?": sempre a verdade.
    if (detectMarlonQuestion(text) && norm(text).split(" ").length <= 14) {
      const t =
        channel === "voz"
          ? `Aqui é ${artigoAgente} ${config.AGENT_NAME}, assistente virtual da equipe do Marlon Mattedi. O Marlon atende nas consultas. Se preferir, alguém da equipe fala com você.`
          : `Aqui é ${artigoAgente} ${config.AGENT_NAME}, assistente virtual da equipe do Marlon Mattedi. Não sou o Marlon: ele atende nas consultas.|||Eu te ajudo por aqui com o que precisar. Se preferir falar com uma pessoa da equipe, é só me dizer.`;
      return done(t, "robo");
    }

    // 5) "É robô?": sempre a verdade.
    if (detectRobotQuestion(text) && norm(text).split(" ").length <= 12) {
      const t =
        channel === "voz"
          ? `Sou sim. Sou ${artigoAgente} ${config.AGENT_NAME}, assistente virtual da equipe do Marlon Mattedi. Se preferir, uma pessoa da equipe fala com você.`
          : `Sou sim: sou ${artigoAgente} ${config.AGENT_NAME}, assistente virtual (uma inteligência artificial) da equipe do Marlon Mattedi.\nSe preferir falar com uma pessoa da equipe, é só me dizer.`;
      return done(t, "robo");
    }

    // 6) Fora do horário (opcional): só responde na próxima janela.
    if (channel === "whatsapp" && !config.RESPONDER_FORA_DO_HORARIO && !isWithinContactWindow(this.deps.now())) {
      await onRetornoCombinado(this.deps, lead, nextContactWindow(this.deps.now()), "whatsapp", "mensagem recebida fora do horário");
      return done("", "fora_do_horario");
    }

    // 7) Modelo
    const history = historyOverride ?? (await store.listMessages(lead.id, 40));
    const notes = [...this.leadNotes(lead, channel, history), ...extraNotes];
    let out = await this.safeRespond({ lead, channel, history, notes, toolCtx: ctx });
    lead = ctx.lead;

    // Se a IA transferiu, a conversa fica com o humano daqui pra frente.
    let final = out.text;
    let violations = out.violations;
    if (!final && !state.transferred) final = state.sentLinks.length ? "Te mandei aqui 👇" : SAFE_FALLBACK;

    if (channel === "voz") final = shortenForVoice(final.replace(/\[\[audio\]\]\s*/gi, "").replace(/\s*\|\|\|\s*/g, " "));
    out = { text: final, violations };
    return { text: out.text, state, violations, hangup: state.optedOut || state.endConversation };
  }

  /** Chama o modelo, verifica a saída e tenta de novo uma vez se houver violação. */
  private async safeRespond(input: Parameters<Brain["respond"]>[0]): Promise<{ text: string; violations: string[] }> {
    let r;
    try {
      r = await this.brain.respond(input);
    } catch (e) {
      console.error("[engine] erro no modelo:", (e as Error).message);
      await runTool("transferir_humano", { motivo: "falha técnica do agente", urgencia: "media" }, input.toolCtx).catch(() => undefined);
      return { text: "Tive um problema técnico aqui. Já chamei alguém da equipe para continuar com você.", violations: ["erro_modelo"] };
    }
    if (r.refused) {
      await runTool("transferir_humano", { motivo: "assunto precisa de atendimento humano", urgencia: "media" }, input.toolCtx);
      return { text: "Esse ponto é melhor alguém da equipe te responder. Já chamei uma pessoa para continuar com você.", violations: ["recusa"] };
    }
    let text = autoFixOutput(r.text, input.channel);
    let v = checkParts(text, input.channel);
    if (v.length && this.brain.name === "claude" && !input.toolCtx.state.transferred) {
      const retryNotes = [
        ...input.notes,
        `ATENÇÃO: sua resposta anterior foi bloqueada por violar as regras (${v.map((x) => `${x.rule}: "${x.excerpt}"`).join("; ")}). Reescreva a resposta sem isso. Não chame ferramentas que já foram chamadas.`,
      ];
      const r2 = await this.brain.respond({ ...input, notes: retryNotes });
      text = autoFixOutput(r2.text, input.channel);
      v = checkParts(text, input.channel);
    }
    if (v.length) {
      console.warn("[engine] resposta bloqueada:", v);
      return { text: input.toolCtx.state.transferred ? "" : SAFE_FALLBACK, violations: v.map((x) => x.rule) };
    }
    return { text, violations: [] };
  }

  /** Contexto do lead para o modelo (mensagem de sistema do turno). */
  leadNotes(lead: Lead, channel: Channel, history: Message[]): string[] {
    const agora = DateTime.fromJSDate(this.deps.now()).setZone(config.TZ_OPERACAO);
    const contexts = history.filter((m) => m.author === "system").slice(-3).map((m) => `- ${m.text}`);
    const introduced = history.some((m) => m.direction === "out" && mentionsVirtualAssistant(m.text));
    return [
      "# Contexto do lead (não repita estes dados para a pessoa)",
      `- Nome: ${lead.name ?? "não informado"}; telefone: ${lead.phone}; canal: ${channel}`,
      `- Etapa do funil: ${lead.stage}; compras: ${lead.purchases.length ? lead.purchases.join(", ") : "nenhuma"}`,
      `- Consentimento de ligação: ${hasCallConsent(lead) ? `sim (${lead.callConsent!.origin})` : "não"}; opt-out WhatsApp: ${lead.optOutWhatsapp ? "sim" : "não"}; opt-out voz: ${lead.optOutVoz ? "sim" : "não"}`,
      `- Já se apresentou como assistente virtual nesta conversa: ${introduced ? "sim" : "não (apresente-se agora)"}`,
      `- Agora: ${agora.toFormat("cccc, dd/MM/yyyy HH:mm", { locale: "pt-BR" })} (Brasília)`,
      lead.summary ? `- Resumo das conversas anteriores: ${lead.summary}` : "- Primeira conversa com este lead.",
      ...(contexts.length ? ["- Contexto dos contatos automáticos recentes:", ...contexts] : []),
    ];
  }

  private async maybeSummarize(leadId: string) {
    const msgs = await this.deps.store.listMessages(leadId, 12);
    const inbound = msgs.filter((m) => m.author === "lead").length;
    if (inbound === 0 || inbound % 6 !== 0) return;
    const lead = (await this.deps.store.getLead(leadId))!;
    try {
      const summary = await this.brain.summarize(msgs.map((m) => `${m.author}: ${m.text}`), lead.summary);
      await this.deps.store.updateLead(leadId, { summary });
    } catch (e) {
      console.warn("[engine] resumo falhou:", (e as Error).message);
    }
  }

  // ---------------------------------------------------------------- Voz

  voiceOpener(session: VoiceSession, lead: Lead): string {
    const rec = session.recorded ? " Esta ligação pode ser gravada para garantir a qualidade do atendimento." : "";
    const a = config.AGENT_NAME;
    const sauda = saudacao(this.deps.now());
    if (session.direction === "inbound") {
      session.phase = "aberta";
      return pick([
        `${sauda}! Aqui é ${artigoAgente} ${a}, assistente virtual da equipe do Marlon Mattedi.${rec} Em que eu posso te ajudar?`,
        `Oi, ${sauda.toLowerCase()}! Você tá falando com ${artigoAgente} ${a}, assistente virtual da equipe do Marlon Mattedi.${rec} Me conta, como posso te ajudar?`,
      ]);
    }
    session.phase = "identidade";
    const nome = lead.name ? `${artigo(lead)} ${firstName(lead)}` : "o titular deste número";
    return pick([
      `Oi, ${sauda.toLowerCase()}! Aqui é ${artigoAgente} ${a}, assistente virtual da equipe do Marlon Mattedi.${rec} Eu falo com ${nome}?`,
      `Alô, oi! Tudo bem? É ${artigoAgente} ${a}, assistente virtual da equipe do Marlon Mattedi.${rec} Falo com ${nome}?`,
      `${sauda}! Quem fala é ${artigoAgente} ${a}, sou assistente virtual da equipe do Marlon Mattedi.${rec} Falo com ${nome}?`,
    ]);
  }

  /** Um turno de voz, com o portão de discrição antes de qualquer menção ao assunto. */
  async handleVoiceTurn(session: VoiceSession, heard: string): Promise<{ say: string; hangup: boolean; state?: TurnState; guard?: TurnResult["guard"] }> {
    const { store } = this.deps;
    const lead = (await store.getLead(session.leadId))!;
    session.transcript.push(`lead: ${heard}`);
    const t = norm(heard);
    const say = (s: string, hangup = false, r?: TurnResult) => {
      session.transcript.push(`ia: ${s}`);
      if (hangup) session.phase = "encerrada";
      return { say: s, hangup, state: r?.state, guard: r?.guard };
    };

    // Opt-out e risco valem em qualquer fase.
    if (detectOptout(heard, "voz") || detectCrisis(heard) || detectMinor(heard)) {
      const r = await this.turn(lead, "voz", heard, [], transcriptToHistory(session, lead.id));
      return say(r.text, r.guard !== "crise", r);
    }

    if (session.phase === "identidade") {
      if (/\b(quem (e|fala|quer falar)|do que se trata|qual o assunto|de onde)\b/.test(t)) {
        const quem = lead.name ? `${artigo(lead)} ${firstName(lead)}` : "o titular deste número";
        return say(pick([`É da equipe do Marlon Mattedi. Eu falo com ${quem}?`, `Aqui é da equipe do Marlon Mattedi, tá? Falo com ${quem}?`, `Da equipe do Marlon Mattedi. Por favor, falo com ${quem}?`]));
      }
      const isNo = /\b(nao|engano|errado|nao e ele|nao esta|saiu|ele nao|ela nao|sou a (esposa|mulher|mae|namorada|filha)|sou o (pai|filho|irmao)|e a esposa|e o filho|nao conheco)\b/.test(t);
      const isYes = /\b(sim|sou eu|e ele|e o proprio|eu mesmo|falando|pois nao|isso|pode falar|ele mesmo|sou|e eu)\b/.test(t);
      if (isYes && !isNo) {
        session.phase = "privacidade";
        await store.updateLead(lead.id, { identityConfirmed: true });
        return say(
          pick([
            "Que bom! É um bom momento pra gente conversar com privacidade? Ah, e se preferir não receber ligações, é só me dizer.",
            "Ah, que bom falar com você! Você consegue conversar agora, com privacidade? Se preferir não receber ligações, me fala, tá?",
            "Oi! Antes de tudo: é um bom momento pra falar com privacidade? E se preferir não receber ligações, é só dizer.",
          ]),
        );
      }
      // "Alô?", "Oi", "hã?", silêncio: pergunta de novo uma vez, sem citar o assunto.
      if (!isNo && (session.identityTries ?? 0) < 1) {
        session.identityTries = (session.identityTries ?? 0) + 1;
        const quem = lead.name ? `${artigo(lead)} ${firstName(lead)}` : "o titular deste número";
        return say(
          pick([
            `Oi! Aqui é ${artigoAgente} ${config.AGENT_NAME}, da equipe do Marlon Mattedi. Eu falo com ${quem}?`,
            `Opa, oi! É ${artigoAgente} ${config.AGENT_NAME}, da equipe do Marlon Mattedi. Falo com ${quem}?`,
            `Oi, tá me ouvindo? Aqui é ${artigoAgente} ${config.AGENT_NAME}, da equipe do Marlon Mattedi. Falo com ${quem}?`,
          ]),
        );
      }
      // Outra pessoa atendeu (ou não deu para confirmar): nunca citar o assunto.
      if (isNo && session.callId) await store.updateCall(session.callId, { status: "outra_pessoa" });
      return say(
        pick([
          "Tudo bem, é da equipe do Marlon. Eu retorno depois. Obrigada!",
          "Ah, sem problema! É da equipe do Marlon. Eu retorno depois. Obrigada!",
          "Tá bom! Aqui é da equipe do Marlon. Eu retorno depois. Obrigada!",
        ]),
        true,
      );
    }

    if (session.phase === "privacidade") {
      const clearNo =
        /\b(agora nao|nao posso|nao da|nao e um bom|ocupado|ocupada|dirigindo|trabalhando|no trabalho|em reuniao|acompanhado|acompanhada|nao estou sozinho|depois|mais tarde|outra hora|me liga depois)\b/.test(t);
      const clearYes =
        /\b(pode( falar)?|sim|claro|tranquilo|tudo bem|nao tem problema|sem problema|estou sozinho|to sozinho|sozinho|manda|fala|pode ser|e sim|posso falar|posso sim)\b/.test(t);
      const isNo = clearNo || (!clearYes && /\bnao\b/.test(t));
      if (isNo) {
        session.phase = "aberta";
        return say(
          pick([
            "Imagina, sem problema! Posso te mandar a informação pelo WhatsApp, ou te ligo num outro horário. O que fica melhor?",
            "Tranquilo! Prefere que eu te mande pelo WhatsApp, ou te ligo em outro horário?",
            "Claro, sem pressa. Te mando pelo WhatsApp, ou prefere que eu ligue em outro horário?",
          ]),
        );
      }
      session.phase = "aberta";
      const r = await this.turn(lead, "voz", heard, [
        `A pessoa confirmou que é ela e que pode falar com privacidade. Motivo da ligação: ${session.reason}. Diga brevemente, com suas palavras, por que ligou e comece a descoberta com uma pergunta aberta. Soe como uma pessoa ao telefone, não como um roteiro.`,
      ], transcriptToHistory(session, lead.id));
      return say(r.text || "Me conta, como posso te ajudar?", Boolean(r.hangup), r);
    }

    const r = await this.turn(lead, "voz", heard, session.extraNotes, transcriptToHistory(session, lead.id));
    return say(r.text, Boolean(r.hangup) || r.guard === "menor", r);
  }

  /** Encerramento da ligação: guarda só o resumo (LGPD) e descarta a transcrição. */
  async endVoiceSession(session: VoiceSession, durationSec?: number) {
    const lead = await this.deps.store.getLead(session.leadId);
    if (!lead) return;
    let summary = "";
    try {
      summary = session.transcript.length > 1 ? await this.brain.summarize(session.transcript, "") : "Sem conversa.";
    } catch {
      summary = "Resumo indisponível.";
    }
    if (session.callId) {
      const status = session.phase === "identidade" ? "nao_atendida" : undefined;
      const call = await this.deps.store.getCallByProviderId(session.providerCallId ?? "").catch(() => null);
      const id = call?.id ?? session.callId;
      await this.deps.store.updateCall(id, { summary, endedAt: this.deps.now().toISOString(), durationSec: durationSec ?? null, ...(status ? { status } : {}) });
      if (session.transcript.length > 2) await this.deps.store.addEvent({ leadId: lead.id, type: "ligacao_atendida", channel: "voz", data: { durationSec: durationSec ?? null } });
      emit(this.deps, { type: "call", leadId: lead.id, callId: id });
    }
    await this.deps.store.updateLead(lead.id, { summary: [lead.summary, `Ligação: ${summary}`].filter(Boolean).join(" | ").slice(-1500) });
    session.transcript = [];
  }
}

export interface VoiceSession {
  callId: string | null;
  providerCallId?: string | null;
  leadId: string;
  direction: "inbound" | "outbound";
  reason: string;
  recorded: boolean;
  phase: "identidade" | "privacidade" | "aberta" | "encerrada";
  identityTries?: number;
  transcript: string[]; // só em memória, durante a ligação
  extraNotes: string[];
}

/** Verifica cada mensagem curta (|||) separadamente. */
function checkParts(text: string, channel: Channel) {
  return text.split(/\|\|\|/).flatMap((p) => checkOutput(p, channel));
}

/** Histórico da ligação atual (só memória) no formato de mensagens. */
function transcriptToHistory(session: VoiceSession, leadId: string): Message[] {
  return session.transcript.map((line, i) => {
    const isLead = line.startsWith("lead: ");
    return {
      id: `t${i}`,
      leadId,
      channel: "voz",
      direction: isLead ? "in" : "out",
      author: isLead ? "lead" : "ai",
      text: line.replace(/^(lead|ia): /, ""),
      createdAt: new Date().toISOString(),
    } satisfies Message;
  });
}

/** Escolhe uma variação (evita falas idênticas em toda ligação). */
function pick<T>(opts: T[]): T {
  return opts[Math.floor(Math.random() * opts.length)];
}

function saudacao(now: Date) {
  const h = Number(DateTime.fromJSDate(now).setZone(config.TZ_OPERACAO).toFormat("H"));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function artigo(_lead: Lead) {
  return "o"; // público do produto; ajuste aqui se necessário
}
