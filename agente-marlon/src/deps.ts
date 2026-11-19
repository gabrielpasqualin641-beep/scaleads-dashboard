import { EventEmitter } from "node:events";
import type { Messenger } from "./channels/messenger.js";
import type { Call, Lead } from "./domain/types.js";
import type { CalendarProvider } from "./integrations/calendar.js";
import type { PaymentLinkProvider } from "./integrations/payments.js";
import type { TtsProvider } from "./integrations/tts.js";
import type { Scheduler } from "./queue/scheduler.js";
import type { Store } from "./store/Store.js";

/** Quem efetivamente disca (Vapi, Retell ou Twilio Media Streams). */
export interface VoiceDialer {
  name: string;
  dial(input: { lead: Lead; call: Call; purpose: "oferta" | "servico" }): Promise<{ providerCallId: string }>;
}

export interface Deps {
  store: Store;
  messenger: Messenger;
  scheduler: Scheduler;
  calendar: CalendarProvider;
  payments: PaymentLinkProvider;
  dialer: VoiceDialer | null;
  bus: EventEmitter; // eventos em tempo real para o painel
  now: () => Date;
  humanDelay?: boolean;
  tts?: TtsProvider | null; // voz para respostas em áudio no WhatsApp // "digitando" e espera entre mensagens (desligado em testes e no simulador)
}

export type BusEvent =
  | { type: "message"; leadId: string }
  | { type: "lead"; leadId: string }
  | { type: "call"; leadId: string; callId: string }
  | { type: "task"; leadId: string; taskId: string };

export function emit(deps: Deps, ev: BusEvent) {
  deps.bus.emit("event", ev);
}
