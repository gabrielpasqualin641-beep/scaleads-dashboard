import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DateTime } from "luxon";
import { config, isProd } from "../config.js";
import type { App } from "../app.js";
import { isInside24hWindow } from "../compliance/rules.js";
import { sendWhatsAppText } from "../agent/outbound.js";
import { emit, type BusEvent } from "../deps.js";
import { computeMetrics, metricsToCsv } from "../metrics/metrics.js";

const COOKIE = "painel_token";

declare module "fastify" {
  interface FastifyRequest {
    panelUser?: { id: string; email: string; name: string };
  }
}

export function registerPanelApi(server: FastifyInstance, app: App) {
  const { deps } = app;
  const { store } = deps;

  async function auth(req: FastifyRequest, reply: FastifyReply) {
    try {
      const token = req.cookies[COOKIE] ?? (req.headers.authorization ?? "").replace(/^Bearer /, "");
      req.panelUser = server.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "não autenticado" });
    }
  }

  server.post("/api/auth/login", async (req, reply) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    const user = email ? await store.getUserByEmail(email.toLowerCase()) : null;
    if (!user || !password || !(await bcrypt.compare(password, user.passwordHash))) return reply.code(401).send({ error: "e-mail ou senha inválidos" });
    const token = server.jwt.sign({ id: user.id, email: user.email, name: user.name }, { expiresIn: "12h" });
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: isProd(), path: "/", maxAge: 12 * 3600 });
    return { ok: true, user: { email: user.email, name: user.name } };
  });

  server.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  server.register(async (r) => {
    r.addHook("preHandler", auth);

    r.get("/api/auth/me", async (req) => req.panelUser);

    r.get("/api/leads", async (req) => {
      const { search } = req.query as { search?: string };
      const leads = await store.listLeads({ limit: 200, search });
      return Promise.all(
        leads.map(async (l) => {
          const last = (await store.listMessages(l.id, 1))[0];
          return { ...l, lastMessage: last ? { text: last.text.slice(0, 120), author: last.author, at: last.createdAt } : null };
        }),
      );
    });

    r.get("/api/leads/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const lead = await store.getLead(id);
      if (!lead) return reply.code(404).send();
      const [messages, calls, appointments, purchases, jobs] = await Promise.all([
        store.listMessages(id, 300),
        store.listCalls({ leadId: id }),
        store.listAppointments({ leadId: id }),
        store.listPurchases({ leadId: id }),
        deps.scheduler.list(id),
      ]);
      return { lead, messages, calls, appointments, purchases, jobs, janela24hAberta: isInside24hWindow(lead, deps.now()) };
    });

    // "Assumir conversa": a IA pausa neste contato até ser reativada.
    r.post("/api/leads/:id/takeover", async (req) => {
      const { id } = req.params as { id: string };
      const lead = await store.updateLead(id, { aiPaused: true, pausedBy: req.panelUser!.email });
      emit(deps, { type: "lead", leadId: id });
      return lead;
    });

    r.post("/api/leads/:id/release", async (req) => {
      const { id } = req.params as { id: string };
      const lead = await store.updateLead(id, { aiPaused: false, pausedBy: null });
      emit(deps, { type: "lead", leadId: id });
      return lead;
    });

    // Humano responde pelo painel, pelo mesmo número.
    r.post("/api/leads/:id/messages", async (req, reply) => {
      const { id } = req.params as { id: string };
      const { text } = (req.body ?? {}) as { text?: string };
      let lead = await store.getLead(id);
      if (!lead || !text?.trim()) return reply.code(400).send({ error: "mensagem vazia" });
      if (lead.optOutWhatsapp) return reply.code(409).send({ error: "o contato pediu para não receber WhatsApp" });
      if (!isInside24hWindow(lead, deps.now())) return reply.code(409).send({ error: "fora da janela de 24h: só template aprovado" });
      if (!lead.aiPaused) lead = await store.updateLead(id, { aiPaused: true, pausedBy: req.panelUser!.email });
      await sendWhatsAppText(deps, lead, text.trim(), { author: "human" });
      return { ok: true };
    });

    r.get("/api/calls", async () => {
      const calls = await store.listCalls({ limit: 200 });
      return Promise.all(calls.map(async (c) => ({ ...c, lead: await store.getLead(c.leadId).then((l) => (l ? { id: l.id, name: l.name, phone: l.phone } : null)) })));
    });

    r.get("/api/tasks", async () => {
      const tasks = await store.listTasks();
      return Promise.all(tasks.map(async (t) => ({ ...t, lead: await store.getLead(t.leadId).then((l) => (l ? { id: l.id, name: l.name } : null)) })));
    });

    r.post("/api/tasks/:id", async (req) => {
      const { id } = req.params as { id: string };
      const { status } = (req.body ?? {}) as { status: "aberta" | "em_andamento" | "concluida" };
      return store.updateTask(id, { status });
    });

    r.get("/api/metrics", async (req) => {
      const q = req.query as { from?: string; to?: string };
      const to = q.to ? new Date(q.to) : DateTime.fromJSDate(deps.now()).setZone(config.TZ_OPERACAO).endOf("day").toJSDate();
      const from = q.from ? new Date(q.from) : DateTime.fromJSDate(to).minus({ days: 30 }).toJSDate();
      return computeMetrics(deps, from, to);
    });

    r.get("/api/metrics/csv", async (req, reply) => {
      const q = req.query as { date?: string };
      const d = (q.date ? DateTime.fromISO(q.date, { zone: config.TZ_OPERACAO }) : DateTime.now().setZone(config.TZ_OPERACAO).minus({ days: 1 })).startOf("day");
      const m = await computeMetrics(deps, d.toJSDate(), d.plus({ days: 1 }).toJSDate());
      reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="metricas-${d.toFormat("yyyy-MM-dd")}.csv"`);
      return metricsToCsv(m);
    });

    // Tempo real (SSE)
    r.get("/api/stream", (req, reply) => {
      reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      const send = (ev: BusEvent) => reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
      const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
      deps.bus.on("event", send);
      req.raw.on("close", () => {
        clearInterval(ping);
        deps.bus.off("event", send);
      });
    });
  });
}
