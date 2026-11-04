/**
 * API do simulador (só no modo demo): permite conversar com o agente pelo painel,
 * fingindo ser o lead no WhatsApp ou numa ligação. Nunca é registrada em produção.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DateTime } from "luxon";
import { config } from "../config.js";
import type { SentRecord } from "../channels/messenger.js";
import { hasCallConsent } from "../compliance/rules.js";
import type { Harness } from "../sim/harness.js";
import type { VoiceSession } from "../agent/engine.js";

const sessions = new Map<string, VoiceSession>();

function view(s: SentRecord) {
  if (s.kind === "template") return { tipo: "template", nome: s.tpl.name, texto: s.rendered };
  if (s.kind === "buttons") return { tipo: "botoes", texto: s.text, botoes: s.buttons };
  if (s.kind === "list") return { tipo: "lista", texto: s.text, opcoes: s.rows };
  return { tipo: "texto", texto: s.text };
}

export function registerSimApi(server: FastifyInstance, h: Harness) {
  const e = h.app.engine;

  async function auth(req: FastifyRequest, reply: FastifyReply) {
    try {
      server.jwt.verify(req.cookies["painel_token"] ?? "");
    } catch {
      return reply.code(401).send({ error: "não autenticado" });
    }
  }

  const relogio = () => DateTime.fromJSDate(h.clock.now).setZone(config.TZ_OPERACAO).toFormat("cccc dd/MM HH:mm", { locale: "pt-BR" });

  async function estado(phone: string) {
    const lead = await h.store.getLeadByPhone(phone);
    if (!lead) return null;
    const jobs = await h.scheduler.list(lead.id);
    const tasks = h.store.tasks.filter((t) => t.leadId === lead.id && t.status !== "concluida");
    return {
      leadId: lead.id,
      etapa: lead.stage,
      iaPausada: lead.aiPaused,
      optOutWhatsapp: lead.optOutWhatsapp,
      optOutVoz: lead.optOutVoz,
      bloqueadoMenor: lead.blockedMinor,
      consentimentoLigacao: hasCallConsent(lead),
      compras: lead.purchases,
      transferencias: tasks.map((t) => ({ motivo: t.reason, urgencia: t.urgency })),
      proximosContatos: jobs.map((j) => ({ tipo: j.type, etapa: j.step, quando: DateTime.fromISO(j.runAt).setZone(config.TZ_OPERACAO).toFormat("dd/MM HH:mm") })),
      ligacoesDiscadas: h.dialer.dialed.filter((d) => d.leadId === lead.id).length,
    };
  }

  const sentSince = (phone: string, idx: number) => h.messenger.sent.slice(idx).filter((s) => s.to === phone).map(view);

  server.register(async (r) => {
    r.addHook("preHandler", auth);

    r.get("/api/sim/info", async () => ({ cerebro: e.brain.name, modelo: e.brain.name === "claude" ? config.ANTHROPIC_MODEL : null, agente: config.AGENT_NAME, relogio: relogio() }));

    // Mensagem (ou toque em botão) do lead no WhatsApp
    r.post("/api/sim/whatsapp", async (req) => {
      const b = req.body as { telefone: string; nome?: string; texto?: string; botao?: string; tituloBotao?: string };
      const before = h.messenger.sent.length;
      const result = await e.handleWhatsApp({ from: b.telefone, name: b.nome, text: b.tituloBotao ?? b.texto ?? b.botao ?? "", replyId: b.botao });
      return {
        respostas: sentSince(b.telefone, before),
        regra: result.guard ?? null,
        bloqueios: result.violations,
        tools: result.state.toolLog.map((t) => ({ nome: t.name, entrada: t.input, resultado: t.result })),
        estado: await estado(b.telefone),
        relogio: relogio(),
      };
    });

    // Marca o consentimento de ligação (como o checkbox do quiz)
    r.post("/api/sim/consentimento", async (req) => {
      const b = req.body as { telefone: string; nome?: string };
      const lead = await h.store.upsertLeadByPhone({ phone: b.telefone, name: b.nome ?? null });
      await h.store.updateLead(lead.id, { callConsent: { given: true, at: h.clock.now.toISOString(), origin: "simulador", text: "Aceito receber ligação da equipe do Marlon Mattedi" } });
      return { estado: await estado(b.telefone) };
    });

    // Inicia uma ligação simulada (a IA fala primeiro)
    r.post("/api/sim/ligacao", async (req) => {
      const b = req.body as { telefone: string; nome?: string; motivo?: string; receptiva?: boolean };
      let lead = await h.store.getLeadByPhone(b.telefone);
      if (!lead) lead = await h.store.upsertLeadByPhone({ phone: b.telefone, name: b.nome ?? null, source: "simulador" });
      const { session, opener } = await h.startCall(lead, b.motivo || "você pediu informações sobre o treino", b.receptiva ? "inbound" : "outbound");
      sessions.set(session.callId!, session);
      return { ligacaoId: session.callId, fala: opener, estado: await estado(b.telefone) };
    });

    r.post("/api/sim/ligacao/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as { texto: string; telefone: string };
      const s = sessions.get(id);
      if (!s) return reply.code(404).send({ error: "ligação encerrada" });
      const r2 = await e.handleVoiceTurn(s, b.texto);
      if (r2.hangup) {
        sessions.delete(id);
        await h.endCall(s);
      }
      return { fala: r2.say, desligou: r2.hangup, regra: r2.guard ?? null, tools: (r2.state?.toolLog ?? []).map((t) => ({ nome: t.name, entrada: t.input, resultado: t.result })), estado: await estado(b.telefone) };
    });

    r.post("/api/sim/ligacao/:id/encerrar", async (req) => {
      const { id } = req.params as { id: string };
      const s = sessions.get(id);
      if (s) {
        sessions.delete(id);
        await h.endCall(s);
      }
      return { ok: true };
    });

    // Avança o relógio e roda as cadências (lembretes, retomadas, ligações)
    r.post("/api/sim/tempo", async (req) => {
      const b = req.body as { avancar: string; telefone: string };
      const before = h.messenger.sent.length;
      const discadas = h.dialer.dialed.length;
      const n = await h.advance(b.avancar);
      return { executadas: n, respostas: sentSince(b.telefone, before), ligacoesNovas: h.dialer.dialed.length - discadas, estado: await estado(b.telefone), relogio: relogio() };
    });

    // Simula um evento da Hotmart
    r.post("/api/sim/hotmart", async (req) => {
      const { handleHotmart } = await import("../integrations/hotmart.js");
      const b = req.body as { telefone: string; nome?: string; evento: string; produto: "express" | "controle2" };
      const res = await handleHotmart(h.app.deps, {
        event: b.evento,
        data: {
          buyer: { name: b.nome, checkout_phone: b.telefone },
          product: { name: b.produto === "express" ? "Controle Express" : "Treino CONTROLE 2.0" },
          purchase: { transaction: `SIM-${Date.now()}`, price: { value: b.produto === "express" ? 47 : 397 }, origin: { sck: "f4-ia" } },
        },
      });
      return { resultado: res, estado: await estado(b.telefone) };
    });

    // Recomeça a conversa com um contato novo
    r.post("/api/sim/reset", async (req) => {
      const b = req.body as { telefone: string };
      const lead = await h.store.getLeadByPhone(b.telefone);
      if (lead) {
        h.store.leads.delete(lead.id);
        h.store.messages = h.store.messages.filter((m) => m.leadId !== lead.id);
        h.store.events = h.store.events.filter((x) => x.leadId !== lead.id);
        h.store.tasks = h.store.tasks.filter((x) => x.leadId !== lead.id);
        h.store.attempts = h.store.attempts.filter((x) => x.leadId !== lead.id);
        await h.scheduler.cancelForLead(lead.id);
      }
      return { ok: true };
    });
  });
}
