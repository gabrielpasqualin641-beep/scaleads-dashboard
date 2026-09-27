import { SheetsAccountSnapshot, SheetsDailyRow, SheetsMetricSet } from '../sheets/types.js';
import { slugify } from '../sheets/fetchAndAggregate.js';

/**
 * Puxa a conta CA 01 direto da Meta Marketing API (System User token).
 *
 * Existe porque a CA 01 não tem Adveronix: a planilha de leads dá só a
 * contagem de leads e o MQL, e o gasto/impressões/cliques ficavam N/D. Aqui a
 * mídia vem da própria Meta.
 *
 * O token vive só em `process.env` (nunca em código, commit, log ou front). O
 * adapter converte os insights para o mesmo `SheetsAccountSnapshot` que o
 * provider da CA 01 já consome — nada no resto do painel muda.
 *
 * Puxa no nível de anúncio com `time_increment=1` (uma linha por anúncio por
 * dia) e agrega para conjunto e campanha, exatamente como o snapshot da
 * planilha faz. Um lead da Meta é o maior valor entre `lead` e
 * `onsite_conversion.lead_grouped` — formatos que a Meta usa conforme o
 * objetivo, e pegar o maior evita contar o mesmo lead a menos.
 */

function config(): { token: string; version: string; accountId: string } | null {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  const accountId = process.env.META_CA01_ACCOUNT_ID?.trim();
  const version = process.env.META_API_VERSION?.trim() || 'v23.0';
  if (!token || !accountId) return null;
  return { token, version, accountId };
}

export function isConfigured(): boolean {
  return config() !== null;
}

const FIELDS = [
  'campaign_name', 'adset_name', 'ad_name',
  'spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks',
  'actions'
].join(',');

interface MetaAction { action_type: string; value: string }
interface MetaRow {
  date_start: string;
  campaign_name?: string;
  adset_name?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  reach?: string;
  actions?: MetaAction[];
}

function actionValue(actions: MetaAction[] | undefined, type: string): number {
  const a = (actions || []).find(x => x.action_type === type);
  return a ? Number(a.value) || 0 : 0;
}

/** Leads do dia: o maior entre os dois formatos que a Meta reporta. */
function leadsOf(row: MetaRow): number {
  return Math.max(actionValue(row.actions, 'lead'), actionValue(row.actions, 'onsite_conversion.lead_grouped'));
}

/** Conversas de WhatsApp iniciadas (7 dias). Não entra no snapshot; só no bruto. */
export function conversationsOf(row: { actions?: MetaAction[] }): number {
  return actionValue(row.actions, 'onsite_conversion.messaging_conversation_started_7d');
}

/**
 * Todas as linhas anúncio×dia do período, seguindo a paginação até o fim.
 * `AbortSignal` com timeout para uma resposta que não chega não travar o ciclo.
 */
export async function fetchAdDaily(since: string, until: string): Promise<MetaRow[]> {
  const cfg = config();
  if (!cfg) throw new Error('Meta não configurada (META_ACCESS_TOKEN / META_CA01_ACCOUNT_ID).');

  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  let url =
    `https://graph.facebook.com/${cfg.version}/${cfg.accountId}/insights` +
    `?level=ad&time_increment=1&limit=500&time_range=${timeRange}` +
    `&fields=${FIELDS}&access_token=${encodeURIComponent(cfg.token)}`;

  const rows: MetaRow[] = [];
  for (let page = 0; page < 50 && url; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let body: any;
    try {
      const res = await fetch(url, { signal: controller.signal });
      body = await res.json();
      if (!res.ok || body?.error) {
        // Mensagem da Meta sem vazar o token (ele não aparece no corpo de erro).
        throw new Error(`Meta respondeu ${res.status}: ${body?.error?.message || 'erro'}`);
      }
    } finally {
      clearTimeout(timer);
    }
    rows.push(...(body.data as MetaRow[]));
    url = body.paging?.next || '';
  }
  return rows;
}

function metrics(spend: number, impressions: number, clicks: number, leads: number): SheetsMetricSet {
  return {
    spend,
    impressions,
    clicks,
    // A CA 01 é conta de captação: não mede landing page view nem conversão de
    // compra. Ficam N/D, como já ficavam.
    landingPageViews: null,
    conversions: null,
    leads,
    // Alcance não é somável entre anúncios/dias; fica N/D nos agregados.
    reach: null
  };
}

interface Group { spend: number; impressions: number; clicks: number; leads: number; byDate: Map<string, { spend: number; impressions: number; clicks: number; leads: number }> }

function emptyGroup(): Group { return { spend: 0, impressions: 0, clicks: 0, leads: 0, byDate: new Map() }; }

function add(g: Group, date: string, spend: number, impressions: number, clicks: number, leads: number): void {
  g.spend += spend; g.impressions += impressions; g.clicks += clicks; g.leads += leads;
  const d = g.byDate.get(date) || { spend: 0, impressions: 0, clicks: 0, leads: 0 };
  d.spend += spend; d.impressions += impressions; d.clicks += clicks; d.leads += leads;
  g.byDate.set(date, d);
}

function series(g: Group): SheetsDailyRow[] {
  return Array.from(g.byDate.entries())
    .map(([date, d]) => ({ date, ...metrics(d.spend, d.impressions, d.clicks, d.leads) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Converte as linhas da Meta no snapshot que o provider consome, com os mesmos
 * ids (`sheet_camp_`/`sheet_adset_`/`sheet_ad_`) do snapshot da planilha — para
 * o adKey casar e o MQL do export de leads cair no criativo certo.
 */
export function snapshotFromMeta(rows: MetaRow[], accountId: string, sourceUrl: string): SheetsAccountSnapshot {
  const campaigns = new Map<string, Group>();
  const adSets = new Map<string, Group>();
  const ads = new Map<string, Group>();
  const campName = new Map<string, string>();
  const setName = new Map<string, string>();
  const adName = new Map<string, string>();
  const setCampaign = new Map<string, string>();
  const adCampaign = new Map<string, string>();
  const adAdSet = new Map<string, string>();
  const account = emptyGroup();
  const dates: string[] = [];

  for (const r of rows) {
    const date = (r.date_start || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const c = (r.campaign_name || '').trim();
    const s = (r.adset_name || '').trim();
    const a = (r.ad_name || '').trim();
    const spend = Number(r.spend || 0);
    const impressions = Number(r.impressions || 0);
    const clicks = Number(r.clicks || 0);
    const leads = leadsOf(r);

    const campId = `sheet_camp_${slugify(c)}`;
    const setId = `sheet_adset_${slugify(c)}_${slugify(s)}`;
    const adId = `sheet_ad_${slugify(c)}_${slugify(s)}_${slugify(a)}`;
    campName.set(campId, c || 'Sem nome');
    setName.set(setId, s || 'Sem nome'); setCampaign.set(setId, campId);
    adName.set(adId, a || 'Sem nome'); adCampaign.set(adId, campId); adAdSet.set(adId, setId);

    add(campaigns.get(campId) || campaigns.set(campId, emptyGroup()).get(campId)!, date, spend, impressions, clicks, leads);
    add(adSets.get(setId) || adSets.set(setId, emptyGroup()).get(setId)!, date, spend, impressions, clicks, leads);
    add(ads.get(adId) || ads.set(adId, emptyGroup()).get(adId)!, date, spend, impressions, clicks, leads);
    add(account, date, spend, impressions, clicks, leads);
    dates.push(date);
  }

  const entity = (id: string, name: string, g: Group, extra: object = {}) => ({ id, name, ...metrics(g.spend, g.impressions, g.clicks, g.leads), ...extra });
  const sorted = dates.sort();

  return {
    accountId,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    range: { since: sorted[0] || '', until: sorted[sorted.length - 1] || '' },
    availableMetrics: ['leads'],
    // Diferente da planilha de leads: a Meta reporta mídia de verdade.
    hasSpend: true,
    daily: series(account),
    campaigns: Array.from(campaigns.entries()).map(([id, g]) => entity(id, campName.get(id)!, g)),
    adSets: Array.from(adSets.entries()).map(([id, g]) => entity(id, setName.get(id)!, g, { campaignId: setCampaign.get(id) })),
    ads: Array.from(ads.entries()).map(([id, g]) => entity(id, adName.get(id)!, g, { campaignId: adCampaign.get(id), adSetId: adAdSet.get(id) })),
    dailyByEntity: {
      campaigns: Object.fromEntries(Array.from(campaigns.entries()).map(([id, g]) => [id, series(g)])),
      adSets: Object.fromEntries(Array.from(adSets.entries()).map(([id, g]) => [id, series(g)])),
      ads: Object.fromEntries(Array.from(ads.entries()).map(([id, g]) => [id, series(g)]))
    }
  };
}

/** Snapshot pronto do período. Uma chamada; usado pela rota e pela sincronização. */
export async function buildSnapshot(accountId: string, since: string, until: string): Promise<SheetsAccountSnapshot> {
  const rows = await fetchAdDaily(since, until);
  return snapshotFromMeta(rows, accountId, 'meta-marketing-api');
}
