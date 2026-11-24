import { config, artigoAgente } from "../config.js";
import { firstName, type Button, type ListRow } from "../channels/messenger.js";
import { renderTemplate } from "../channels/whatsapp.js";
import { textoParaFala } from "../integrations/tts.js";
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

/** Divide a resposta do modelo em até 3 mensagens curtas (separador |||). */
export function splitParts(text: string, max = 3): string[] {
  const parts = text
    .split(/\s*\|\|\|\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= max) return parts;
  return [...parts.slice(0, max - 1), parts.slice(max - 1).join(" ")];
}

/** Espera de "digitação": chars/25 s, entre 1,2 s e 4 s. */
export function typingDelayMs(text: string) {
  return Math.round(Math.min(4, Math.max(1.2, text.length / 25)) * 1000);
}

/** Envia as partes em sequência, com "digitando" e espera proporcional ao tamanho (como uma pessoa). */
export async function sendWhatsAppParts(
  deps: Deps,
  lead: Lead,
  parts: string[],
  opts: { inboundMessageId?: string; list?: { label: string; rows: ListRow[] }; audioIndex?: number } = {},
) {
  for (const [i, part] of parts.entries()) {
    const audio = i === opts.audioIndex;
    if (deps.humanDelay) {
      await deps.messenger.typing?.(lead.phone, opts.inboundMessageId);
      // Áudio leva mais tempo para "gravar" do que um texto para digitar.
      await new Promise((r) => setTimeout(r, audio ? Math.min(6000, Math.max(2000, part.length * 45)) : typingDelayMs(part)));
    }
    const last = i === parts.length - 1;
    if (audio) await sendWhatsAppAudio(deps, lead, part);
    else await sendWhatsAppText(deps, lead, part, last && opts.list ? { list: opts.list } : {});
  }
}

/** Mensagem de voz na voz da assistente. Se a voz falhar, a mesma mensagem sai em texto. */
export async function sendWhatsAppAudio(deps: Deps, lead: Lead, text: string) {
  try {
    if (!deps.tts || !deps.messenger.sendAudio) throw new Error("voz não configurada");
    const audio = await deps.tts.synthesize(textoParaFala(text), config.WA_AUDIO_FORMAT);
    await deps.messenger.sendAudio(lead.phone, audio.data, audio.mime, text);
    await deps.store.addMessage({ leadId: lead.id, channel: "whatsapp", direction: "out", author: "ai", text, meta: { audio: true } });
    emit(deps, { type: "message", leadId: lead.id });
  } catch (e) {
    console.warn("[audio] enviando como texto:", (e as Error).message);
    await sendWhatsAppText(deps, lead, text);
  }
}

const AUDIO_MARK = /\[\[audio\]\]\s*/gi;
const MAX_AUDIO_CHARS = 600; // ~40 s de fala

/**
 * Escolhe qual parte da resposta vira áudio (no máximo uma) e tira as marcas [[audio]].
 * Nunca vira áudio: parte com link, parte longa demais, a parte com a apresentação obrigatória.
 */
export function escolherAudio(
  parts: string[],
  ctx: { modo: "auto" | "espelhar" | "off"; leadMandouAudio: boolean; temVoz: boolean; parteComIntro: number | null },
): { parts: string[]; audioIndex: number } {
  const marcadas = parts.map((p) => /\[\[audio\]\]/i.test(p));
  const limpas = parts.map((p) => p.replace(AUDIO_MARK, "").trim());
  const pode = (i: number) => i !== ctx.parteComIntro && !/https?:\/\//.test(limpas[i]) && limpas[i].length > 0 && limpas[i].length <= MAX_AUDIO_CHARS;
  if (!ctx.temVoz || ctx.modo === "off") return { parts: limpas, audioIndex: -1 };
  if (ctx.modo === "auto") {
    const i = marcadas.findIndex((m, idx) => m && pode(idx));
    if (i >= 0) return { parts: limpas, audioIndex: i };
  }
  if (ctx.leadMandouAudio) {
    // Espelha: a pessoa mandou áudio, a resposta principal vai em áudio.
    let melhor = -1;
    limpas.forEach((p, i) => { if (pode(i) && (melhor < 0 || p.length > limpas[melhor].length)) melhor = i; });
    return { parts: limpas, audioIndex: melhor };
  }
  return { parts: limpas, audioIndex: -1 };
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
  return `${name}Aqui é ${artigoAgente} ${config.AGENT_NAME}, assistente virtual da equipe do Marlon Mattedi.`;
}
