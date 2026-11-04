import type { Channel, Lead, Message } from "../../domain/types.js";
import type { ToolContext } from "../tools.js";

export interface BrainInput {
  lead: Lead;
  channel: Channel;
  history: Message[]; // inclui a mensagem atual do lead como último item
  notes: string[]; // instruções de sistema do turno (contexto do lead, regras ativadas)
  toolCtx: ToolContext;
}

export interface BrainOutput {
  text: string;
  refused?: boolean;
}

export interface Brain {
  name: string;
  respond(input: BrainInput): Promise<BrainOutput>;
  /** Resumo curto (LGPD: guardamos resumo, não transcrição). */
  summarize(lines: string[], previous: string): Promise<string>;
}
