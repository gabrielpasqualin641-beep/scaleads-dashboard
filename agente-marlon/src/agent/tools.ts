import type Anthropic from "@anthropic-ai/sdk";
import { DateTime } from "luxon";
import { config } from "../config.js";
import { hasCallConsent } from "../compliance/rules.js";
import type { Channel, FunnelStage, Lead } from "../domain/types.js";
import { FUNNEL_STAGES } from "../domain/types.js";
import { emit, type Deps } from "../deps.js";
import { slotLabel, type Slot } from "../integrations/calendar.js";
import { onConsultaAgendada, onLinkEnviado, onRetornoCombinado } from "../queue/cadences.js";
import { buildCheckoutUrl, withTracking } from "./links.js";
import { loadProducts } from "./knowledge.js";
import { mentionsVirtualAssistant } from "./guardrails.js";
import { agentIntro, contactLabel, notifyTeam, sendWhatsAppSmart } from "./outbound.js";

export interface TurnState {
  sentLinks: string[];
  listedSlots: Slot[];
  transferred: boolean;
  optedOut: boolean;
  endConversation: boolean;
  toolLog: Array<{ name: string; input: unknown; result: unknown }>;
}

export function newTurnState(): TurnState {
  return { sentLinks: [], listedSlots: [], transferred: false, optedOut: false, endConversation: false, toolLog: [] };
}

export interface ToolContext {
  deps: Deps;
  lead: Lead;
  channel: Channel;
  state: TurnState;
}

const OBJECOES = ["preco", "funciona_pra_mim", "sigilo", "remedio", "vergonha", "tempo", "vou_pensar", "confianca", "outro"] as const;

export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "buscar_lead",
    description: "Busca o histórico do lead atual: resumo, produtos comprados, etapa do funil e consentimentos. Use quando precisar confirmar compras ou consentimentos.",
    strict: true,
    input_schema: { type: "object", properties: { telefone: { type: "string", description: "Telefone do lead (E.164 sem +)." } }, required: ["telefone"], additionalProperties: false },
  },
  {
    name: "enviar_link_checkout",
    description:
      "Monta o link de checkout com rastreamento (sck=f4-ia + UTMs) e envia pelo WhatsApp do lead. Use SEMPRE que for mandar link de compra; nunca escreva o link no texto. Só use depois que a pessoa aceitar receber o link.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        produto: { type: "string", enum: ["controle_express", "controle_2"], description: "controle_express (R$47) ou controle_2 (CONTROLE 2.0, R$397 ou 12x R$33,08)." },
        telefone: { type: "string" },
      },
      required: ["produto", "telefone"],
      additionalProperties: false,
    },
  },
  {
    name: "listar_horarios",
    description: "Lista horários livres para consulta online com o Marlon (R$900, 50 min) nos próximos N dias. Ofereça no máximo 3 opções.",
    strict: true,
    input_schema: { type: "object", properties: { dias: { type: "integer", description: "Quantos dias à frente (1 a 14)." } }, required: ["dias"], additionalProperties: false },
  },
  {
    name: "agendar_consulta",
    description: "Agenda a consulta no horário escolhido pela pessoa (ISO retornado por listar_horarios), gera o link de pagamento e envia a confirmação. Só chame depois que a pessoa escolher.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { telefone: { type: "string" }, horario: { type: "string", description: "Início do horário, em ISO 8601, exatamente como veio de listar_horarios." } },
      required: ["telefone", "horario"],
      additionalProperties: false,
    },
  },
  {
    name: "agendar_ligacao",
    description:
      "Agenda uma ligação para o lead. Só funciona com consentimento explícito de ligação (o sistema verifica). 'quando' em ISO 8601 ou 'agora'. Respeita 9h-20h, seg-sáb.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { telefone: { type: "string" }, quando: { type: "string" }, motivo: { type: "string" } },
      required: ["telefone", "quando", "motivo"],
      additionalProperties: false,
    },
  },
  {
    name: "agendar_retorno_whatsapp",
    description: "Agenda um retorno pelo WhatsApp quando a pessoa aceitar ('posso te chamar amanhã?'). 'quando' em ISO 8601.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { telefone: { type: "string" }, quando: { type: "string" }, motivo: { type: "string" } },
      required: ["telefone", "quando", "motivo"],
      additionalProperties: false,
    },
  },
  {
    name: "transferir_humano",
    description:
      "Passa a conversa para a equipe humana e pausa a IA neste contato. Use para: sofrimento ou risco (urgencia alta), reembolso, reclamação, pergunta clínica, pedido de falar com o Marlon, pergunta fora da base.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { telefone: { type: "string" }, motivo: { type: "string" }, urgencia: { type: "string", enum: ["baixa", "media", "alta"] } },
      required: ["telefone", "motivo", "urgencia"],
      additionalProperties: false,
    },
  },
  {
    name: "registrar_objecao",
    description: "Registra a objeção que a pessoa levantou (alimenta o painel).",
    strict: true,
    input_schema: {
      type: "object",
      properties: { telefone: { type: "string" }, tipo: { type: "string", enum: [...OBJECOES] } },
      required: ["telefone", "tipo"],
      additionalProperties: false,
    },
  },
  {
    name: "atualizar_etapa",
    description: "Atualiza a etapa do funil do lead.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { telefone: { type: "string" }, etapa: { type: "string", enum: FUNNEL_STAGES } },
      required: ["telefone", "etapa"],
      additionalProperties: false,
    },
  },
  {
    name: "optout",
    description: "A pessoa pediu para parar. Bloqueia o canal na hora e cancela todas as cadências.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { telefone: { type: "string" }, canal: { type: "string", enum: ["whatsapp", "voz", "todos"] } },
      required: ["telefone", "canal"],
      additionalProperties: false,
    },
  },
];

type Input = Record<string, unknown>;

/** Executa uma tool. As tools agem SEMPRE sobre o lead da conversa atual (o telefone informado é ignorado por segurança). */
export async function runTool(name: string, input: Input, ctx: ToolContext): Promise<unknown> {
  const { deps } = ctx;
  const lead = () => ctx.lead;
  const refresh = async () => {
    ctx.lead = (await deps.store.getLead(ctx.lead.id))!;
  };
  let result: unknown;

  switch (name) {
    case "buscar_lead": {
      const l = lead();
      const appts = await deps.store.listAppointments({ leadId: l.id });
      result = {
        nome: l.name,
        etapa: l.stage,
        compras: l.purchases,
        resumo: l.summary,
        consentimento_ligacao: hasCallConsent(l),
        optout_whatsapp: l.optOutWhatsapp,
        optout_voz: l.optOutVoz,
        consultas: appts.map((a) => ({ inicio: slotLabel(a.start), status: a.status })),
      };
      break;
    }

    case "enviar_link_checkout": {
      const produto = input.produto as "controle_express" | "controle_2";
      if (produto !== "controle_express" && produto !== "controle_2") throw new Error("produto inválido");
      const l = lead();
      if (l.optOutWhatsapp) {
        result = { ok: false, erro: "a pessoa pediu para não receber WhatsApp; não envie o link" };
        break;
      }
      // Evita mandar o mesmo link duas vezes em poucos minutos.
      const since = new Date(deps.now().getTime() - 15 * 60_000).toISOString();
      const recent = await deps.store.listEvents({ leadId: l.id, type: "link_enviado", since });
      if (recent.some((e) => e.data.produto === produto)) {
        result = { ok: true, ja_enviado: true, observacao: "este link já foi enviado há poucos minutos; avise que está logo acima na conversa e pergunte se ficou alguma dúvida" };
        break;
      }
      const url = buildCheckoutUrl(produto, ctx.channel);
      const info = loadProducts()[produto];
      const history = await deps.store.listMessages(l.id, 200);
      const introduced = history.some((m) => m.direction === "out" && m.author !== "system" && mentionsVirtualAssistant(m.text));
      const linkText =
        produto === "controle_2"
          ? `Aqui está o link do Treino CONTROLE 2.0 (12x de R$33,08 sem juros ou R$397 à vista, com garantia de 7 dias):\n${url}`
          : `Aqui está o link do Controle Express (R$47, acesso imediato, garantia de 7 dias):\n${url}`;
      // Identificação obrigatória: quem chega pedindo o link não pode receber o link como primeira mensagem sem apresentação.
      const text = introduced ? linkText : `${agentIntro(l)}\n${linkText}`;
      await sendWhatsAppSmart(deps, l, text, { name: "link_solicitado", params: [l.name?.split(" ")[0] ?? "tudo bem", url] });
      await deps.store.addEvent({ leadId: l.id, type: "link_enviado", channel: ctx.channel, data: { produto, url } });
      await deps.store.updateLead(l.id, { stage: "link_enviado" });
      await onLinkEnviado(deps, l, produto);
      ctx.state.sentLinks.push(url);
      await refresh();
      result = { ok: true, enviado_por: "whatsapp", produto: info.name, link: url };
      break;
    }

    case "listar_horarios": {
      const dias = Math.min(14, Math.max(1, Number(input.dias) || 7));
      const slots = (await deps.calendar.listFreeSlots(dias, deps.now())).slice(0, 6);
      ctx.state.listedSlots = slots;
      result = { horarios: slots.map((s) => ({ inicio: s.start, rotulo: s.label })), preco: "R$900 por sessão de 50 min", reembolso: "sessões não são reembolsáveis" };
      break;
    }

    case "agendar_consulta": {
      const l = lead();
      const start = DateTime.fromISO(String(input.horario));
      if (!start.isValid) throw new Error("horário inválido");
      const free = await deps.calendar.listFreeSlots(14, deps.now());
      const slot = free.find((s) => DateTime.fromISO(s.start).toMillis() === start.toMillis());
      if (!slot) {
        result = { ok: false, erro: "horário não está mais livre; chame listar_horarios de novo" };
        break;
      }
      const ev = await deps.calendar.createEvent({ start: slot.start, end: slot.end, summary: `Consulta online - ${l.name?.split(" ")[0] ?? "cliente"}`, attendeeEmail: l.email });
      const appt = await deps.store.addAppointment({ leadId: l.id, start: slot.start, end: slot.end, calendarEventId: ev.id, paymentLink: null, status: "agendada" });
      const rawLink = await deps.payments.createConsultaLink({ appointmentId: appt.id, leadName: l.name, email: l.email });
      const payLink = withTracking(rawLink, ctx.channel);
      await deps.store.updateAppointment(appt.id, { paymentLink: payLink });
      await sendWhatsAppSmart(
        deps,
        l,
        `Consulta online com o Marlon reservada para ${slot.label} (50 min).\nPagamento (R$900): ${payLink}\nLembrando: sessões não são reembolsáveis. Eu te lembro um dia antes e duas horas antes.`,
        { name: "link_solicitado", params: [l.name?.split(" ")[0] ?? "tudo bem", payLink] },
      );
      await deps.store.addEvent({ leadId: l.id, type: "consulta_agendada", channel: ctx.channel, data: { appointmentId: appt.id, start: slot.start } });
      await deps.store.addEvent({ leadId: l.id, type: "link_enviado", channel: ctx.channel, data: { produto: "consulta", url: payLink } });
      await deps.store.updateLead(l.id, { stage: "consulta_agendada" });
      await onConsultaAgendada(deps, l, { ...appt, paymentLink: payLink });
      ctx.state.sentLinks.push(payLink);
      await refresh();
      result = { ok: true, horario: slot.label, link_pagamento_enviado: true };
      break;
    }

    case "agendar_ligacao": {
      const l = lead();
      if (!hasCallConsent(l)) {
        result = { ok: false, erro: "sem consentimento explícito de ligação. Pergunte se a pessoa aceita receber uma ligação antes." };
        break;
      }
      if (l.optOutVoz) {
        result = { ok: false, erro: "a pessoa pediu para não receber ligações" };
        break;
      }
      const when = String(input.quando) === "agora" ? new Date(deps.now().getTime() + 5 * 60_000) : new Date(String(input.quando));
      if (Number.isNaN(when.getTime())) throw new Error("data inválida");
      await onRetornoCombinado(deps, l, when, "voz", String(input.motivo));
      const call = await deps.store.addCall({
        leadId: l.id, direction: "outbound", provider: deps.dialer?.name ?? "nenhum", providerCallId: null, reason: String(input.motivo),
        status: "agendada", recorded: false, summary: null, durationSec: null, scheduledFor: when.toISOString(), startedAt: null, endedAt: null,
      });
      emit(deps, { type: "call", leadId: l.id, callId: call.id });
      result = { ok: true, quando: slotLabel(when.toISOString()), observacao: "ligações só das 9h às 20h, de segunda a sábado" };
      break;
    }

    case "agendar_retorno_whatsapp": {
      const when = new Date(String(input.quando));
      if (Number.isNaN(when.getTime())) throw new Error("data inválida");
      await onRetornoCombinado(deps, lead(), when, "whatsapp", String(input.motivo));
      result = { ok: true, quando: slotLabel(when.toISOString()) };
      break;
    }

    case "transferir_humano": {
      const l = lead();
      const urgencia = (["baixa", "media", "alta"].includes(String(input.urgencia)) ? input.urgencia : "media") as "baixa" | "media" | "alta";
      const motivo = String(input.motivo).slice(0, 140);
      const task = await deps.store.addTask({ leadId: l.id, reason: motivo, urgency: urgencia });
      await deps.store.updateLead(l.id, { aiPaused: true, pausedBy: "transferencia" });
      await deps.store.addEvent({ leadId: l.id, type: "transferencia", channel: ctx.channel, data: { motivo, urgencia } });
      await notifyTeam(deps, l, motivo, urgencia);
      emit(deps, { type: "task", leadId: l.id, taskId: task.id });
      ctx.state.transferred = true;
      await refresh();
      result = { ok: true, equipe_notificada: true, ia_pausada: true, contato: contactLabel(l) };
      break;
    }

    case "registrar_objecao": {
      await deps.store.addEvent({ leadId: lead().id, type: "objecao", channel: ctx.channel, data: { tipo: String(input.tipo) } });
      result = { ok: true };
      break;
    }

    case "atualizar_etapa": {
      const etapa = String(input.etapa) as FunnelStage;
      if (!FUNNEL_STAGES.includes(etapa)) throw new Error("etapa inválida");
      // A IA não marca compra/comparecimento: isso vem da Hotmart e da agenda.
      if (etapa === "comprou" || etapa === "compareceu") {
        result = { ok: false, erro: "essa etapa é definida pelo sistema" };
        break;
      }
      await deps.store.updateLead(lead().id, { stage: etapa });
      if (etapa === "recomendacao") await deps.store.addEvent({ leadId: lead().id, type: "recomendacao", channel: ctx.channel, data: {} });
      await refresh();
      emit(deps, { type: "lead", leadId: lead().id });
      result = { ok: true };
      break;
    }

    case "optout": {
      const canal = String(input.canal) as "whatsapp" | "voz" | "todos";
      await applyOptout(deps, lead(), canal, ctx.channel);
      ctx.state.optedOut = true;
      await refresh();
      result = { ok: true, canal, cadencias_canceladas: true };
      break;
    }

    default:
      throw new Error(`tool desconhecida: ${name}`);
  }
  ctx.state.toolLog.push({ name, input, result });
  return result;
}

export async function applyOptout(deps: Deps, lead: Lead, canal: "whatsapp" | "voz" | "todos", origin: string) {
  const patch: Partial<Lead> = {};
  if (canal === "whatsapp" || canal === "todos") patch.optOutWhatsapp = true;
  if (canal === "voz" || canal === "todos") patch.optOutVoz = true;
  await deps.store.updateLead(lead.id, patch);
  // Para todas as cadências de contato ativo (lembretes de consulta já agendada continuam só se o canal permitir).
  await deps.scheduler.cancelForLead(lead.id, (j) => canal === "todos" || (canal === "voz" ? j.type === "ligacao" || j.type === "confirmacao_por_voz" : j.type !== "ligacao"));
  await deps.store.addConsentLog({ leadId: lead.id, kind: `optout_${canal}`, granted: false, origin, text: "pedido do lead" });
  await deps.store.addEvent({ leadId: lead.id, type: "optout", channel: canal === "voz" ? "voz" : "whatsapp", data: { canal } });
  emit(deps, { type: "lead", leadId: lead.id });
}

export function agentNameForPrompt() {
  return config.AGENT_NAME;
}
