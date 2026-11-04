import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import type { App } from "../app.js";
import { parseWhatsAppWebhook, verifyMetaSignature, WhatsAppCloudMessenger } from "../channels/whatsapp.js";
import { handleHotmart, verifyHottok } from "../integrations/hotmart.js";
import { captureLead, LeadCaptureSchema } from "../integrations/leads.js";
import { transcribeAudio } from "../integrations/stt.js";
import { sendWhatsAppText } from "../agent/outbound.js";

const seen = new Set<string>();
function dedupe(id: string) {
  if (seen.has(id)) return true;
  seen.add(id);
  if (seen.size > 5000) seen.delete(seen.values().next().value!);
  return false;
}

// Fila simples por contato: mensagens do mesmo lead são processadas em ordem.
const chains = new Map<string, Promise<unknown>>();
function serial(key: string, fn: () => Promise<unknown>) {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn).catch((e) => console.error("[whatsapp] erro ao processar:", e));
  chains.set(key, next);
  next.finally(() => chains.get(key) === next && chains.delete(key));
  return next;
}

export function registerWebhooks(server: FastifyInstance, app: App) {
  const { engine, deps } = app;

  // Verificação do webhook pela Meta
  server.get("/webhooks/whatsapp", async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q["hub.mode"] === "subscribe" && config.WA_VERIFY_TOKEN && q["hub.verify_token"] === config.WA_VERIFY_TOKEN) {
      return reply.type("text/plain").send(q["hub.challenge"]);
    }
    return reply.code(403).send();
  });

  server.post("/webhooks/whatsapp", async (req, reply) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!raw || !verifyMetaSignature(raw, req.headers["x-hub-signature-256"] as string | undefined)) {
      return reply.code(401).send({ error: "assinatura inválida" });
    }
    const messages = parseWhatsAppWebhook(req.body);
    reply.code(200).send({ ok: true }); // responde rápido; processa em seguida
    for (const m of messages) {
      if (dedupe(m.waMessageId)) continue;
      void serial(m.from, async () => {
        const wa = deps.messenger instanceof WhatsAppCloudMessenger ? deps.messenger : null;
        await wa?.markRead(m.waMessageId);
        let text = m.text;
        let transcribed = false;
        if (m.type === "audio" && m.audioMediaId && wa) {
          try {
            const media = await wa.downloadMedia(m.audioMediaId);
            text = await transcribeAudio(media.data, media.mime);
            transcribed = true;
          } catch (e) {
            console.error("[stt] falha:", (e as Error).message);
          }
          if (!text) {
            const lead = await deps.store.getLeadByPhone(m.from);
            if (lead && !lead.aiPaused) await sendWhatsAppText(deps, lead, "Não consegui ouvir seu áudio aqui. Pode me escrever, por favor?");
            return;
          }
        }
        if (m.type === "other") return;
        const source = m.referral ? `ctwa:${m.referral.source_id ?? m.referral.source_type ?? "anuncio"}` : undefined;
        await engine.handleWhatsApp({ from: m.from, name: m.name, text, replyId: m.replyId, source, transcribed, adHeadline: m.referral?.headline });
      });
    }
    return reply;
  });

  server.post("/webhooks/hotmart", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const hottok = (req.headers["x-hotmart-hottok"] as string | undefined) ?? (body?.hottok as string | undefined);
    if (!verifyHottok(hottok)) return reply.code(401).send({ error: "hottok inválido" });
    const r = await handleHotmart(deps, body);
    return r;
  });

  // Quiz / landing pages
  server.post("/webhooks/lead", async (req, reply) => {
    if (!config.LEAD_WEBHOOK_SECRET || req.headers["x-webhook-secret"] !== config.LEAD_WEBHOOK_SECRET) return reply.code(401).send();
    const parsed = LeadCaptureSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    return captureLead(deps, parsed.data);
  });
}
