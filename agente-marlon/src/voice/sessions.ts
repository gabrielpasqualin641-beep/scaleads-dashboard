import { config } from "../config.js";
import type { Call, Lead } from "../domain/types.js";
import type { Engine, VoiceSession } from "../agent/engine.js";

/** Sessões de voz ativas (memória do processo). A transcrição vive só aqui e é descartada no fim. */
export const sessions = new Map<string, VoiceSession>(); // chave: nosso callId

export function openSession(engine: Engine, lead: Lead, call: Call, direction: "inbound" | "outbound") {
  const session: VoiceSession = {
    callId: call.id,
    providerCallId: call.providerCallId,
    leadId: lead.id,
    direction,
    reason: call.reason,
    recorded: config.VOICE_RECORD_CALLS,
    phase: "identidade",
    transcript: [],
    extraNotes: [],
  };
  const opener = engine.voiceOpener(session, lead);
  session.transcript.push(`ia: ${opener}`);
  sessions.set(call.id, session);
  return { session, opener };
}

export async function closeSession(engine: Engine, callId: string, durationSec?: number) {
  const s = sessions.get(callId);
  if (!s) return;
  sessions.delete(callId);
  await engine.endVoiceSession(s, durationSec);
}

/** Ligação ativa de oferta precisa sair por número 0303 (Anatel). */
export function pickCallerId(purpose: "oferta" | "servico", normal: string, n0303: string): string {
  if (purpose === "oferta") {
    if (!n0303) throw new Error("Ligação de oferta bloqueada: configure o número 0303 (regra da Anatel para telemarketing ativo).");
    return n0303;
  }
  if (!normal) throw new Error("Número de ligação não configurado.");
  return normal;
}

export const CLOSING_PHRASES = ["Eu retorno depois. Obrigada!", "Não vamos mais te ligar.", "não posso seguir com você por aqui"];
