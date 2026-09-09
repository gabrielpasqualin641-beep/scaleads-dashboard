import { fetchLeads, listLeadFields, isConfigured, KommoError, redact } from '../integrations/kommo/client.js';
import { kommoMqlStore, DailyMql } from '../integrations/kommo/mqlStore.js';
import { qualify, MQL_THRESHOLD } from '../integrations/kommo/qualification.js';

/**
 * Traz do Kommo a contagem diária de MQL.
 *
 * Uma conta de anúncios só recebe MQL se estiver apontada para o CRM em
 * `KOMMO_ACCOUNT_ID` — o CRM é de um cliente só, e atribuir os mesmos leads a
 * várias contas contaria o mesmo MQL mais de uma vez.
 *
 * Atribuição por campanha não existe aqui: os leads chegam ao Kommo sem UTM
 * preenchida, então o MQL é da conta inteira. Campanha e anúncio ficam N/D até
 * que a origem passe a gravar a campanha no lead.
 */

const FIELD_NAME = 'Faturamento anual';

/** Nome do campo de faturamento, se o cliente tiver batizado diferente. */
function fieldName(): string {
  return process.env.KOMMO_FATURAMENTO_FIELD?.trim() || FIELD_NAME;
}

/** Conta de anúncio que recebe os MQLs deste CRM. */
export function targetAccountId(): string | null {
  return process.env.KOMMO_ACCOUNT_ID?.trim() || null;
}

export function defaultRange(days = 90): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { since: iso(since), until: iso(until) };
}

function localDate(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  // Data local, não UTC: um lead das 21h de Brasília pertence ao dia dele, e
  // não ao seguinte.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface SyncResult {
  accountId: string;
  ok: boolean;
  leads?: number;
  mqls?: number;
  indefinidos?: number;
  message?: string;
}

export class KommoSyncService {
  public static configured(): boolean {
    return isConfigured() && !!targetAccountId();
  }

  public static async sync(range = defaultRange()): Promise<SyncResult> {
    const accountId = targetAccountId();
    if (!accountId) {
      return { accountId: '(nenhuma)', ok: false, message: 'KOMMO_ACCOUNT_ID não definido.' };
    }
    if (!isConfigured()) {
      return { accountId, ok: false, message: 'Kommo não configurado.' };
    }

    try {
      const fields = await listLeadFields();
      const target = fields.find(f => f.name.trim().toLowerCase() === fieldName().toLowerCase());
      if (!target) {
        const msg = `Campo "${fieldName()}" não existe no Kommo. Sem ele não há como qualificar.`;
        kommoMqlStore.saveError(accountId, msg);
        return { accountId, ok: false, message: msg };
      }

      const leads = await fetchLeads(range.since, range.until);
      const daily: Record<string, DailyMql> = {};

      for (const lead of leads) {
        const date = localDate(lead.created_at);
        const bucket = daily[date] || (daily[date] = { leads: 0, mqls: 0, indefinidos: 0 });
        bucket.leads++;

        const field = (lead.custom_fields_values || []).find(f => f.field_id === target.id);
        const raw = field?.values?.[0]?.value;
        const verdict = qualify(typeof raw === 'string' ? raw : raw == null ? null : String(raw));

        if (verdict === 'mql') bucket.mqls++;
        else if (verdict === 'indefinido') bucket.indefinidos++;
      }

      kommoMqlStore.saveSync(accountId, daily);

      const totals = Object.values(daily).reduce<DailyMql>(
        (s, d) => ({ leads: s.leads + d.leads, mqls: s.mqls + d.mqls, indefinidos: s.indefinidos + d.indefinidos }),
        { leads: 0, mqls: 0, indefinidos: 0 }
      );
      console.log(
        `[Kommo] ${accountId}: ${totals.leads} leads, ${totals.mqls} MQL (>= R$ ${MQL_THRESHOLD.toLocaleString('pt-BR')}), ` +
        `${totals.indefinidos} sem faturamento (${range.since} a ${range.until}).`
      );
      return { accountId, ok: true, ...totals };
    } catch (err) {
      const message = err instanceof KommoError ? err.message : redact(String(err));
      console.error('[Kommo] Falha na sincronização:', message);
      kommoMqlStore.saveError(accountId, message);
      return { accountId, ok: false, message };
    }
  }
}
