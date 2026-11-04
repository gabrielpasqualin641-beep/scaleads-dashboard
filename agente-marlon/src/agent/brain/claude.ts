import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config.js";
import type { Message } from "../../domain/types.js";
import { loadSystemPrompt } from "../knowledge.js";
import { runTool, TOOL_DEFS } from "../tools.js";
import type { Brain, BrainInput, BrainOutput } from "./types.js";

type BParam = Anthropic.Beta.BetaMessageParam;

const CHANNEL_ADDENDUM = {
  whatsapp: "\n\n# Canal desta conversa\nWhatsApp. Responda em 2 a 4 linhas, uma pergunta por mensagem.",
  voz: "\n\n# Canal desta conversa\nLigação telefônica. Frases de até 20 palavras, uma ideia por vez, sem listas e sem links falados. Para mandar link, use a ferramenta e diga que mandou no WhatsApp. Responda só com o que será falado.",
};

/** Converte o histórico em mensagens da API (lead → user; IA/humano/template → assistant). */
export function toApiMessages(history: Message[]): BParam[] {
  const out: BParam[] = [];
  for (const m of history) {
    if (m.author === "system") continue; // contexto interno vai nas notas do turno
    const role = m.author === "lead" ? "user" : "assistant";
    const prefix = m.author === "human" ? "[mensagem enviada pela equipe humana] " : "";
    const text = `${prefix}${m.text}`.trim() || "(mensagem vazia)";
    const last = out[out.length - 1];
    if (last && last.role === role && typeof last.content === "string") last.content = `${last.content}\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export class ClaudeBrain implements Brain {
  name = "claude";
  private client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
  private systemPrompt = loadSystemPrompt(config.AGENT_NAME);

  private async create(params: Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, "model">) {
    const fallbacks = config.ANTHROPIC_FALLBACKS;
    return this.client.beta.messages.create({
      model: config.ANTHROPIC_MODEL,
      ...params,
      ...(fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
  }

  async respond(input: BrainInput): Promise<BrainOutput> {
    const { channel } = input;
    const messages: BParam[] = toApiMessages(input.history);
    if (!messages.length) messages.push({ role: "user", content: "(início da conversa)" });
    // Contexto do turno como mensagem de sistema no meio da conversa: não invalida o cache do prefixo.
    messages.push({ role: "system", content: input.notes.join("\n") } as BParam);

    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: "text", text: this.systemPrompt + CHANNEL_ADDENDUM[channel], cache_control: { type: "ephemeral" } },
    ];
    const texts: string[] = [];

    for (let i = 0; i < 6; i++) {
      const resp = await this.create({
        max_tokens: channel === "voz" ? 1024 : 4096,
        system,
        tools: TOOL_DEFS as unknown as Anthropic.Beta.BetaTool[],
        tool_choice: { type: "auto" },
        thinking: channel === "voz" ? { type: "between_tools" } : { type: "adaptive" },
        output_config: { effort: config.ANTHROPIC_EFFORT },
        messages,
      });

      if (resp.stop_reason === "refusal") return { text: "", refused: true };

      const toolUses = resp.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      for (const b of resp.content) if (b.type === "text" && b.text.trim()) texts.push(b.text.trim());

      if (resp.stop_reason !== "tool_use" || !toolUses.length) break;

      messages.push({ role: "assistant", content: resp.content as Anthropic.Beta.BetaContentBlockParam[] });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        try {
          const r = await runTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, input.toolCtx);
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(r) });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: `erro: ${(e as Error).message}`, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
      // Depois de pausar a IA (transferência) a próxima resposta é a última.
      texts.length = 0;
    }
    return { text: texts.join("\n\n") };
  }

  async summarize(lines: string[], previous: string): Promise<string> {
    const resp = await this.create({
      max_tokens: 1024,
      output_config: { effort: "low" },
      system: [
        {
          type: "text",
          text:
            "Você resume conversas comerciais para a equipe do Marlon Mattedi. Escreva no máximo 5 linhas, em português, sem citar detalhes íntimos ou de saúde além do mínimo para a venda (ex.: 'interesse no CONTROLE 2.0; objeção: preço; pediu retorno amanhã'). Não copie falas.",
        },
      ],
      messages: [{ role: "user", content: `Resumo anterior:\n${previous || "(nenhum)"}\n\nNovos trechos:\n${lines.join("\n")}` }],
    });
    const t = resp.content.find((b) => b.type === "text");
    return t && t.type === "text" ? t.text.trim() : previous;
  }
}
