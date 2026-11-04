import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import type { Lead, ProductCode, Purchase } from "../domain/types.js";
import { emit, type Deps } from "../deps.js";
import { cancelCarrinho, onCarrinho, onCompra } from "../queue/cadences.js";
import { notifyTeam } from "../agent/outbound.js";

export function verifyHottok(received: string | undefined): boolean {
  const expected = config.HOTMART_HOTTOK;
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Normaliza telefone para E.164 brasileiro sem "+": 55 + DDD + número. */
export function normalizePhone(raw: string | null | undefined, ddi = "55"): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = ddi + d;
  return d.length >= 12 ? d : null;
}

function productCode(id: unknown, name: unknown): ProductCode | null {
  const sid = String(id ?? "");
  if (config.HOTMART_PRODUCT_ID_EXPRESS && sid === config.HOTMART_PRODUCT_ID_EXPRESS) return "controle_express";
  if (config.HOTMART_PRODUCT_ID_CONTROLE2 && sid === config.HOTMART_PRODUCT_ID_CONTROLE2) return "controle_2";
  const n = String(name ?? "").toLowerCase();
  if (n.includes("express")) return "controle_express";
  if (n.includes("controle")) return "controle_2";
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface HotmartResult {
  handled: boolean;
  event: string;
  leadId?: string;
  reason?: string;
}

/**
 * Webhook Hotmart (v2). Eventos:
 * PURCHASE_APPROVED/COMPLETE → compra; PURCHASE_OUT_OF_SHOPPING_CART → abandono;
 * PURCHASE_BILLET_PRINTED (boleto/Pix gerado) → aguardando pagamento;
 * PURCHASE_REFUNDED/CHARGEBACK → reembolso; PURCHASE_CANCELED → cancelado; PURCHASE_PROTEST → pedido de reembolso.
 */
export async function handleHotmart(deps: Deps, body: any): Promise<HotmartResult> {
  const event = String(body?.event ?? "");
  const data = body?.data ?? {};
  const buyer = data.buyer ?? {};
  const phone = normalizePhone(buyer.checkout_phone ?? buyer.phone ?? data.phone);
  const email: string | null = buyer.email ?? null;
  const product = productCode(data.product?.id, data.product?.name);
  const transaction = String(data.purchase?.transaction ?? data.purchase?.transaction_id ?? body?.id ?? "");
  const value = Number(data.purchase?.price?.value ?? data.purchase?.full_price?.value ?? 0);
  const sck: string | null = data.purchase?.origin?.sck ?? data.purchase?.sck ?? null;

  if (!product) return { handled: false, event, reason: "produto não reconhecido" };

  let lead: Lead | null = phone ? await deps.store.getLeadByPhone(phone) : null;
  if (!lead && email) lead = await deps.store.getLeadByEmail(email);
  if (!lead && phone) {
    lead = await deps.store.upsertLeadByPhone({ phone, name: buyer.name ?? null, email, source: "hotmart" });
    await deps.store.addEvent({ leadId: lead.id, type: "contato", channel: null, data: { origem: "hotmart", evento: event } });
  }
  if (!lead) return { handled: false, event, reason: "sem telefone/e-mail para vincular" };
  if (email && !lead.email) lead = await deps.store.updateLead(lead.id, { email });

  const save = (status: Purchase["status"]) =>
    deps.store.upsertPurchase({ leadId: lead!.id, product, transaction: transaction || `${event}-${Date.now()}`, status, value, sck });

  switch (event) {
    case "PURCHASE_APPROVED":
    case "PURCHASE_COMPLETE": {
      const existing = (await deps.store.listPurchases({ leadId: lead.id })).find((p) => p.transaction === transaction && p.status === "aprovada");
      await save("aprovada");
      await cancelCarrinho(deps, lead.id);
      if (!existing) {
        const purchases = Array.from(new Set([...lead.purchases, product]));
        lead = await deps.store.updateLead(lead.id, { purchases, stage: "comprou" });
        await deps.store.addEvent({ leadId: lead.id, type: "compra", channel: sck === "f4-ia" ? attributedChannel(data) : null, data: { produto: product, valor: value, sck, transaction } });
        await onCompra(deps, lead, product);
      }
      break;
    }
    case "PURCHASE_OUT_OF_SHOPPING_CART":
      await save("abandonada");
      await onCarrinho(deps, lead, transaction || `abandono-${lead.id}-${product}`, product);
      break;
    case "PURCHASE_BILLET_PRINTED":
    case "PURCHASE_DELAYED":
      await save("aguardando_pagamento");
      await onCarrinho(deps, lead, transaction, product);
      break;
    case "PURCHASE_REFUNDED":
    case "PURCHASE_CHARGEBACK":
      await save("reembolsada");
      await deps.scheduler.cancelForLead(lead.id, (j) => j.type === "pos_venda");
      await deps.store.updateLead(lead.id, { purchases: lead.purchases.filter((p) => p !== product) });
      await deps.store.addEvent({ leadId: lead.id, type: "reembolso", channel: null, data: { produto: product, valor: value } });
      break;
    case "PURCHASE_CANCELED":
      await save("cancelada");
      await cancelCarrinho(deps, lead.id);
      break;
    case "PURCHASE_PROTEST": {
      // Pedido de reembolso: humano cuida; a IA nunca tenta reverter.
      const task = await deps.store.addTask({ leadId: lead.id, reason: "pedido de reembolso (Hotmart)", urgency: "media" });
      await deps.store.updateLead(lead.id, { aiPaused: true, pausedBy: "transferencia" });
      await deps.scheduler.cancelForLead(lead.id, (j) => j.type === "pos_venda");
      await notifyTeam(deps, lead, "pedido de reembolso (Hotmart)", "media");
      emit(deps, { type: "task", leadId: lead.id, taskId: task.id });
      break;
    }
    default:
      return { handled: false, event, leadId: lead.id, reason: "evento ignorado" };
  }
  emit(deps, { type: "lead", leadId: lead.id });
  return { handled: true, event, leadId: lead.id };
}

function attributedChannel(data: any): "whatsapp" | "voz" {
  const src = String(data?.purchase?.origin?.src ?? data?.purchase?.origin?.xcod ?? "");
  return src.includes("voz") ? "voz" : "whatsapp";
}
