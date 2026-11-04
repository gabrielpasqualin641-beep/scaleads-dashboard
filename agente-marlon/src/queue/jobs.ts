import { DateTime } from "luxon";
import { config } from "../config.js";
import { firstName } from "../channels/messenger.js";
import { canContact, checkNaoMePerturbe } from "../compliance/rules.js";
import type { Channel, Lead } from "../domain/types.js";
import { emit, type Deps } from "../deps.js";
import { slotLabel } from "../integrations/calendar.js";
import { dailySummary, exportDailyCsv } from "../metrics/metrics.js";
import { sendWhatsAppSmart, sendWhatsAppTemplate } from "../agent/outbound.js";
import type { JobSpec } from "./scheduler.js";

const agent = () => config.AGENT_NAME;

/** Registra contexto interno (não enviado ao lead) para a IA saber por que o contato aconteceu. */
async function note(deps: Deps, lead: Lead, text: string) {
  await deps.store.addMessage({ leadId: lead.id, channel: "whatsapp", direction: "out", author: "system", text });
}

/** Executa um job de cadência. Toda regra de contato é verificada AQUI, no momento do envio. */
export async function runJob(deps: Deps, job: JobSpec): Promise<{ rescheduleAt?: Date } | void> {
  if (job.type === "resumo_diario") return void (await dailySummary(deps));
  if (job.type === "export_csv") return void (await exportDailyCsv(deps));
  if (job.type === "retencao_lgpd") {
    const cutoff = new Date(deps.now().getTime() - 90 * 24 * 3600 * 1000).toISOString();
    const r = await deps.store.purgeOlderThan(cutoff);
    console.log(`[lgpd] retenção 90 dias: ${r.messages} mensagens e ${r.calls} resumos de ligação removidos`);
    return;
  }

  if (!job.leadId) return;
  const lead = await deps.store.getLead(job.leadId);
  if (!lead) return;
  if (lead.aiPaused && job.type !== "lembrete_consulta") return; // humano assumiu o contato
  const channel: Channel = job.type === "ligacao" || job.type === "confirmacao_por_voz" ? "voz" : "whatsapp";
  const opportunity = job.opportunity ?? job.type;

  // Condições de negócio que tornam o contato desnecessário
  if (job.type === "retomada_carrinho" || (job.type === "ligacao" && opportunity.startsWith("carrinho:"))) {
    const tx = String(job.payload?.transaction ?? "");
    const purchases = await deps.store.listPurchases({ leadId: lead.id });
    if (purchases.some((p) => p.transaction === tx && p.status === "aprovada")) return;
  }
  if (job.type === "pos_venda" && job.step === "D+6" && lead.purchases.includes("controle_2")) return;
  let appt = null;
  if (job.type === "lembrete_consulta" || job.type === "confirmacao_por_voz") {
    appt = await deps.store.getAppointment(String(job.payload?.appointmentId));
    if (!appt || ["cancelada", "compareceu", "faltou"].includes(appt.status)) return;
    // Ligação só se a pessoa ainda não confirmou pelo WhatsApp.
    if (job.type === "confirmacao_por_voz" && appt.status === "confirmada") return;
  }

  if (channel === "voz" && !lead.naoMePerturbe && job.payload?.purpose !== "servico") {
    if (await checkNaoMePerturbe(lead.phone)) await deps.store.updateLead(lead.id, { naoMePerturbe: true });
  }
  const fresh = (await deps.store.getLead(lead.id))!;
  const kind = job.payload?.purpose === "servico" ? "servico" : "oferta";
  const decision = await canContact(deps.store, fresh, channel, opportunity, { at: deps.now(), kind });
  if (!decision.allowed) {
    if (decision.retryAt) return { rescheduleAt: decision.retryAt };
    console.log(`[cadência] ${job.type} para ${lead.id} bloqueado: ${decision.reason}`);
    return;
  }

  const nome = firstName(fresh);
  switch (job.type) {
    case "boas_vindas":
      await sendWhatsAppTemplate(deps, fresh, "boas_vindas", [nome, agent()]);
      await note(deps, fresh, `Boas-vindas enviadas (lead novo, origem ${fresh.source ?? "?"}). Se responder, faça a conexão e a descoberta.`);
      break;
    case "retomada_carrinho": {
      const produto = String(job.payload?.product ?? "");
      await sendWhatsAppSmart(deps, fresh, `Oi ${nome}, aqui é a ${agent()}, assistente virtual da equipe do Marlon Mattedi. Vi que ficou uma etapa pendente no seu pedido. Posso te ajudar com alguma dúvida?`, {
        name: "retomada_pedido",
        params: [nome, agent()],
      });
      await note(deps, fresh, `Retomada de pedido pendente (${produto}). Se responder, descubra a dúvida e, se fizer sentido, reenvie o link com enviar_link_checkout.`);
      break;
    }
    case "pos_venda": {
      const produto = String(job.payload?.product);
      await sendWhatsAppSmart(deps, fresh, `Oi ${nome}, aqui é a ${agent()}, assistente virtual da equipe do Marlon Mattedi. Passando para saber como você está com o seu acesso. Posso te ajudar em algo?`, {
        name: "acompanhamento",
        params: [nome, agent()],
      });
      const instr =
        produto === "controle_express"
          ? job.step === "D+6"
            ? "Pós-venda D+6 do Controle Express: pergunte como foram os exercícios e, se fizer sentido, apresente o Treino CONTROLE 2.0 como próximo passo (sem pressão)."
            : `Pós-venda ${job.step} do Controle Express: acompanhamento, tire dúvidas de acesso e incentive a prática.`
          : job.step === "D+21"
            ? "Pós-venda D+21 do CONTROLE 2.0: engajamento com os exercícios; se a pessoa relatar questões mais profundas, convide para a consulta com o Marlon."
            : `Pós-venda ${job.step} do CONTROLE 2.0: engajamento com os exercícios e dúvidas de acesso.`;
      await note(deps, fresh, instr);
      break;
    }
    case "lembrete_consulta": {
      if (!appt) return;
      const label = slotLabel(appt.start);
      await deps.messenger.sendTemplate(fresh.phone, { name: "lembrete_horario", params: [nome, label], buttonPayloads: [`confirmo:${appt.id}`, `remarcar:${appt.id}`] });
      await deps.store.addMessage({ leadId: fresh.id, channel: "whatsapp", direction: "out", author: "ai", text: `Lembrete do horário: ${label} (${job.step}). [Confirmo] [Preciso remarcar]`, meta: { template: "lembrete_horario" } });
      emit(deps, { type: "message", leadId: fresh.id });
      break;
    }
    case "retorno_combinado":
      await sendWhatsAppSmart(deps, fresh, `Oi ${nome}, aqui é a ${agent()}, assistente virtual da equipe do Marlon Mattedi, como combinamos. Podemos continuar de onde paramos?`, {
        name: "retorno_combinado",
        params: [nome, agent()],
      });
      await note(deps, fresh, `Retorno combinado: ${String(job.payload?.motivo ?? "")}. Retome do ponto em que pararam.`);
      break;
    case "ligacao":
    case "confirmacao_por_voz": {
      if (!deps.dialer) {
        console.warn("[voz] nenhum provedor de voz configurado; ligação não feita");
        return;
      }
      const purpose = kind;
      const reason = job.type === "confirmacao_por_voz" ? `confirmar a consulta de ${appt ? slotLabel(appt.start) : ""}` : String(job.payload?.motivo ?? "ligação consultiva");
      const pending = (await deps.store.listCalls({ leadId: fresh.id })).find((c) => c.status === "agendada");
      const call = pending
        ? await deps.store.updateCall(pending.id, { status: "discando", reason })
        : await deps.store.addCall({
            leadId: fresh.id, direction: "outbound", provider: deps.dialer.name, providerCallId: null, reason, status: "discando",
            recorded: config.VOICE_RECORD_CALLS, summary: null, durationSec: null, scheduledFor: null, startedAt: deps.now().toISOString(), endedAt: null,
          });
      try {
        const { providerCallId } = await deps.dialer.dial({ lead: fresh, call, purpose });
        await deps.store.updateCall(call.id, { providerCallId });
      } catch (e) {
        await deps.store.updateCall(call.id, { status: "falhou", summary: `Falha ao discar: ${(e as Error).message}` });
        throw e;
      }
      emit(deps, { type: "call", leadId: fresh.id, callId: call.id });
      break;
    }
    default:
      return;
  }
  await deps.store.addAttempt({ leadId: fresh.id, opportunity, channel });
  console.log(`[cadência] ${job.type}${job.step ? ` ${job.step}` : ""} → lead ${fresh.id} (${DateTime.fromJSDate(deps.now()).setZone(config.TZ_OPERACAO).toFormat("dd/MM HH:mm")})`);
}
