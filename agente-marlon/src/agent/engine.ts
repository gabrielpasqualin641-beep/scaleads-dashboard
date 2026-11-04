import { DateTime } from "luxon";
import { config } from "../config.js";
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
  detectMinor,
  detectOptout,
  detectRefund,
  detectRobotQuestion,
  mentionsVirtualAssistant,
  norm,
  shortenForVoice,
} from "./guardrails.js";
import { agentIntro, sendWhatsAppText } from "./outbound.js";
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
  async handleWhatsApp(input: { from: string; name?: string | null; text: string; replyId?: string; source?: string; transcribed?: boolean }): Promise<TurnResult> {
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

    const result = await this.turn(lead, "whatsapp", text);
    if (result.text) result.text = await this.withIntro(lead, result.text);
    if (result.text) {
      const fresh = (await store.getLead(lead.id))!;
      const offeredLink = /posso te mandar o link|quer que eu (te )?mande o link|quer o link/.test(norm(result.text));
      if (result.state.listedSlots.length && !result.state.toolLog.some((t) => t.name === "agendar_consulta")) {
        await sendWhatsAppText(this.deps, fresh, result.text, {
          list: { label: "Ver horários", rows: result.state.listedSlots.slice(0, 6).map((s) => ({ id: `slot:${s.start}`, title: s.label })) },
        });
      } else if (offeredLink && !result.guard) {
        await sendWhatsAppText(this.deps, fresh, result.text, { buttons: QUICK_REPLIES });
      } else {
        await sendWhatsAppText(this.deps, fresh, result.text);
      }
    }
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
  async turn(leadIn: Lead, channel: Channel, text: string, extraNotes: string[] = [], historyOverride?: Message[]): Promise<TurnResult> {
    const { store } = this.deps;
    let lead = leadIn;
    const state = newTurnState();
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

    // 5) "É robô?": sempre a verdade.
    if (detectRobotQuestion(text) && norm(text).split(" ").length <= 12) {
      const t =
        channel === "voz"
          ? `Sou sim. Sou a ${config.AGENT_NAME}, assistente virtual da equipe do Marlon Mattedi. Se preferir, uma pessoa da equipe fala com você.`
          : `Sou sim: sou a ${config.AGENT_NAME}, assistente virtual (uma inteligência artificial) da equipe do Marlon Mattedi.\nSe preferir falar com uma pessoa da equipe, é só me dizer.`;
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
    if (!final && !state.transferred) final = SAFE_FALLBACK;

    if (channel === "voz") final = shortenForVoice(final);
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
    let v = checkOutput(text, input.channel);
    if (v.length && this.brain.name === "claude" && !input.toolCtx.state.transferred) {
      const retryNotes = [
        ...input.notes,
        `ATENÇÃO: sua resposta anterior foi bloqueada por violar as regras (${v.map((x) => `${x.rule}: "${x.excerpt}"`).join("; ")}). Reescreva a resposta sem isso. Não chame ferramentas que já foram chamadas.`,
      ];
      const r2 = await this.brain.respond({ ...input, notes: retryNotes });
      text = autoFixOutput(r2.text, input.channel);
      v = checkOutput(text, input.channel);
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
    if (session.direction === "inbound") {
      session.phase = "aberta";
      return `Oi! Aqui é a ${config.AGENT_NAME}, assistente virtual da equipe do Marlon Mattedi.${rec} Como posso te ajudar?`;
    }
    session.phase = "identidade";
    const quem = lead.name ? `Eu falo com ${artigo(lead)} ${firstName(lead)}?` : "Eu falo com o titular deste número?";
    return `Oi, tudo bem? Aqui é a ${config.AGENT_NAME}, assistente virtual da equipe do Marlon Mattedi.${rec} ${quem}`;
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
        return say(`É da equipe do Marlon Mattedi. Eu falo com ${lead.name ? `${artigo(lead)} ${firstName(lead)}` : "o titular deste número"}?`);
      }
      const isNo = /\b(nao|engano|errado|nao e ele|nao esta|saiu|ele nao|ela nao|sou a (esposa|mulher|mae|namorada|filha)|sou o (pai|filho|irmao)|e a esposa|e o filho|nao conheco)\b/.test(t);
      const isYes = /\b(sim|sou eu|e ele|e o proprio|eu mesmo|falando|pois nao|isso|pode falar|ele mesmo|sou|e eu)\b/.test(t);
      if (isYes && !isNo) {
        session.phase = "privacidade";
        await store.updateLead(lead.id, { identityConfirmed: true });
        return say("Que bom. É um bom momento para a gente conversar com privacidade? Se preferir não receber ligações, é só me dizer.");
      }
      // Outra pessoa atendeu: nunca citar o assunto.
      if (session.callId) await store.updateCall(session.callId, { status: "outra_pessoa" });
      return say("Tudo bem, é da equipe do Marlon. Eu retorno depois. Obrigada!", true);
    }

    if (session.phase === "privacidade") {
      const isNo = /\b(nao|agora nao|ocupado|dirigindo|trabalhando|depois|mais tarde|nao posso)\b/.test(t);
      if (isNo) {
        session.phase = "aberta";
        return say("Sem problema. Posso te mandar a informação pelo WhatsApp, ou te ligar em outro horário. O que prefere?");
      }
      session.phase = "aberta";
      const r = await this.turn(lead, "voz", heard, [
        `A pessoa confirmou que é ela e que pode falar com privacidade. Motivo da ligação: ${session.reason}. Diga brevemente por que ligou e comece a descoberta com uma pergunta.`,
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
  transcript: string[]; // só em memória, durante a ligação
  extraNotes: string[];
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

function artigo(_lead: Lead) {
  return "o"; // público do produto; ajuste aqui se necessário
}
