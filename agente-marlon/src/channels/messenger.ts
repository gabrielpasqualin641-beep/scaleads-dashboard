import type { Lead } from "../domain/types.js";

export interface Button {
  id: string;
  title: string; // até 20 caracteres (limite da Meta)
}

export interface ListRow {
  id: string;
  title: string; // até 24 caracteres
  description?: string;
}

export interface TemplateSend {
  name: string;
  params: string[]; // variáveis do corpo, na ordem
  buttonPayloads?: string[]; // payload dos botões de resposta rápida
}

/** Saída para o WhatsApp. Implementações: WhatsAppCloudMessenger (produção) e RecordingMessenger (simulador/testes). */
export interface Messenger {
  sendText(to: string, text: string): Promise<string | null>;
  sendButtons(to: string, text: string, buttons: Button[]): Promise<string | null>;
  sendList(to: string, text: string, buttonLabel: string, rows: ListRow[]): Promise<string | null>;
  sendTemplate(to: string, tpl: TemplateSend): Promise<string | null>;
  /** Mostra "digitando..." para o lead (opcional; precisa do id da mensagem recebida). */
  typing?(to: string, inboundMessageId?: string): Promise<void>;
  /** Mensagem de voz (áudio). `transcript` é o texto falado (usado em testes e no simulador). */
  sendAudio?(to: string, data: Buffer, mime: string, transcript: string): Promise<string | null>;
}

export type SentRecord = { at?: string } & (
  | { kind: "text"; to: string; text: string }
  | { kind: "buttons"; to: string; text: string; buttons: Button[] }
  | { kind: "list"; to: string; text: string; rows: ListRow[] }
  | { kind: "template"; to: string; tpl: TemplateSend; rendered: string }
  | { kind: "audio"; to: string; text: string; mime: string }
);

/** Guarda tudo o que seria enviado. */
export class RecordingMessenger implements Messenger {
  sent: SentRecord[] = [];
  constructor(
    private render: (tpl: TemplateSend) => string = (t) => `[template ${t.name}] ${t.params.join(" | ")}`,
    public clock: () => Date = () => new Date(),
  ) {}
  private at() {
    return this.clock().toISOString();
  }
  async sendText(to: string, text: string) {
    this.sent.push({ kind: "text", to, text, at: this.at() });
    return null;
  }
  async sendButtons(to: string, text: string, buttons: Button[]) {
    this.sent.push({ kind: "buttons", to, text, buttons, at: this.at() });
    return null;
  }
  async sendList(to: string, text: string, _label: string, rows: ListRow[]) {
    this.sent.push({ kind: "list", to, text, rows, at: this.at() });
    return null;
  }
  async sendTemplate(to: string, tpl: TemplateSend) {
    this.sent.push({ kind: "template", to, tpl, rendered: this.render(tpl), at: this.at() });
    return null;
  }
  async sendAudio(to: string, _data: Buffer, mime: string, transcript: string) {
    this.sent.push({ kind: "audio", to, text: transcript, mime, at: this.at() });
    return null;
  }
}

export function firstName(lead: Lead): string {
  return (lead.name ?? "").trim().split(/\s+/)[0] || "tudo bem";
}
