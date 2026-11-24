import { config } from "../../config.js";
import type { Message } from "../../domain/types.js";
import { loadSystemPrompt } from "../knowledge.js";
import { runTool, TOOL_DEFS } from "../tools.js";
import type { Brain, BrainInput, BrainOutput } from "./types.js";

/**
 * Cérebro alternativo usando a API Gemini (Google AI Studio).
 * Mesma "mente" do ClaudeBrain: mesmo system prompt, mesmas ferramentas e o mesmo
 * loop de tool-calling. Troca só o provedor do modelo. Ligue com BRAIN=gemini e GEMINI_API_KEY.
 *
 * API: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=...
 */

const CHANNEL_ADDENDUM = {
  whatsapp:
    "\n\n# Canal desta conversa\nWhatsApp. Responda com 1 a 3 mensagens curtas separadas por ||| (no máximo 2 frases cada) e uma pergunta por resposta.",
  voz: "\n\n# Canal desta conversa\nLigação telefônica. Frases de até 20 palavras, uma ideia por vez, sem listas e sem links falados. Para mandar link, use a ferramenta e diga que mandou no WhatsApp. Responda só com o que será falado.",
};

type GPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };
type GContent = { role: "user" | "model"; parts: GPart[] };

/** Converte o histórico interno em "contents" do Gemini (lead → user; IA/humano/template → model). */
function toContents(history: Message[]): GContent[] {
  const out: GContent[] = [];
  for (const m of history) {
    if (m.author === "system") continue; // contexto interno entra nas notas do turno
    const role: "user" | "model" = m.author === "lead" ? "user" : "model";
    const prefix = m.author === "human" ? "[mensagem enviada pela equipe humana] " : "";
    const text = `${prefix}${m.text}`.trim() || "(mensagem vazia)";
    const last = out[out.length - 1];
    if (last && last.role === role && "text" in last.parts[last.parts.length - 1]) {
      (last.parts[last.parts.length - 1] as { text: string }).text += `\n${text}`;
    } else {
      out.push({ role, parts: [{ text }] });
    }
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

/** Gemini não aceita os campos específicos da Anthropic (strict, additionalProperties). Limpa o schema. */
function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === "additionalProperties" || k === "$schema") continue;
      out[k] = cleanSchema(v);
    }
    return out;
  }
  return schema;
}

const FUNCTION_DECLARATIONS = TOOL_DEFS.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: cleanSchema(t.input_schema),
}));

export class GeminiBrain implements Brain {
  name = "gemini";
  private systemPrompt = loadSystemPrompt(config.AGENT_NAME);
  private endpoint = "https://generativelanguage.googleapis.com/v1beta/models";

  private async generate(body: Record<string, unknown>): Promise<GPart[]> {
    const url = `${this.endpoint}/${config.GEMINI_MODEL}:generateContent`;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": config.GEMINI_API_KEY },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
        if (!res.ok) throw Object.assign(new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`), { fatal: true });
        const json = (await res.json()) as {
          candidates?: { content?: { parts?: GPart[] } }[];
          promptFeedback?: { blockReason?: string };
        };
        if (json.promptFeedback?.blockReason) throw Object.assign(new Error(`bloqueado: ${json.promptFeedback.blockReason}`), { fatal: true });
        return json.candidates?.[0]?.content?.parts ?? [];
      } catch (e) {
        lastErr = e as Error;
        if ((e as { fatal?: boolean }).fatal) throw lastErr;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw lastErr ?? new Error("Gemini: falha desconhecida");
  }

  async respond(input: BrainInput): Promise<BrainOutput> {
    const { channel } = input;
    const contents = toContents(input.history);
    if (!contents.length) contents.push({ role: "user", parts: [{ text: "(início da conversa)" }] });
    // Contexto do turno (etapa do lead, regras ativadas) como última mensagem do usuário.
    if (input.notes.length) contents.push({ role: "user", parts: [{ text: `[contexto interno]\n${input.notes.join("\n")}` }] });

    const systemInstruction = { parts: [{ text: this.systemPrompt + CHANNEL_ADDENDUM[channel] }] };
    const tools = [{ functionDeclarations: FUNCTION_DECLARATIONS }];
    const generationConfig = { maxOutputTokens: channel === "voz" ? 1024 : 4096, temperature: 0.7 };

    const texts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const parts = await this.generate({ contents, systemInstruction, tools, generationConfig });

      const calls = parts.filter((p): p is Extract<GPart, { functionCall: unknown }> => "functionCall" in p);
      for (const p of parts) if ("text" in p && p.text.trim()) texts.push(p.text.trim());

      if (!calls.length) break;

      contents.push({ role: "model", parts });
      const responses: GPart[] = [];
      for (const c of calls) {
        try {
          const r = await runTool(c.functionCall.name, (c.functionCall.args ?? {}) as Record<string, unknown>, input.toolCtx);
          responses.push({ functionResponse: { name: c.functionCall.name, response: { resultado: r } } });
        } catch (e) {
          responses.push({ functionResponse: { name: c.functionCall.name, response: { erro: (e as Error).message } } });
        }
      }
      contents.push({ role: "user", parts: responses });
      // Depois de pausar a IA (transferência) a próxima resposta é a última.
      texts.length = 0;
    }
    return { text: texts.join("\n\n") };
  }

  async summarize(lines: string[], previous: string): Promise<string> {
    const parts = await this.generate({
      systemInstruction: {
        parts: [
          {
            text: "Você resume conversas comerciais para a equipe do Marlon Mattedi. Escreva no máximo 5 linhas, em português, sem citar detalhes íntimos ou de saúde além do mínimo para a venda (ex.: 'interesse no CONTROLE 2.0; objeção: preço; pediu retorno amanhã'). Não copie falas.",
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: `Resumo anterior:\n${previous || "(nenhum)"}\n\nNovos trechos:\n${lines.join("\n")}` }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
    });
    const t = parts.find((p) => "text" in p) as { text: string } | undefined;
    return t ? t.text.trim() : previous;
  }
}
