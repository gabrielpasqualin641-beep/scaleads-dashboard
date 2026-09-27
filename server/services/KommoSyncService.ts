import { fetchLeads, listLeadFields, isConfigured, KommoError, redact, KommoLead, KommoCustomField } from '../integrations/kommo/client.js';
import { kommoMqlStore, DailyMql } from '../integrations/kommo/mqlStore.js';
import { qualify, MQL_THRESHOLD } from '../integrations/kommo/qualification.js';
import { mergeExports, ExportedLead } from '../integrations/metaLeads/leadExports.js';
import { readKommoCreative, writeKommoCreative } from '../integrations/kommo/creativeStore.js';
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

/* --- Atribuição por UTM (leads da landing page) --------------------------- */

/** Achata para comparar: sem acento, minúsculo, separadores viram espaço. */
function flat(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Valor de texto de um campo do lead, pelo id. */
function fieldValue(lead: KommoLead, fieldId: number): string | null {
  const f = (lead.custom_fields_values || []).find(c => c.field_id === fieldId);
  const v = f?.values?.[0]?.value;
  return typeof v === 'string' ? v : v == null ? null : String(v);
}

/** Nome do anúncio como a UTM chega: pode vir da URL, então decodifica. */
function cleanUtm(raw: string | null): string {
  if (!raw) return '';
  let t = raw.replace(/\+/g, ' ');
  try { t = decodeURIComponent(t); } catch { /* já estava decodificado */ }
  return t.trim();
}

export interface UtmFieldIds {
  campaign: number;
  medium: number;
  content: number;
  faturamento: number;
}

/**
 * Localiza os campos de UTM no Kommo. Só casa campo cujo nome contém
 * "utm_campaign/medium/content" — para não confundir com um campo "Campanha"
 * qualquer. `env` permite apontar o nome exato, quando o cliente batizou
 * diferente.
 */
export function findUtmFields(fields: KommoCustomField[]): Omit<UtmFieldIds, 'faturamento'> | null {
  const byName = (envVar: string, needle: string): number | null => {
    const override = process.env[envVar]?.trim();
    if (override) {
      const f = fields.find(x => x.name.trim().toLowerCase() === override.toLowerCase());
      if (f) return f.id;
    }
    const f = fields.find(x => flat(x.name).includes(needle));
    return f ? f.id : null;
  };
  const campaign = byName('KOMMO_UTM_CAMPAIGN_FIELD', 'utm campaign');
  const medium = byName('KOMMO_UTM_MEDIUM_FIELD', 'utm medium');
  const content = byName('KOMMO_UTM_CONTENT_FIELD', 'utm content');
  if (campaign == null || medium == null || content == null) return null;
  return { campaign, medium, content };
}

/**
 * Converte um lead do Kommo num lead atribuído por criativo, ou null quando ele
 * não tem as três UTMs (ex.: lead de formulário da Meta, que não passa por URL).
 * Sem chute: falta de UTM não vira atribuição.
 */
export function utmLead(lead: KommoLead, ids: Omit<UtmFieldIds, 'faturamento'>, faturamentoId: number, date: string): ExportedLead | null {
  const campaignName = cleanUtm(fieldValue(lead, ids.campaign));
  const adSetName = cleanUtm(fieldValue(lead, ids.medium));
  const adName = cleanUtm(fieldValue(lead, ids.content));
  if (!campaignName || !adSetName || !adName) return null;
  return {
    id: String(lead.id),
    date,
    campaignName,
    adSetName,
    adName,
    qualifierAnswer: fieldValue(lead, faturamentoId)
  };
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

      // Campos de UTM: quando existem, o lead da landing page também é atribuído
      // ao criativo. Quando não, só o total da conta é contado — sem chute.
      const utmFields = findUtmFields(fields);
      const utmLeads: ExportedLead[] = [];

      // Valores que o classificador não soube ler. Ficam registrados para
      // alguém notar: um formato novo chegando do formulário aparece aqui antes
      // de virar um número errado no painel.
      const naoReconhecidos = new Map<string, number>();

      for (const lead of leads) {
        const date = localDate(lead.created_at, timeZone);
        // A folga da busca pode trazer dias fora do intervalo pedido.
        if (date < range.since || date > range.until) continue;
        const bucket = daily[date] || (daily[date] = { leads: 0, mqls: 0, indefinidos: 0 });
        bucket.leads++;

        // Lead com UTM (veio de uma landing page) entra também na atribuição por
        // criativo. O total da conta acima já o contou; a atribuição não soma de
        // novo — é lida à parte, só nas linhas de campanha/conjunto/anúncio.
        if (utmFields) {
          const atribuido = utmLead(lead, utmFields, target.id, date);
          if (atribuido) utmLeads.push(atribuido);
        }

        const field = (lead.custom_fields_values || []).find(f => f.field_id === target.id);
        const raw = field?.values?.[0]?.value;
        const texto = typeof raw === 'string' ? raw : raw == null ? null : String(raw);
        const verdict = qualify(texto);

        if (verdict === 'mql') bucket.mqls++;
        else if (verdict === 'indefinido') {
          bucket.indefinidos++;
          // Vazio é esperado (lead antigo, ou ainda não qualificado). Texto
          // preenchido que não foi entendido é sinal de formato novo.
          if (texto && texto.trim()) {
            naoReconhecidos.set(texto, (naoReconhecidos.get(texto) || 0) + 1);
          }
        }
      }

      if (naoReconhecidos.size > 0) {
        const amostra = Array.from(naoReconhecidos.entries())
          .map(([v, n]) => `${JSON.stringify(v)} (${n}x)`)
          .join(', ');
        console.warn(
          `⚠️  [Kommo] Faturamento em formato não reconhecido, contado como indefinido: ${amostra}. ` +
          'Enquanto não for mapeado, esses leads ficam fora do MQL.'
        );
      }

      kommoMqlStore.saveSync(accountId, daily);

      // Atribuição por criativo dos leads da LP, num arquivo à parte do total da
      // conta. mergeExports reescreve a janela de cada anúncio a partir desta
      // coleta — rerodar não duplica.
      if (utmFields) {
        const { snapshot } = mergeExports(
          readKommoCreative(),
          [{ fileName: `kommo_${accountId}.utm`, leads: utmLeads }],
          () => accountId,
          answer => qualify(answer)
        );
        writeKommoCreative(snapshot);
        console.log(`[Kommo] UTM: ${utmLeads.length} leads da LP atribuídos por criativo.`);
      } else {
        console.warn(
          '⚠️  [Kommo] Campos utm_campaign/utm_medium/utm_content não encontrados no CRM; ' +
          'MQL segue só no total da conta. Defina KOMMO_UTM_CAMPAIGN_FIELD/MEDIUM/CONTENT se tiverem outro nome.'
        );
      }

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
