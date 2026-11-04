import type { FastifyInstance, FastifyRequest } from "fastify";
import twilio from "twilio";
import WebSocket from "ws";
import { config, isProd } from "../config.js";
import type { Engine } from "../agent/engine.js";
import { normalizePhone } from "../integrations/hotmart.js";
import { closeSession, openSession, sessions } from "./sessions.js";
import { VOICEMAIL_NEUTRO } from "./providers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function sessionFor(engine: Engine, ids: { callId?: string; providerCallId?: string }) {
  if (ids.callId && sessions.has(ids.callId)) return sessions.get(ids.callId)!;
  if (ids.providerCallId) {
    const call = await engine.deps.store.getCallByProviderId(ids.providerCallId);
    if (call && sessions.has(call.id)) return sessions.get(call.id)!;
  }
  return null;
}

/** Vapi: exige x-vapi-secret. Sem segredo configurado, só fora de produção. */
function vapiAuthorized(req: FastifyRequest) {
  if (!config.VAPI_WEBHOOK_SECRET) return !isProd();
  return req.headers["x-vapi-secret"] === config.VAPI_WEBHOOK_SECRET;
}

export function registerVoiceRoutes(app: FastifyInstance, engine: Engine) {
  const { store } = engine.deps;

  // ------------------------------------------------------------------ Vapi (custom LLM, formato OpenAI)
  app.post("/voice/vapi/chat/completions", async (req, reply) => {
    if (!vapiAuthorized(req)) return reply.code(401).send();
    const body = req.body as any;
    const callId = body?.call?.metadata?.callId ?? body?.metadata?.callId;
    const session = await sessionFor(engine, { callId, providerCallId: body?.call?.id });
    const lastUser = [...(body?.messages ?? [])].reverse().find((m: any) => m.role === "user")?.content ?? "";
    const { say } = session ? await engine.handleVoiceTurn(session, String(lastUser)) : { say: "Desculpa, tive um problema aqui. A equipe do Marlon retorna depois." };
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const chunk = (delta: object, finish: string | null) =>
      `data: ${JSON.stringify({ id: `c-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "agente-marlon", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    reply.raw.write(chunk({ role: "assistant", content: say }, null));
    reply.raw.write(chunk({}, "stop"));
    reply.raw.end("data: [DONE]\n\n");
    return reply;
  });

  app.post("/voice/vapi/events", async (req, reply) => {
    if (!vapiAuthorized(req)) return reply.code(401).send();
    const msg = (req.body as any)?.message ?? {};
    const callId = msg?.call?.metadata?.callId;
    if (msg.type === "end-of-call-report" && callId) {
      await closeSession(engine, callId, Math.round(Number(msg.durationSeconds ?? 0)));
      await store.updateCall(callId, { status: msg.endedReason === "customer-did-not-answer" ? "nao_atendida" : "concluida" }).catch(() => undefined);
    }
    if (msg.type === "status-update" && msg.status === "in-progress" && callId) await store.updateCall(callId, { status: "em_andamento" }).catch(() => undefined);
    return { ok: true };
  });

  // ------------------------------------------------------------------ Retell (custom LLM via WebSocket)
  // URL configurada na Retell: wss://SEU_HOST/voice/retell/llm/<RETELL_LLM_SECRET> (a Retell acrescenta /<call_id>).
  app.get("/voice/retell/llm/:secret/:retellCallId", { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    const { secret, retellCallId } = req.params as { secret: string; retellCallId: string };
    const expected = config.RETELL_LLM_SECRET;
    if ((!expected && isProd()) || (expected && secret !== expected)) {
      socket.close(1008, "não autorizado");
      return;
    }
    let sessionPromise = sessionFor(engine, { providerCallId: retellCallId });
    socket.on("message", async (raw: WebSocket.RawData) => {
      const ev = JSON.parse(raw.toString());
      if (ev.interaction_type === "call_details") {
        const callId = ev.call?.metadata?.callId;
        sessionPromise = sessionFor(engine, { callId, providerCallId: retellCallId });
        const s = await sessionPromise;
        const opener = s?.transcript[0]?.replace(/^ia: /, "") ?? "Oi! Aqui é da equipe do Marlon Mattedi.";
        socket.send(JSON.stringify({ response_type: "response", response_id: 0, content: opener, content_complete: true, end_call: false }));
        return;
      }
      if (ev.interaction_type !== "response_required" && ev.interaction_type !== "reminder_required") return;
      const s = await sessionPromise;
      const lastUser = [...(ev.transcript ?? [])].reverse().find((t: any) => t.role === "user")?.content ?? "";
      const r = s ? await engine.handleVoiceTurn(s, ev.interaction_type === "reminder_required" ? "(silêncio)" : lastUser) : { say: "A equipe do Marlon retorna depois. Obrigada!", hangup: true };
      socket.send(JSON.stringify({ response_type: "response", response_id: ev.response_id, content: r.say, content_complete: true, end_call: r.hangup }));
    });
  });

  app.post("/voice/retell/webhook", async (req, reply) => {
    const token = (req.query as any).token;
    if (isProd() ? !config.CRON_SECRET || token !== config.CRON_SECRET : Boolean(config.CRON_SECRET) && token !== config.CRON_SECRET) return reply.code(401).send();
    const b = req.body as any;
    if (b?.event === "call_ended" || b?.event === "call_analyzed") {
      const callId = b.call?.metadata?.callId;
      if (callId) {
        await closeSession(engine, callId, Math.round(Number(b.call?.duration_ms ?? 0) / 1000));
        await store.updateCall(callId, { status: "concluida" }).catch(() => undefined);
      }
    }
    return { ok: true };
  });

  // ------------------------------------------------------------------ Twilio Media Streams (STT/TTS próprios)
  const validTwilio = (req: FastifyRequest) => {
    if (!config.TWILIO_AUTH_TOKEN) return false;
    const sig = req.headers["x-twilio-signature"] as string | undefined;
    const url = `${config.PUBLIC_BASE_URL}${req.url}`;
    return Boolean(sig) && twilio.validateRequest(config.TWILIO_AUTH_TOKEN, sig!, url, (req.body ?? {}) as Record<string, string>);
  };

  // Ligação receptiva: o lead liga para o número da operação.
  app.post("/voice/twilio/inbound", async (req, reply) => {
    if (!validTwilio(req)) return reply.code(403).send();
    const b = req.body as Record<string, string>;
    const phone = normalizePhone(b.From) ?? b.From.replace(/\D/g, "");
    const lead = (await store.getLeadByPhone(phone)) ?? (await store.upsertLeadByPhone({ phone, source: "ligacao_receptiva" }));
    // Quem liga para nós está pedindo contato: registramos como consentimento para esta ligação.
    const call = await store.addCall({
      leadId: lead.id, direction: "inbound", provider: "twilio_streams", providerCallId: b.CallSid, reason: "ligação receptiva", status: "em_andamento",
      recorded: config.VOICE_RECORD_CALLS, summary: null, durationSec: null, scheduledFor: null, startedAt: new Date().toISOString(), endedAt: null,
    });
    openSession(engine, lead, call, "inbound");
    const wss = config.PUBLIC_BASE_URL.replace(/^http/, "ws");
    reply.type("text/xml");
    return `<Response><Connect><Stream url="${wss}/voice/twilio/stream"><Parameter name="callId" value="${call.id}"/></Stream></Connect></Response>`;
  });

  app.post("/voice/twilio/status", async (req, reply) => {
    if (!validTwilio(req)) return reply.code(403).send();
    const b = req.body as Record<string, string>;
    const call = await store.getCallByProviderId(b.CallSid);
    if (call) {
      await closeSession(engine, call.id, Number(b.CallDuration ?? 0));
      const status = b.CallStatus === "completed" ? (call.status === "outra_pessoa" ? "outra_pessoa" : "concluida") : "nao_atendida";
      await store.updateCall(call.id, { status, durationSec: Number(b.CallDuration ?? 0) });
    }
    return { ok: true };
  });

  // Caixa postal detectada: recado neutro e desliga.
  app.post("/voice/twilio/amd", async (req, reply) => {
    if (!validTwilio(req)) return reply.code(403).send();
    const b = req.body as Record<string, string>;
    if (String(b.AnsweredBy ?? "").startsWith("machine")) {
      const client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
      await client.calls(b.CallSid).update({ twiml: `<Response><Say language="pt-BR">${VOICEMAIL_NEUTRO}</Say><Hangup/></Response>` });
      const call = await store.getCallByProviderId(b.CallSid);
      if (call) await store.updateCall(call.id, { status: "nao_atendida", summary: "Caixa postal: recado neutro deixado." });
    }
    return { ok: true };
  });

  app.get("/voice/twilio/stream", { websocket: true }, (socket: WebSocket) => {
    new TwilioStreamBridge(socket, engine).start();
  });
}

/**
 * Ponte Twilio ⇄ Deepgram (STT ao vivo) ⇄ Engine ⇄ ElevenLabs (TTS µ-law 8 kHz).
 * Latência: endpointing de 250 ms + resposta do modelo (esforço baixo, sem raciocínio na voz) + TTS em streaming.
 */
class TwilioStreamBridge {
  private streamSid = "";
  private callSid = "";
  private callId = "";
  private dg: WebSocket | null = null;
  private speaking = false;
  private pending = "";
  private hangupAfterSpeech = false;
  private busy = false;

  constructor(
    private twilioWs: WebSocket,
    private engine: Engine,
  ) {}

  start() {
    this.twilioWs.on("message", (raw) => this.onTwilio(JSON.parse(raw.toString())));
    this.twilioWs.on("close", () => this.dg?.close());
  }

  private async onTwilio(msg: any) {
    if (msg.event === "start") {
      this.streamSid = msg.start.streamSid;
      this.callSid = msg.start.callSid;
      this.callId = msg.start.customParameters?.callId ?? "";
      const s = sessions.get(this.callId);
      if (s && !s.providerCallId) s.providerCallId = this.callSid;
      this.openDeepgram();
      const opener = s?.transcript[0]?.replace(/^ia: /, "");
      if (opener) await this.speak(opener);
    } else if (msg.event === "media") {
      if (this.dg?.readyState === WebSocket.OPEN) this.dg.send(Buffer.from(msg.media.payload, "base64"));
    } else if (msg.event === "mark" && msg.mark?.name === "fim-fala") {
      this.speaking = false;
      if (this.hangupAfterSpeech) {
        const client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
        await client.calls(this.callSid).update({ status: "completed" }).catch(() => undefined);
      }
    } else if (msg.event === "stop") {
      this.dg?.close();
    }
  }

  private openDeepgram() {
    const url = "wss://api.deepgram.com/v1/listen?model=nova-3&language=pt-BR&encoding=mulaw&sample_rate=8000&interim_results=true&endpointing=250&vad_events=true&smart_format=true";
    this.dg = new WebSocket(url, { headers: { Authorization: `Token ${config.DEEPGRAM_API_KEY}` } });
    this.dg.on("message", async (raw) => {
      const ev = JSON.parse(raw.toString());
      if (ev.type === "SpeechStarted" && this.speaking) {
        // Interrupção (barge-in): para a fala atual.
        this.twilioWs.send(JSON.stringify({ event: "clear", streamSid: this.streamSid }));
        this.speaking = false;
      }
      if (ev.type !== "Results") return;
      const text: string = ev.channel?.alternatives?.[0]?.transcript ?? "";
      if (ev.is_final && text) this.pending = `${this.pending} ${text}`.trim();
      if (ev.speech_final && this.pending && !this.busy) {
        const heard = this.pending;
        this.pending = "";
        this.busy = true;
        try {
          const s = sessions.get(this.callId);
          if (!s) return;
          const r = await this.engine.handleVoiceTurn(s, heard);
          this.hangupAfterSpeech = r.hangup;
          if (r.say) await this.speak(r.say);
        } finally {
          this.busy = false;
        }
      }
    });
  }

  private async speak(text: string) {
    const voice = config.VOICE_GENDER === "masculina" ? config.ELEVENLABS_VOICE_ID_MASCULINA : config.ELEVENLABS_VOICE_ID_FEMININA;
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=ulaw_8000&optimize_streaming_latency=3`, {
      method: "POST",
      headers: { "xi-api-key": config.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", language_code: "pt" }),
    });
    if (!r.ok || !r.body) return;
    this.speaking = true;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!this.speaking) break; // interrompido
      this.twilioWs.send(JSON.stringify({ event: "media", streamSid: this.streamSid, media: { payload: Buffer.from(value).toString("base64") } }));
    }
    this.twilioWs.send(JSON.stringify({ event: "mark", streamSid: this.streamSid, mark: { name: "fim-fala" } }));
  }
}
