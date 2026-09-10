import { fetchLeads, listLeadFields, isConfigured, KommoError, redact } from '../integrations/kommo/client.js';
import { kommoMqlStore, DailyMql } from '../integrations/kommo/mqlStore.js';
import { qualify, MQL_THRESHOLD } from '../integrations/kommo/qualification.js';
import { db } from '../db/database.js';

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

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function defaultRange(days = 90): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { since: iso(since), until: iso(until) };
}

const FALLBACK_TZ = 'America/Sao_Paulo';

/**
 * Dia a que o lead pertence, no fuso da conta de anúncios.
 *
 * O fuso do servidor não serve: o Render roda em UTC, e um lead das 22h de
 * Brasília cairia no dia seguinte. O painel então mostraria mais MQL num dia do
 * que leads — o gasto e os leads vêm da Meta, que reporta no fuso da conta.
 */
function localDate(epochSeconds: number, timeZone: string): string {
  // 'en-CA' formata como AAAA-MM-DD, que é a chave usada no store.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(epochSeconds * 1000));
}

function accountTimeZone(externalAccountId: string): string {
  return db.getAccountByExternalId(externalAccountId)?.timezone || FALLBACK_TZ;
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

      // Busca um dia a mais de cada lado: o recorte do Kommo trabalha em epoch
      // com o fuso do servidor, e sem a folga os leads da virada do dia se
      // perderiam antes de serem reagrupados no fuso da conta.
      const leads = await fetchLeads(shiftDate(range.since, -1), shiftDate(range.until, 1));
      const timeZone = accountTimeZone(accountId);
      const daily: Record<string, DailyMql> = {};

      for (const lead of leads) {
        const date = localDate(lead.created_at, timeZone);
        // A folga da busca pode trazer dias fora do intervalo pedido.
        if (date < range.since || date > range.until) continue;
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
