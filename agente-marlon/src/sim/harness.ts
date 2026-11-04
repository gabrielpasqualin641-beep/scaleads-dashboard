import { EventEmitter } from "node:events";
import { DateTime } from "luxon";
import { config } from "../config.js";
import { buildApp, makeBrain, type App } from "../app.js";
import type { Brain } from "../agent/brain/types.js";
import { RecordingMessenger } from "../channels/messenger.js";
import { renderTemplate } from "../channels/whatsapp.js";
import type { Call, Lead } from "../domain/types.js";
import type { VoiceDialer } from "../deps.js";
import { FakeCalendar } from "../integrations/calendar.js";
import { ManualLinks } from "../integrations/payments.js";
import { runJob } from "../queue/jobs.js";
import { MemoryScheduler } from "../queue/scheduler.js";
import { MemoryStore } from "../store/MemoryStore.js";
import { openSession, closeSession, sessions } from "../voice/sessions.js";
import type { VoiceSession } from "../agent/engine.js";

/** Discador simulado: registra as ligações e respeita a regra do 0303. */
export class SimDialer implements VoiceDialer {
  name = "simulado";
  dialed: Array<{ leadId: string; purpose: string; from: string }> = [];
  constructor(private has0303 = true) {}
  async dial({ lead, purpose }: { lead: Lead; call: Call; purpose: "oferta" | "servico" }) {
    if (purpose === "oferta" && !this.has0303) throw new Error("sem número 0303");
    this.dialed.push({ leadId: lead.id, purpose, from: purpose === "oferta" ? "0303-xxxx-xxxx" : "+55 11 4000-0000" });
    return { providerCallId: `sim-${this.dialed.length}` };
  }
}

export interface Harness {
  app: App;
  store: MemoryStore;
  messenger: RecordingMessenger;
  scheduler: MemoryScheduler;
  dialer: SimDialer;
  clock: { now: Date };
  advance(spec: string): Promise<number>;
  startCall(lead: Lead, reason?: string, direction?: "inbound" | "outbound"): Promise<{ session: VoiceSession; opener: string }>;
  endCall(session: VoiceSession): Promise<void>;
}

/** Monta o agente inteiro em memória (sem rede): mesmo Engine, tools, guardrails e cadências da produção. */
export function createHarness(opts: { brain?: Brain; live?: boolean; start?: string; has0303?: boolean } = {}): Harness {
  const clock = { now: opts.start ? new Date(opts.start) : nextBusinessMorning() };
  const store = new MemoryStore(() => clock.now);
  const messenger = new RecordingMessenger(renderTemplate, () => clock.now);
  const scheduler = new MemoryScheduler();
  const dialer = new SimDialer(opts.has0303 ?? true);
  const app = buildApp({
    store,
    messenger,
    scheduler,
    calendar: new FakeCalendar(),
    payments: new ManualLinks(),
    dialer,
    bus: new EventEmitter(),
    now: () => clock.now,
    brain: opts.brain ?? (opts.live ? makeBrain("claude") : makeBrain("offline")),
  });
  return {
    app,
    store,
    messenger,
    scheduler,
    dialer,
    clock,
    /** Avança o relógio ("+30m", "+1d", "+2h") e executa as cadências vencidas. */
    async advance(spec: string) {
      const m = spec.match(/^\+(\d+)([mhd])$/);
      if (!m) throw new Error(`formato inválido: ${spec}`);
      const ms = Number(m[1]) * (m[2] === "m" ? 60_000 : m[2] === "h" ? 3_600_000 : 86_400_000);
      const target = clock.now.getTime() + ms;
      let ran = 0;
      // Avança em passos para que reagendamentos (fora da janela) também rodem.
      while (clock.now.getTime() < target) {
        clock.now = new Date(Math.min(target, clock.now.getTime() + 15 * 60_000));
        ran += await scheduler.runDue((job) => runJob(app.deps, job), clock.now);
      }
      return ran;
    },
    async startCall(lead, reason = "ligação consultiva", direction = "outbound") {
      const call = await store.addCall({
        leadId: lead.id, direction, provider: "simulado", providerCallId: `sim-${Date.now()}`, reason, status: "em_andamento",
        recorded: config.VOICE_RECORD_CALLS, summary: null, durationSec: null, scheduledFor: null, startedAt: clock.now.toISOString(), endedAt: null,
      });
      return openSession(app.engine, lead, call, direction);
    },
    async endCall(session) {
      if (session.callId && sessions.has(session.callId)) await closeSession(app.engine, session.callId, 120);
    },
  };
}

/** Próxima terça às 10h (dentro da janela de contato), para testes determinísticos. */
function nextBusinessMorning() {
  let d = DateTime.now().setZone(config.TZ_OPERACAO).plus({ days: 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  while (d.weekday !== 2) d = d.plus({ days: 1 });
  return d.toJSDate();
}
