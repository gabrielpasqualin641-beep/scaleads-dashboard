import { config } from "../config.js";

export interface PaymentLinkProvider {
  createConsultaLink(input: { appointmentId: string; leadName: string | null; email: string | null }): Promise<string>;
}

/** Mercado Pago Checkout Pro: um link por agendamento (R$900, sessão de 50 min). */
export class MercadoPagoLinks implements PaymentLinkProvider {
  async createConsultaLink(input: { appointmentId: string; email: string | null }) {
    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.MERCADOPAGO_ACCESS_TOKEN}`, "Content-Type": "application/json", "X-Idempotency-Key": input.appointmentId },
      body: JSON.stringify({
        // Descrição neutra: aparece no comprovante.
        items: [{ id: "sessao-50", title: "Sessão online (50 min) - Marlon Mattedi", quantity: 1, unit_price: 900, currency_id: "BRL" }],
        payer: input.email ? { email: input.email } : undefined,
        external_reference: input.appointmentId,
        metadata: { sck: "f4-ia" },
        expires: true,
        expiration_date_to: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      }),
    });
    if (!r.ok) throw new Error(`Mercado Pago ${r.status}`);
    const j = (await r.json()) as { init_point: string };
    return j.init_point;
  }
}

/** Link fixo configurado no .env (ex.: link de pagamento avulso). */
export class ManualLinks implements PaymentLinkProvider {
  async createConsultaLink(input: { appointmentId: string }) {
    const base = config.CONSULTA_PAYMENT_LINK_MANUAL || "https://pagamento.exemplo.com/consulta";
    const u = new URL(base);
    u.searchParams.set("ref", input.appointmentId);
    return u.toString();
  }
}

export function makePaymentProvider(): PaymentLinkProvider {
  return config.CONSULTA_PAYMENT_PROVIDER === "mercadopago" ? new MercadoPagoLinks() : new ManualLinks();
}
