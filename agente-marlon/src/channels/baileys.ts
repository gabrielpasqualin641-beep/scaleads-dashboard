import type { Button, ListRow, Messenger, TemplateSend } from "./messenger.js";
import { renderTemplate } from "./whatsapp.js";

/**
 * Conexão mínima que o messenger precisa do socket do Baileys.
 * Tipada de forma frouxa de propósito, para não acoplar a uma versão específica do Baileys.
 */
export interface WAConn {
  sendMessage(jid: string, content: unknown): Promise<unknown>;
  sendPresenceUpdate?(type: string, jid?: string): Promise<void>;
  presenceSubscribe?(jid: string): Promise<void>;
}

/** Converte telefone E.164 (sem +) no JID do WhatsApp. */
export function toJid(to: string): string {
  const num = to.replace(/\D/g, "");
  return `${num}@s.whatsapp.net`;
}

/**
 * Messenger via Baileys — conexão NÃO-oficial do WhatsApp (WhatsApp Web, por QR code).
 * Só para TESTE, com número descartável: usar bibliotecas não-oficiais viola os termos do
 * WhatsApp e pode BANIR o número (ainda mais com vendas/disparos). Ver README/COMPLIANCE.md.
 *
 * Limitações propositais:
 * - Botões e listas viram texto numerado (a Meta bloqueia botões interativos fora da API oficial).
 * - NÃO envia áudio (sem sendAudio): o motor detecta a ausência e responde sempre por texto.
 */
export class BaileysMessenger implements Messenger {
  constructor(public sock: WAConn) {}

  private async send(to: string, content: Record<string, unknown>): Promise<string | null> {
    const r = (await this.sock.sendMessage(toJid(to), content)) as { key?: { id?: string | null } } | undefined;
    return r?.key?.id ?? null;
  }

  async sendText(to: string, text: string) {
    return this.send(to, { text });
  }

  async sendButtons(to: string, text: string, buttons: Button[]) {
    const linhas = buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
    return this.send(to, { text: `${text}\n\n${linhas}` });
  }

  async sendList(to: string, text: string, _buttonLabel: string, rows: ListRow[]) {
    const linhas = rows.map((r, i) => `${i + 1}. ${r.title}${r.description ? ` — ${r.description}` : ""}`).join("\n");
    return this.send(to, { text: `${text}\n\n${linhas}` });
  }

  async sendTemplate(to: string, tpl: TemplateSend) {
    return this.send(to, { text: renderTemplate(tpl) });
  }

  async typing(to: string) {
    try {
      const jid = toJid(to);
      await this.sock.presenceSubscribe?.(jid);
      await this.sock.sendPresenceUpdate?.("composing", jid);
    } catch {
      /* presença é best-effort */
    }
  }
}
