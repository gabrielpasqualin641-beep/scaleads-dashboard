import { config } from "../config.js";
import { firstName, type Button, type ListRow } from "../channels/messenger.js";
import { renderTemplate } from "../channels/whatsapp.js";
import { isInside24hWindow } from "../compliance/rules.js";
import type { Author, Lead } from "../domain/types.js";
import { emit, type Deps } from "../deps.js";

/** Envia texto livre no WhatsApp (só dentro da janela de 24h) e registra no histórico. */
export async function sendWhatsAppText(
  deps: Deps,
  lead: Lead,
  text: string,
  opts: { author?: Author; buttons?: Button[]; list?: { label: string; rows: ListRow[] } } = {},
) {
  if (opts.list) await deps.messenger.sendList(lead.phone, text, opts.list.label, opts.list.rows);
  else if (opts.buttons?.length) await deps.messenger.sendButtons(lead.phone, text, opts.buttons);
  else await deps.messenger.sendText(lead.phone, text);
  await deps.store.addMessage({
    leadId: lead.id,
    channel: "whatsapp",
    direction: "out",
    author: opts.author ?? "ai",
    text,
    meta: opts.buttons ? { buttons: opts.buttons } : opts.list ? { list: opts.list.rows } : undefined,
  });
  emit(deps, { type: "message", leadId: lead.id });
}

export async function sendWhatsAppTemplate(deps: Deps, lead: Lead, name: string, params: string[], buttonPayloads?: string[]) {
  const tpl = { name, params, buttonPayloads };
  await deps.messenger.sendTemplate(lead.phone, tpl);
  await deps.store.addMessage({ leadId: lead.id, channel: "whatsapp", direction: "out", author: "ai", text: renderTemplate(tpl), meta: { template: name } });
  emit(deps, { type: "message", leadId: lead.id });
}

/** Texto livre se a janela de 24h estiver aberta; senão, o template neutro informado. */
export async function sendWhatsAppSmart(deps: Deps, lead: Lead, text: string, fallbackTemplate: { name: string; params: string[] }) {
  if (isInside24hWindow(lead, deps.now())) return sendWhatsAppText(deps, lead, text);
  return sendWhatsAppTemplate(deps, lead, fallbackTemplate.name, fallbackTemplate.params);
}

export function contactLabel(lead: Lead) {
  return `${firstName(lead)} (final ${lead.phone.slice(-4)})`;
}

/** Notifica a equipe no WhatsApp interno. Não inclui o conteúdo da conversa. */
export async function notifyTeam(deps: Deps, lead: Lead, reason: string, urgency: string) {
  const numbers = config.WA_TEAM_NUMBERS.split(",").map((s) => s.trim()).filter(Boolean);
  for (const n of numbers) {
    await deps.messenger.sendTemplate(n, { name: "alerta_equipe", params: [contactLabel(lead), reason, urgency] }).catch((e) => {
      console.error("[equipe] falha ao notificar", n, e.message);
    });
  }
}

export function agentIntro(lead: Lead) {
  const name = lead.name ? `Oi, ${firstName(lead)}! ` : "Oi! ";
  return `${name}Aqui é a ${config.AGENT_NAME}, assistente virtual da equipe do Marlon Mattedi.`;
}
