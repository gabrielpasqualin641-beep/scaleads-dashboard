import { DateTime } from "luxon";
import { config } from "../config.js";
import type { Channel, Lead } from "../domain/types.js";
import type { Store } from "../store/Store.js";

export const JANELA_INICIO = 9; // 9h
export const JANELA_FIM = 20; // 20h (exclusivo)
export const MAX_TENTATIVAS_POR_OPORTUNIDADE = 3;
export const MAX_LIGACOES_POR_DIA = 1;

/** Sem contato ativo entre 20h e 9h, nem aos domingos (horário de Brasília). */
export function isWithinContactWindow(at: Date = new Date()): boolean {
  const t = DateTime.fromJSDate(at).setZone(config.TZ_OPERACAO);
  if (t.weekday === 7) return false; // domingo
  return t.hour >= JANELA_INICIO && t.hour < JANELA_FIM;
}

/** Próximo instante permitido para contato ativo (>= at). */
export function nextContactWindow(at: Date = new Date()): Date {
  let t = DateTime.fromJSDate(at).setZone(config.TZ_OPERACAO);
  for (let i = 0; i < 10; i++) {
    if (t.weekday !== 7 && t.hour >= JANELA_INICIO && t.hour < JANELA_FIM) return t.toJSDate();
    if (t.weekday !== 7 && t.hour < JANELA_INICIO) {
      t = t.set({ hour: JANELA_INICIO, minute: 0, second: 0, millisecond: 0 });
      continue;
    }
    t = t.plus({ days: 1 }).set({ hour: JANELA_INICIO, minute: 0, second: 0, millisecond: 0 });
  }
  return t.toJSDate();
}

export function hasCallConsent(lead: Lead): boolean {
  return Boolean(lead.callConsent?.given && lead.callConsent.at && lead.callConsent.origin && lead.callConsent.text);
}

export type ContactDecision = { allowed: true } | { allowed: false; reason: string; retryAt?: Date };

/**
 * Regra central para QUALQUER contato ativo (iniciado por nós).
 * Respostas a mensagens do lead dentro da conversa não passam por aqui.
 */
export async function canContact(
  store: Store,
  lead: Lead,
  channel: Channel,
  opportunity: string,
  opts: { at?: Date; kind?: "oferta" | "servico" } = {},
): Promise<ContactDecision> {
  const at = opts.at ?? new Date();
  if (lead.blockedMinor) return { allowed: false, reason: "lead bloqueado (indício de menor de idade)" };
  if (channel === "whatsapp" && lead.optOutWhatsapp) return { allowed: false, reason: "opt-out de WhatsApp" };
  if (channel === "voz") {
    if (lead.optOutVoz) return { allowed: false, reason: "opt-out de ligação" };
    if (!hasCallConsent(lead)) return { allowed: false, reason: "sem consentimento explícito de ligação" };
    if (lead.naoMePerturbe && opts.kind !== "servico") return { allowed: false, reason: "número na lista Não Me Perturbe" };
  }
  if (!isWithinContactWindow(at)) {
    return { allowed: false, reason: "fora da janela (9h-20h, seg-sáb)", retryAt: nextContactWindow(at) };
  }
  const attempts = await store.listAttempts(lead.id, { opportunity });
  if (attempts.length >= MAX_TENTATIVAS_POR_OPORTUNIDADE) {
    return { allowed: false, reason: `limite de ${MAX_TENTATIVAS_POR_OPORTUNIDADE} tentativas para a oportunidade` };
  }
  if (channel === "voz") {
    const dayStart = DateTime.fromJSDate(at).setZone(config.TZ_OPERACAO).startOf("day").toUTC().toISO()!;
    const calls = await store.listAttempts(lead.id, { channel: "voz", since: dayStart });
    if (calls.length >= MAX_LIGACOES_POR_DIA) {
      return {
        allowed: false,
        reason: "já houve 1 ligação hoje",
        retryAt: nextContactWindow(DateTime.fromJSDate(at).setZone(config.TZ_OPERACAO).plus({ days: 1 }).startOf("day").toJSDate()),
      };
    }
  }
  return { allowed: true };
}

/** WhatsApp: fora da janela de 24h desde a última mensagem do lead, só template aprovado. */
export function isInside24hWindow(lead: Lead, at: Date = new Date()): boolean {
  if (!lead.lastInboundAt) return false;
  return at.getTime() - new Date(lead.lastInboundAt).getTime() < 24 * 3600 * 1000;
}

/** Consulta opcional à lista Não Me Perturbe (endpoint configurável). Falha fechada para oferta. */
export async function checkNaoMePerturbe(phone: string): Promise<boolean> {
  if (!config.NAO_ME_PERTURBE_CHECK_URL) return false;
  try {
    const r = await fetch(`${config.NAO_ME_PERTURBE_CHECK_URL}?phone=${encodeURIComponent(phone)}`);
    if (!r.ok) return true;
    const j = (await r.json()) as { blocked?: boolean };
    return Boolean(j.blocked);
  } catch {
    return true;
  }
}
