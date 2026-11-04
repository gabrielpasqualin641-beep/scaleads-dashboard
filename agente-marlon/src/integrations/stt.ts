import { config } from "../config.js";

/** Transcrição de áudio (PT-BR) pela Deepgram. O áudio não é armazenado. */
export async function transcribeAudio(data: Buffer, mime: string): Promise<string> {
  if (!config.DEEPGRAM_API_KEY) throw new Error("DEEPGRAM_API_KEY ausente");
  const r = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&language=pt-BR&smart_format=true&punctuate=true", {
    method: "POST",
    headers: { Authorization: `Token ${config.DEEPGRAM_API_KEY}`, "Content-Type": mime || "audio/ogg" },
    body: new Uint8Array(data),
  });
  if (!r.ok) throw new Error(`Deepgram ${r.status}`);
  const j = (await r.json()) as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } };
  return j.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
}
