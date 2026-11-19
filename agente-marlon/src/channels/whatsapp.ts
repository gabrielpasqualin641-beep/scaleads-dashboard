import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { AGENT_DIR } from "../agent/knowledge.js";
import type { Button, ListRow, Messenger, TemplateSend } from "./messenger.js";

export interface TemplateDef {
  name: string;
  category: string;
  body: string;
  example: string[];
  buttons?: string[];
}

export function loadTemplates(): TemplateDef[] {
  return JSON.parse(readFileSync(path.join(AGENT_DIR, "templates.json"), "utf8")).templates;
}

export function renderTemplate(tpl: TemplateSend): string {
  const def = loadTemplates().find((t) => t.name === tpl.name);
  if (!def) return `[template ${tpl.name}]`;
  const body = def.body.replace(/\{\{(\d+)\}\}/g, (_, n) => tpl.params[Number(n) - 1] ?? "");
  return def.buttons?.length ? `${body}  [${def.buttons.join("] [")}]` : body;
}

/** Valida X-Hub-Signature-256 (HMAC-SHA256 do corpo cru com o App Secret). */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret = config.WA_APP_SECRET): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const got = header.slice("sha256=".length);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
}

/** WhatsApp Cloud API oficial (Graph API da Meta). Sem intermediários. */
export class WhatsAppCloudMessenger implements Messenger {
  private base = `https://graph.facebook.com/${config.WA_GRAPH_VERSION}`;

  private async post(body: Record<string, unknown>): Promise<string | null> {
    const r = await fetch(`${this.base}/${config.WA_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...body }),
    });
    const j = (await r.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message: string; code: number } };
    if (!r.ok) throw new Error(`WhatsApp API ${r.status}: ${j.error?.message ?? "erro"} (code ${j.error?.code ?? "?"})`);
    return j.messages?.[0]?.id ?? null;
  }

  sendText(to: string, text: string) {
    return this.post({ to, type: "text", text: { body: text, preview_url: false } });
  }

  sendButtons(to: string, text: string, buttons: Button[]) {
    return this.post({
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text },
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    });
  }

  sendList(to: string, text: string, buttonLabel: string, rows: ListRow[]) {
    return this.post({
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text },
        action: {
          button: buttonLabel.slice(0, 20),
          sections: [{ title: "Horários", rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: r.title.slice(0, 24), description: r.description?.slice(0, 72) })) }],
        },
      },
    });
  }

  sendTemplate(to: string, tpl: TemplateSend) {
    const components: Array<Record<string, unknown>> = [];
    if (tpl.params.length) components.push({ type: "body", parameters: tpl.params.map((text) => ({ type: "text", text })) });
    (tpl.buttonPayloads ?? []).forEach((payload, index) =>
      components.push({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] }),
    );
    return this.post({ to, type: "template", template: { name: tpl.name, language: { code: config.WA_TEMPLATE_LANG }, components } });
  }

  /** Baixa uma mídia (ex.: áudio) recebida pelo webhook. */
  async downloadMedia(mediaId: string): Promise<{ data: Buffer; mime: string }> {
    const meta = await fetch(`${this.base}/${mediaId}`, { headers: { Authorization: `Bearer ${config.WA_ACCESS_TOKEN}` } });
    const j = (await meta.json()) as { url: string; mime_type: string };
    const file = await fetch(j.url, { headers: { Authorization: `Bearer ${config.WA_ACCESS_TOKEN}` } });
    return { data: Buffer.from(await file.arrayBuffer()), mime: j.mime_type };
  }

  /** Envia uma mensagem de voz: sobe o arquivo na Meta e manda como áudio de voz. */
  async sendAudio(to: string, data: Buffer, mime: string, _transcript: string) {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mime);
    form.append("file", new Blob([new Uint8Array(data)], { type: mime }), mime === "audio/ogg" ? "voz.ogg" : "voz.mp3");
    const up = await fetch(`${this.base}/${config.WA_PHONE_NUMBER_ID}/media`, { method: "POST", headers: { Authorization: `Bearer ${config.WA_ACCESS_TOKEN}` }, body: form });
    const j = (await up.json().catch(() => ({}))) as { id?: string; error?: { message: string } };
    if (!up.ok || !j.id) throw new Error(`upload de áudio falhou: ${j.error?.message ?? up.status}`);
    // "voice: true" faz aparecer como mensagem de voz (com onda), e não como arquivo de áudio.
    return this.post({ to, type: "audio", audio: { id: j.id, voice: mime === "audio/ogg" } });
  }

  /** "Digitando..." (Cloud API: status read + typing_indicator; some ao enviar a resposta ou em 25 s). */
  async typing(_to: string, inboundMessageId?: string) {
    if (!inboundMessageId) return;
    await fetch(`${this.base}/${config.WA_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: inboundMessageId, typing_indicator: { type: "text" } }),
    }).catch(() => undefined);
  }

  async markRead(messageId: string) {
    await fetch(`${this.base}/${config.WA_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
    }).catch(() => undefined);
  }
}

/** Mensagem normalizada a partir do payload do webhook da Meta. */
export interface InboundWhatsApp {
  waMessageId: string;
  from: string;
  name: string | null;
  type: "text" | "audio" | "button" | "interactive" | "other";
  text: string;
  replyId?: string; // id do botão/linha escolhida
  audioMediaId?: string;
  referral?: { source_type?: string; source_id?: string; headline?: string };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseWhatsAppWebhook(body: any): InboundWhatsApp[] {
  const out: InboundWhatsApp[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const contacts = value?.contacts ?? [];
      for (const m of value?.messages ?? []) {
        const name = contacts.find((c: any) => c.wa_id === m.from)?.profile?.name ?? null;
        const base = { waMessageId: m.id, from: m.from, name, referral: m.referral };
        if (m.type === "text") out.push({ ...base, type: "text", text: m.text?.body ?? "" });
        else if (m.type === "audio") out.push({ ...base, type: "audio", text: "", audioMediaId: m.audio?.id });
        else if (m.type === "button") out.push({ ...base, type: "button", text: m.button?.text ?? "", replyId: m.button?.payload });
        else if (m.type === "interactive") {
          const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
          out.push({ ...base, type: "interactive", text: r?.title ?? "", replyId: r?.id });
        } else out.push({ ...base, type: "other", text: "" });
      }
    }
  }
  return out;
}
