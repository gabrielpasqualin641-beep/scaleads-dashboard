export type Channel = "whatsapp" | "voz";
export type ProductCode = "controle_express" | "controle_2" | "consulta";

export type FunnelStage =
  | "novo"
  | "conversa"
  | "descoberta"
  | "recomendacao"
  | "link_enviado"
  | "comprou"
  | "consulta_agendada"
  | "compareceu"
  | "perdido"
  | "encerrado";

export const FUNNEL_STAGES: FunnelStage[] = [
  "novo",
  "conversa",
  "descoberta",
  "recomendacao",
  "link_enviado",
  "comprou",
  "consulta_agendada",
  "compareceu",
  "perdido",
  "encerrado",
];

export interface CallConsent {
  given: boolean;
  at: string; // ISO
  origin: string; // "quiz" | "lp" | "pedido_do_lead" | ...
  text: string; // texto exato aceito
}

export interface Lead {
  id: string;
  phone: string; // E.164 sem "+", ex.: 5511999999999
  name: string | null;
  email: string | null;
  source: string | null;
  stage: FunnelStage;
  aiPaused: boolean;
  pausedBy: string | null;
  optOutWhatsapp: boolean;
  optOutVoz: boolean;
  callConsent: CallConsent | null;
  naoMePerturbe: boolean;
  blockedMinor: boolean;
  identityConfirmed: boolean; // já confirmou que é o próprio lead nesta oportunidade
  purchases: ProductCode[];
  summary: string; // resumo rolante (LGPD: guardamos resumo, não transcrição de ligação)
  lastInboundAt: string | null; // janela de 24h do WhatsApp
  createdAt: string;
  updatedAt: string;
}

export type Author = "lead" | "ai" | "human" | "system";

export interface Message {
  id: string;
  leadId: string;
  channel: Channel;
  direction: "in" | "out";
  author: Author;
  text: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export interface Call {
  id: string;
  leadId: string;
  direction: "inbound" | "outbound";
  provider: string;
  providerCallId: string | null;
  reason: string;
  status: "agendada" | "discando" | "em_andamento" | "concluida" | "nao_atendida" | "outra_pessoa" | "falhou" | "cancelada";
  recorded: boolean;
  summary: string | null;
  durationSec: number | null;
  scheduledFor: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export type EventType =
  | "contato"
  | "conversa"
  | "recomendacao"
  | "link_enviado"
  | "compra"
  | "consulta_agendada"
  | "comparecimento"
  | "objecao"
  | "transferencia"
  | "optout"
  | "ligacao_atendida"
  | "reembolso";

export interface FunnelEvent {
  id: string;
  leadId: string;
  type: EventType;
  channel: Channel | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface HumanTask {
  id: string;
  leadId: string;
  reason: string;
  urgency: "baixa" | "media" | "alta";
  status: "aberta" | "em_andamento" | "concluida";
  createdAt: string;
}

export interface ContactAttempt {
  id: string;
  leadId: string;
  opportunity: string; // ex.: "carrinho:TX123", "lead_novo", "pos_express"
  channel: Channel;
  createdAt: string;
}

export interface Appointment {
  id: string;
  leadId: string;
  start: string;
  end: string;
  calendarEventId: string | null;
  paymentLink: string | null;
  status: "agendada" | "confirmada" | "remarcar" | "cancelada" | "compareceu" | "faltou";
  createdAt: string;
}

export interface Purchase {
  id: string;
  leadId: string;
  product: ProductCode;
  transaction: string;
  status: "aprovada" | "reembolsada" | "cancelada" | "aguardando_pagamento" | "abandonada";
  value: number;
  sck: string | null;
  createdAt: string;
}

export interface PanelUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
}

export interface OutboundSend {
  leadId: string;
  channel: Channel;
  text: string;
  kind: "text" | "template" | "interactive" | "voice";
  meta?: Record<string, unknown>;
}
