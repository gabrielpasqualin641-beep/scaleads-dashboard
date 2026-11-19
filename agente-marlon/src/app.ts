import { EventEmitter } from "node:events";
import { config } from "./config.js";
import { ClaudeBrain } from "./agent/brain/claude.js";
import { OfflineBrain } from "./agent/brain/offline.js";
import type { Brain } from "./agent/brain/types.js";
import { Engine } from "./agent/engine.js";
import { WhatsAppCloudMessenger } from "./channels/whatsapp.js";
import type { Messenger } from "./channels/messenger.js";
import type { Deps } from "./deps.js";
import { FakeCalendar, GoogleCalendar, type CalendarProvider } from "./integrations/calendar.js";
import { makePaymentProvider } from "./integrations/payments.js";
import { makeTts } from "./integrations/tts.js";
import { BullScheduler, MemoryScheduler, redisConnection, type Scheduler } from "./queue/scheduler.js";
import { MemoryStore } from "./store/MemoryStore.js";
import { PrismaStore } from "./store/PrismaStore.js";
import type { Store } from "./store/Store.js";
import { makeDialer } from "./voice/providers.js";

export function makeBrain(kind = config.BRAIN): Brain {
  if (kind === "claude") {
    if (!config.ANTHROPIC_API_KEY) {
      console.warn("[agente] ANTHROPIC_API_KEY ausente: usando o cérebro offline.");
      return new OfflineBrain();
    }
    return new ClaudeBrain();
  }
  return new OfflineBrain();
}

export interface App {
  deps: Deps;
  engine: Engine;
  scheduler: Scheduler;
}

/** Monta as dependências de produção a partir do .env. */
export function buildApp(overrides: Partial<Deps> & { brain?: Brain } = {}): App {
  const store: Store = overrides.store ?? (config.STORE === "prisma" ? new PrismaStore(requireEnv("DATABASE_URL", config.DATABASE_URL)) : new MemoryStore());
  const scheduler: Scheduler =
    overrides.scheduler ?? (config.QUEUE_MODE === "bullmq" ? new BullScheduler(redisConnection(config.REDIS_URL)) : new MemoryScheduler());
  const messenger: Messenger = overrides.messenger ?? new WhatsAppCloudMessenger();
  const calendar: CalendarProvider = overrides.calendar ?? (config.GOOGLE_SERVICE_ACCOUNT_JSON ? new GoogleCalendar() : new FakeCalendar());
  const deps: Deps = {
    store,
    scheduler,
    messenger,
    calendar,
    payments: overrides.payments ?? makePaymentProvider(),
    dialer: null,
    bus: overrides.bus ?? new EventEmitter().setMaxListeners(200),
    now: overrides.now ?? (() => new Date()),
    humanDelay: overrides.humanDelay ?? config.HUMAN_DELAY,
    tts: overrides.tts !== undefined ? overrides.tts : makeTts(),
  };
  const engine = new Engine(deps, overrides.brain ?? makeBrain());
  deps.dialer = overrides.dialer !== undefined ? overrides.dialer : makeDialer(engine);
  return { deps, engine, scheduler };
}

function requireEnv(name: string, v: string | undefined): string {
  if (!v) throw new Error(`${name} é obrigatório (ou use STORE=memory para testes locais)`);
  return v;
}
