import { DateTime } from "luxon";
import { config } from "../config.js";
import { isWithinContactWindow, nextContactWindow } from "../compliance/rules.js";
import type { Appointment, Lead, ProductCode } from "../domain/types.js";
import type { Deps } from "../deps.js";

const min = (n: number) => n * 60_000;
const at = (deps: Deps, ms: number) => new Date(deps.now().getTime() + ms);

/** Respeita a janela 9h-20h, seg-sáb: se cair fora, move para a próxima abertura. */
const inWindow = (d: Date) => nextContactWindow(d);

/** Lead novo (quiz/LP): boas-vindas no WhatsApp em até 2 minutos. */
export async function onLeadNovo(deps: Deps, lead: Lead) {
  await deps.scheduler.schedule({ type: "boas_vindas", leadId: lead.id, opportunity: "lead_novo" }, inWindow(at(deps, min(1))));
}

/** Lead pediu ligação: ligar em até 15 min, das 9h às 20h. */
export async function onPedidoLigacao(deps: Deps, lead: Lead, motivo = "lead pediu para falar com a equipe") {
  // Pedido repetido não gera ligação duplicada.
  await deps.scheduler.cancelForLead(lead.id, (j) => j.type === "ligacao" && j.opportunity === "pedido_ligacao");
  await deps.scheduler.schedule({ type: "ligacao", leadId: lead.id, opportunity: "pedido_ligacao", payload: { motivo, purpose: "oferta" } }, inWindow(at(deps, min(10))));
}

/** Link enviado e sem compra: um lembrete leve 3h depois (ajustado à janela de contato). */
export async function onLinkEnviado(deps: Deps, lead: Lead, product: ProductCode) {
  await cancelLinkSemCompra(deps, lead.id);
  await deps.scheduler.schedule({ type: "link_sem_compra", leadId: lead.id, opportunity: `link:${product}`, payload: { product } }, inWindow(at(deps, min(180))));
}

export async function cancelLinkSemCompra(deps: Deps, leadId: string) {
  await deps.scheduler.cancelForLead(leadId, (j) => j.type === "link_sem_compra");
}

/** Carrinho abandonado / boleto ou Pix gerado e não pago. */
export async function onCarrinho(deps: Deps, lead: Lead, transaction: string, product: ProductCode) {
  // A retomada de carrinho assume o acompanhamento do link.
  await cancelLinkSemCompra(deps, lead.id);
  const opportunity = `carrinho:${transaction}`;
  await deps.scheduler.schedule({ type: "retomada_carrinho", leadId: lead.id, opportunity, payload: { transaction, product } }, inWindow(at(deps, min(30))));
  // Voz em 24h, só com consentimento (verificado de novo na execução).
  await deps.scheduler.schedule(
    { type: "ligacao", leadId: lead.id, opportunity, payload: { motivo: "retomar dúvida do pedido pendente", purpose: "oferta", transaction } },
    inWindow(at(deps, min(24 * 60))),
  );
}

export async function cancelCarrinho(deps: Deps, leadId: string) {
  await deps.scheduler.cancelForLead(leadId, (j) => (j.opportunity ?? "").startsWith("carrinho:"));
}

/** Pós-venda. Express: D+1, D+3, D+6 (oferta do 2.0). CONTROLE 2.0: D+2, D+7, D+21 (convite para consulta). */
export async function onCompra(deps: Deps, lead: Lead, product: ProductCode) {
  const steps =
    product === "controle_express" ? ["D+1", "D+3", "D+6"] : product === "controle_2" ? ["D+2", "D+7", "D+21"] : [];
  const opportunity = product === "controle_express" ? "pos_express" : "pos_controle2";
  for (const step of steps) {
    const days = Number(step.slice(2));
    const when = DateTime.fromJSDate(deps.now()).setZone(config.TZ_OPERACAO).plus({ days }).set({ hour: 10, minute: 30 }).toJSDate();
    await deps.scheduler.schedule({ type: "pos_venda", leadId: lead.id, opportunity, step, payload: { product } }, inWindow(when));
  }
}

/** Consulta: lembretes D-1 e H-2; se não confirmar, ligação de confirmação (com consentimento). */
export async function onConsultaAgendada(deps: Deps, lead: Lead, appt: Appointment) {
  const start = DateTime.fromISO(appt.start);
  const opportunity = `consulta:${appt.id}`;
  const d1 = start.minus({ days: 1 }).setZone(config.TZ_OPERACAO).set({ hour: 10, minute: 0 }).toJSDate();
  const h2 = start.minus({ hours: 2 }).toJSDate();
  if (d1 > deps.now()) await deps.scheduler.schedule({ type: "lembrete_consulta", leadId: lead.id, opportunity, step: "D-1", payload: { appointmentId: appt.id } }, inWindow(d1));
  // H-2 e a ligação de confirmação só acontecem se caírem dentro da janela 9h-20h (senão, vale o lembrete D-1).
  if (h2 > deps.now() && isWithinContactWindow(h2)) await deps.scheduler.schedule({ type: "lembrete_consulta", leadId: lead.id, opportunity, step: "H-2", payload: { appointmentId: appt.id } }, h2);
  const voz = start.minus({ hours: 1, minutes: 30 }).toJSDate();
  if (voz > deps.now() && isWithinContactWindow(voz)) await deps.scheduler.schedule({ type: "confirmacao_por_voz", leadId: lead.id, opportunity, payload: { appointmentId: appt.id, purpose: "servico" } }, voz);
}

/** Retorno combinado com o lead ("posso te chamar amanhã?"). */
export async function onRetornoCombinado(deps: Deps, lead: Lead, when: Date, canal: "whatsapp" | "voz", motivo: string) {
  const type = canal === "voz" ? "ligacao" : "retorno_combinado";
  await deps.scheduler.schedule({ type, leadId: lead.id, opportunity: "retorno_combinado", payload: { motivo, purpose: "oferta" } }, inWindow(when));
}
