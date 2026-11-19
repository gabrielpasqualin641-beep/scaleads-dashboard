import { config } from "../config.js";

export type AudioFormat = "ogg_opus" | "mp3";

export interface TtsProvider {
  name: string;
  synthesize(text: string, format: AudioFormat): Promise<{ data: Buffer; mime: string }>;
}

/** Voz neural da ElevenLabs (a mesma da ligação). A chave fica só no servidor. */
export class ElevenLabsTts implements TtsProvider {
  name = "elevenlabs";
  async synthesize(text: string, format: AudioFormat) {
    const voz = (config.VOICE_GENDER === "masculina" ? config.ELEVENLABS_VOICE_ID_MASCULINA : config.ELEVENLABS_VOICE_ID_FEMININA) || "EXAVITQu4vr4xnSDxMaL";
    const output = format === "ogg_opus" ? "opus_48000_64" : "mp3_44100_128";
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=${output}`, {
      method: "POST",
      headers: { "xi-api-key": config.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.slice(0, 1200),
        model_id: config.ELEVENLABS_TTS_MODEL,
        language_code: "pt",
        voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { data: Buffer.from(await res.arrayBuffer()), mime: format === "ogg_opus" ? "audio/ogg" : "audio/mpeg" };
  }
}

/** Voz falsa para testes e para o simulador sem chave (não toca nada; só registra o envio). */
export class FakeTts implements TtsProvider {
  name = "fake";
  async synthesize(_text: string, format: AudioFormat) {
    return { data: Buffer.from("AUDIO-DE-TESTE"), mime: format === "ogg_opus" ? "audio/ogg" : "audio/mpeg" };
  }
}

export function makeTts(): TtsProvider | null {
  return config.ELEVENLABS_API_KEY ? new ElevenLabsTts() : null;
}

/** Ajusta o texto para soar natural falado (sem links, emojis, marcadores; preços por extenso). */
export function textoParaFala(t: string): string {
  return t
    .replace(/\[\[audio\]\]/gi, "")
    .replace(/\s*\|\|\|\s*/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/R\$\s?(\d+),(\d{2})/g, (_, r, c) => `${r} reais${Number(c) ? ` e ${Number(c)} centavos` : ""}`)
    .replace(/R\$\s?(\d+)/g, "$1 reais")
    .replace(/\b(\d+)x\b/gi, "$1 vezes")
    .replace(/CONTROLE 2\.0/gi, "Controle dois ponto zero")
    .replace(/\s+/g, " ")
    .trim();
}
