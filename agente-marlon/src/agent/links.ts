import type { Channel, ProductCode } from "../domain/types.js";
import { loadProducts } from "./knowledge.js";

export const SCK = "f4-ia";

/**
 * Monta a URL de checkout com o rastreamento obrigatório:
 * sck=f4-ia + utm_source=agente + utm_medium=whatsapp|voz (+ utm_campaign opcional).
 */
export function buildCheckoutUrl(product: Exclude<ProductCode, "consulta">, channel: Channel, campaign?: string): string {
  const info = loadProducts()[product];
  if (!info.checkoutBase) throw new Error(`produto ${product} sem checkout`);
  return withTracking(info.checkoutBase, channel, campaign);
}

export function withTracking(base: string, channel: Channel, campaign?: string): string {
  const u = new URL(base);
  u.searchParams.set("sck", SCK);
  u.searchParams.set("utm_source", "agente");
  u.searchParams.set("utm_medium", channel);
  if (campaign) u.searchParams.set("utm_campaign", campaign);
  return u.toString();
}

const URL_RE = /https?:\/\/[^\s)>\]]+/g;

export function extractUrls(text: string): string[] {
  return text.match(URL_RE) ?? [];
}

/** Todo link de checkout/pagamento enviado precisa carregar sck=f4-ia. */
export function hasRequiredTracking(url: string): boolean {
  try {
    const u = new URL(url);
    return u.searchParams.get("sck") === SCK && u.searchParams.get("utm_source") === "agente";
  } catch {
    return false;
  }
}

export function isCheckoutUrl(url: string): boolean {
  return /pay\.hotmart\.com|mercadopago|mpago\.la/.test(url);
}
