import { z } from "zod";
import type { Deps } from "../deps.js";
import { emit } from "../deps.js";
import { onLeadNovo, onPedidoLigacao } from "../queue/cadences.js";
import { normalizePhone } from "./hotmart.js";

/** Payload do quiz / landing pages. O checkbox de ligação vem com o texto exato exibido. */
export const LeadCaptureSchema = z.object({
  nome: z.string().min(1).max(120),
  telefone: z.string().min(8),
  email: z.string().email().optional().nullable(),
  origem: z.string().default("lp"), // "quiz", "lp-controle2", ...
  maior_de_18: z.boolean().default(true),
  aceita_ligacao: z.boolean().default(false),
  texto_consentimento_ligacao: z.string().optional(),
  aceita_whatsapp: z.boolean().default(true),
  quer_ligacao_agora: z.boolean().default(false),
});

export async function captureLead(deps: Deps, input: z.infer<typeof LeadCaptureSchema>) {
  const phone = normalizePhone(input.telefone);
  if (!phone) throw new Error("telefone inválido");
  if (!input.maior_de_18) return { ok: false as const, reason: "público somente maior de 18 anos" };

  const existing = await deps.store.getLeadByPhone(phone);
  const now = deps.now().toISOString();
  const callConsent =
    input.aceita_ligacao && input.texto_consentimento_ligacao
      ? { given: true, at: now, origin: input.origem, text: input.texto_consentimento_ligacao }
      : (existing?.callConsent ?? null);

  const lead = await deps.store.upsertLeadByPhone({
    phone,
    name: input.nome,
    email: input.email ?? existing?.email ?? null,
    source: existing?.source ?? input.origem,
    callConsent,
  });
  if (input.aceita_ligacao && input.texto_consentimento_ligacao) {
    await deps.store.addConsentLog({ leadId: lead.id, kind: "ligacao", granted: true, origin: input.origem, text: input.texto_consentimento_ligacao });
  }
  if (input.aceita_whatsapp) await deps.store.addConsentLog({ leadId: lead.id, kind: "whatsapp", granted: true, origin: input.origem, text: "Formulário com número de WhatsApp" });

  if (!existing) await deps.store.addEvent({ leadId: lead.id, type: "contato", channel: "whatsapp", data: { origem: input.origem } });
  if (input.aceita_whatsapp && !lead.optOutWhatsapp) await onLeadNovo(deps, lead);
  if (input.quer_ligacao_agora && callConsent?.given) await onPedidoLigacao(deps, lead, "lead pediu ligação no formulário");
  emit(deps, { type: "lead", leadId: lead.id });
  return { ok: true as const, leadId: lead.id };
}
