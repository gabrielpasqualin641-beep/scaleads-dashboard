/**
 * Adaptador VoiceProvider. Três opções (VOICE_PROVIDER no .env):
 *  - vapi:           Vapi disca pela Twilio/0303 e usa o NOSSO backend como "custom LLM" (mesmo prompt, tools e guardrails).
 *  - retell:         Retell disca e conversa com o NOSSO backend pelo WebSocket de "custom LLM".
 *  - twilio_streams: Twilio Media Streams + Deepgram (STT) + ElevenLabs (TTS) operados por nós.
 * Em todos, quem decide o que falar é o mesmo Engine; o provedor só faz telefonia, STT e TTS.
 */
import twilio from "twilio";
import { config } from "../config.js";
import type { Deps, VoiceDialer } from "../deps.js";
import type { Engine } from "../agent/engine.js";
import { CLOSING_PHRASES, openSession, pickCallerId } from "./sessions.js";

export const VOICEMAIL_NEUTRO = "Oi, aqui é da equipe do Marlon Mattedi. A gente retorna depois. Obrigada!";

const e164 = (phone: string) => `+${phone.replace(/\D/g, "")}`;

export class VapiDialer implements VoiceDialer {
  name = "vapi";
  constructor(private engine: Engine) {}
  async dial({ lead, call, purpose }: Parameters<VoiceDialer["dial"]>[0]) {
    const phoneNumberId = pickCallerId(purpose, config.VAPI_PHONE_NUMBER_ID, config.VAPI_PHONE_NUMBER_ID_0303);
    const { opener } = openSession(this.engine, lead, call, "outbound");
    const voiceId = config.VOICE_GENDER === "masculina" ? config.VAPI_VOICE_ID_MASCULINA : config.VAPI_VOICE_ID_FEMININA;
    const r = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.VAPI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumberId,
        customer: { number: e164(lead.phone) },
        metadata: { callId: call.id, leadId: lead.id },
        assistant: {
          name: "Assistente equipe Marlon",
          firstMessage: opener,
          firstMessageMode: "assistant-speaks-first",
          model: { provider: "custom-llm", url: `${config.PUBLIC_BASE_URL}/voice/vapi`, model: "agente-marlon", metadata: { callId: call.id } },
          transcriber: { provider: "deepgram", model: "nova-3", language: "pt-BR", endpointing: 250 },
          voice: { provider: "11labs", voiceId, model: "eleven_flash_v2_5", language: "pt" },
          recordingEnabled: config.VOICE_RECORD_CALLS,
          endCallPhrases: CLOSING_PHRASES,
          // Caixa postal: recado neutro, sem citar o assunto.
          voicemailDetection: { provider: "twilio" },
          voicemailMessage: VOICEMAIL_NEUTRO,
          silenceTimeoutSeconds: 20,
          maxDurationSeconds: 900,
          server: { url: `${config.PUBLIC_BASE_URL}/voice/vapi/events`, secret: config.VAPI_WEBHOOK_SECRET },
        },
      }),
    });
    if (!r.ok) throw new Error(`Vapi ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { id: string };
    return { providerCallId: j.id };
  }
}

export class RetellDialer implements VoiceDialer {
  name = "retell";
  constructor(private engine: Engine) {}
  async dial({ lead, call, purpose }: Parameters<VoiceDialer["dial"]>[0]) {
    const from = pickCallerId(purpose, config.RETELL_FROM_NUMBER, config.RETELL_FROM_NUMBER_0303);
    openSession(this.engine, lead, call, "outbound");
    const r = await fetch("https://api.retellai.com/v2/create-phone-call", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.RETELL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from_number: e164(from), to_number: e164(lead.phone), override_agent_id: config.RETELL_AGENT_ID, metadata: { callId: call.id, leadId: lead.id } }),
    });
    if (!r.ok) throw new Error(`Retell ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { call_id: string };
    return { providerCallId: j.call_id };
  }
}

export class TwilioStreamsDialer implements VoiceDialer {
  name = "twilio_streams";
  private client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  constructor(private engine: Engine) {}
  async dial({ lead, call, purpose }: Parameters<VoiceDialer["dial"]>[0]) {
    const from = pickCallerId(purpose, config.TWILIO_NUMBER, config.TWILIO_NUMBER_0303);
    openSession(this.engine, lead, call, "outbound");
    const wss = config.PUBLIC_BASE_URL.replace(/^http/, "ws");
    const twiml = `<Response><Connect><Stream url="${wss}/voice/twilio/stream"><Parameter name="callId" value="${call.id}"/></Stream></Connect></Response>`;
    const c = await this.client.calls.create({
      to: e164(lead.phone),
      from: e164(from),
      twiml,
      record: config.VOICE_RECORD_CALLS,
      // Caixa postal: detectamos e deixamos só um recado neutro (rota /voice/twilio/amd).
      asyncAmd: "true",
      asyncAmdStatusCallback: `${config.PUBLIC_BASE_URL}/voice/twilio/amd`,
      statusCallback: `${config.PUBLIC_BASE_URL}/voice/twilio/status`,
      statusCallbackEvent: ["completed"],
    });
    return { providerCallId: c.sid };
  }
}

export function makeDialer(engine: Engine): VoiceDialer | null {
  switch (config.VOICE_PROVIDER) {
    case "vapi":
      return new VapiDialer(engine);
    case "retell":
      return new RetellDialer(engine);
    case "twilio_streams":
      return new TwilioStreamsDialer(engine);
    default:
      return null;
  }
}

export type { Deps };
