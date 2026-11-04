import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { config } from "./config.js";
import { buildApp, type App } from "./app.js";
import { registerPanelApi } from "./http/panelApi.js";
import { registerSimApi } from "./http/simApi.js";
import { registerWebhooks } from "./http/webhooks.js";
import type { Harness } from "./sim/harness.js";
import { runJob } from "./queue/jobs.js";
import { BullScheduler } from "./queue/scheduler.js";
import { registerVoiceRoutes } from "./voice/routes.js";

export async function buildServer(app: App = buildApp(), opts: { sim?: Harness } = {}) {
  const server = Fastify({ logger: { level: config.NODE_ENV === "test" ? "silent" : "info" }, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });

  // Guarda o corpo cru para validar a assinatura da Meta.
  server.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body: Buffer, done) => {
    (req as unknown as { rawBody: Buffer }).rawBody = body;
    if (!body.length) return done(null, {});
    try {
      done(null, JSON.parse(body.toString("utf8")));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  await server.register(cors, { origin: config.PANEL_ORIGIN, credentials: true });
  await server.register(cookie);
  await server.register(formbody);
  await server.register(jwt, { secret: config.JWT_SECRET });
  await server.register(websocket);

  server.get("/health", async () => ({ ok: true, brain: app.engine.brain.name, voz: app.deps.dialer?.name ?? "desligada" }));
  registerWebhooks(server, app);
  registerPanelApi(server, app);
  if (opts.sim) registerSimApi(server, opts.sim); // só no modo demo
  registerVoiceRoutes(server, app.engine);
  return server;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = buildApp();
  const server = await buildServer(app);
  // Worker no mesmo processo (deploy simples em 1 instância). Use WORKER_INLINE=false e `npm run worker` para separar.
  if (process.env.WORKER_INLINE !== "false" && app.scheduler instanceof BullScheduler) {
    await app.scheduler.ensureRepeatables(config.TZ_OPERACAO);
    app.scheduler.startWorker((job) => runJob(app.deps, job));
    server.log.info("worker de cadências iniciado no mesmo processo");
  }
  await server.listen({ port: config.PORT, host: "0.0.0.0" });
}
