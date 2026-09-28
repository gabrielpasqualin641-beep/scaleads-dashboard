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

interface MetaCfg { token: string; version: string; accountId: string }

/** Token único (compartilhado por todas as contas) + versão, do ambiente. */
function envToken(): { token: string; version: string } | null {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  if (!token) return null;
  return { token, version: process.env.META_API_VERSION?.trim() || 'v23.0' };
}

export function hasToken(): boolean {
  return !!process.env.META_ACCESS_TOKEN?.trim();
}

const FIELDS = [
  'campaign_name', 'adset_name', 'ad_name',
  'spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks',
  'actions', 'action_values'
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
  action_values?: MetaAction[];
}

function actionValue(actions: MetaAction[] | undefined, type: string): number {
  const a = (actions || []).find(x => x.action_type === type);
  return a ? Number(a.value) || 0 : 0;
}

/** Leads do dia: o maior entre os dois formatos que a Meta reporta. */
function leadsOf(row: MetaRow): number {
  return Math.max(actionValue(row.actions, 'lead'), actionValue(row.actions, 'onsite_conversion.lead_grouped'));
}

/**
 * Eventos que contam como "venda/conversão" nas campanhas de conversão.
 * Padrão: compra (os formatos que a Meta usa). Configurável por
 * `META_CA01_CONVERSION_ACTIONS` (lista separada por vírgula) quando o evento
 * for outro — ex.: um checkout ou uma conversão personalizada.
 */
function conversionTypes(): string[] {
  const env = process.env.META_CA01_CONVERSION_ACTIONS?.trim();
  if (env) return env.split(',').map(s => s.trim()).filter(Boolean);
  return ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase'];
}

/**
 * Conversões do dia: o primeiro tipo da lista com valor > 0 (evita somar o
 * mesmo evento reportado em formatos diferentes). `has` distingue "0 vendas"
 * de "esta linha não mede venda" — sem evento nenhum, conversão fica N/D.
 */
function conversionsOf(row: MetaRow, types: string[]): { count: number; value: number; has: boolean } {
  for (const t of types) {
    const count = actionValue(row.actions, t);
    if (count > 0) return { count, value: actionValue(row.action_values, t), has: true };
  }
  return { count: 0, value: 0, has: false };
}

/** Visitas na página (landing_page_view). */
function landingViewsOf(row: MetaRow): number {
  return Math.max(actionValue(row.actions, 'landing_page_view'), actionValue(row.actions, 'omni_landing_page_view'));
}

/** Engajamento líquido no post (curtidas líquidas) — a Meta não reporta "follow" aqui. */
function engagementOf(row: MetaRow): number {
  return actionValue(row.actions, 'onsite_conversion.post_net_like');
}

/** Conversas de WhatsApp iniciadas (7 dias). Não entra no snapshot; só no bruto. */
export function conversationsOf(row: { actions?: MetaAction[] }): number {
  return actionValue(row.actions, 'onsite_conversion.messaging_conversation_started_7d');
}

/** Quebra [since, until] em janelas de no máximo `days` dias. */
function windows(since: string, until: string, days: number): Array<{ since: string; until: string }> {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const out: Array<{ since: string; until: string }> = [];
  let start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  while (start <= end) {
    const stop = new Date(start.getTime() + (days - 1) * 86_400_000);
    out.push({ since: iso(start), until: iso(stop < end ? stop : end) });
    start = new Date(stop.getTime() + 86_400_000);
  }
  return out;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Uma página, com retry em erro transitório ("temporarily unavailable"/429/5xx). */
async function fetchPage(url: string): Promise<any> {
  let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt); // 1.5s, 3s, 4.5s
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const body = await res.json();
      if (res.ok && !body?.error) return body;
      const msg = body?.error?.message || `HTTP ${res.status}`;
      // Transitório: a Meta pede para tentar de novo. Erro de verdade (token,
      // permissão) não é transitório e sai na hora.
      const transient = /temporarily unavailable|reduce the amount of data|please reduce|limit reached|try again/i.test(msg) || res.status === 429 || res.status >= 500;
      lastErr = `Meta respondeu ${res.status}: ${msg}`;
      if (!transient) throw new Error(lastErr);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (!/temporarily unavailable|aborted|network|fetch failed|HTTP 5|429/i.test(lastErr)) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastErr || 'Meta indisponível após retentativas.');
}

/** Uma janela, paginada até o fim, com pausa entre páginas para não estourar limite. */
async function fetchWindow(cfg: { token: string; version: string; accountId: string }, since: string, until: string): Promise<MetaRow[]> {
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  let url =
    `https://graph.facebook.com/${cfg.version}/${cfg.accountId}/insights` +
    `?level=ad&time_increment=1&limit=500&time_range=${timeRange}` +
    `&fields=${FIELDS}&access_token=${encodeURIComponent(cfg.token)}`;

  const rows: MetaRow[] = [];
  for (let page = 0; page < 50 && url; page++) {
    if (page > 0) await sleep(300);
    const body = await fetchPage(url);
    rows.push(...(body.data as MetaRow[]));
    url = body.paging?.next || '';
  }
  return rows;
}

/**
 * Todas as linhas anúncio×dia do período.
 *
 * A busca é fatiada em janelas de 30 dias: no nível de anúncio com uma linha
 * por dia, um pedido de 90 dias de uma vez é pesado demais e estoura o tempo
 * limite da Meta. Cada fatia é rápida, e as linhas se juntam no fim.
 */
export async function fetchAdDaily(cfg: MetaCfg, since: string, until: string): Promise<MetaRow[]> {
  const rows: MetaRow[] = [];
  const janelas = windows(since, until, 14);
  let falhas = 0;
  for (let i = 0; i < janelas.length; i++) {
    if (i > 0) await sleep(600); // respiro entre janelas
    try {
      rows.push(...(await fetchWindow(cfg, janelas[i].since, janelas[i].until)));
    } catch (err) {
      // Uma janela que falha não derruba a coleta inteira — as outras entram, e
      // a próxima sincronização preenche o buraco. Antes, uma falha congelava o
      // painel no dado antigo.
      falhas++;
      console.error(`[Meta CA01] Janela ${janelas[i].since} a ${janelas[i].until} falhou: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (falhas === janelas.length) throw new Error('Todas as janelas falharam na Meta.');
  return rows;
}

interface Cell {
  spend: number; impressions: number; clicks: number; linkClicks: number; leads: number;
  landingPageViews: number; engagement: number;
  conversions: number; hasConv: boolean;
}

function zeroCell(): Cell {
  return { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, landingPageViews: 0, engagement: 0, conversions: 0, hasConv: false };
}

function metricsOf(c: Cell): SheetsMetricSet {
  return {
    spend: c.spend,
    impressions: c.impressions,
    clicks: c.clicks,
    linkClicks: c.linkClicks,
    engagement: c.engagement,
    landingPageViews: c.landingPageViews,
    // Vendas: N/D onde nenhum evento de conversão foi reportado (campanha de
    // captação), o número real onde houve (campanha de conversão).
    conversions: c.hasConv ? c.conversions : null,
    leads: c.leads,
    // Alcance/frequência vêm por entidade num pedido à parte (dedup da Meta);
    // aqui, no agregado por soma de dias, ficam N/D.
    reach: null,
    frequency: null
  };
}

interface RowVals { spend: number; impressions: number; clicks: number; linkClicks: number; leads: number; landingPageViews: number; engagement: number; conv: { count: number; has: boolean } }

interface Group { total: Cell; byDate: Map<string, Cell> }

function emptyGroup(): Group { return { total: zeroCell(), byDate: new Map() }; }

function bump(c: Cell, v: RowVals): void {
  c.spend += v.spend; c.impressions += v.impressions; c.clicks += v.clicks; c.linkClicks += v.linkClicks; c.leads += v.leads;
  c.landingPageViews += v.landingPageViews; c.engagement += v.engagement;
  if (v.conv.has) { c.conversions += v.conv.count; c.hasConv = true; }
}

function add(g: Group, date: string, v: RowVals): void {
  bump(g.total, v);
  const d = g.byDate.get(date) || zeroCell();
  bump(d, v);
  g.byDate.set(date, d);
}

function series(g: Group): SheetsDailyRow[] {
  return Array.from(g.byDate.entries())
    .map(([date, d]) => ({ date, ...metricsOf(d) }))
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
  const convTypes = conversionTypes();

  for (const r of rows) {
    const date = (r.date_start || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const c = (r.campaign_name || '').trim();
    const s = (r.adset_name || '').trim();
    const a = (r.ad_name || '').trim();
    const v: RowVals = {
      spend: Number(r.spend || 0),
      impressions: Number(r.impressions || 0),
      clicks: Number(r.clicks || 0),
      linkClicks: Number(r.inline_link_clicks || 0),
      leads: leadsOf(r),
      landingPageViews: landingViewsOf(r),
      engagement: engagementOf(r),
      conv: conversionsOf(r, convTypes)
    };

    const campId = `sheet_camp_${slugify(c)}`;
    const setId = `sheet_adset_${slugify(c)}_${slugify(s)}`;
    const adId = `sheet_ad_${slugify(c)}_${slugify(s)}_${slugify(a)}`;
    campName.set(campId, c || 'Sem nome');
    setName.set(setId, s || 'Sem nome'); setCampaign.set(setId, campId);
    adName.set(adId, a || 'Sem nome'); adCampaign.set(adId, campId); adAdSet.set(adId, setId);

    add(campaigns.get(campId) || campaigns.set(campId, emptyGroup()).get(campId)!, date, v);
    add(adSets.get(setId) || adSets.set(setId, emptyGroup()).get(setId)!, date, v);
    add(ads.get(adId) || ads.set(adId, emptyGroup()).get(adId)!, date, v);
    add(account, date, v);
    dates.push(date);
  }

  const entity = (id: string, name: string, g: Group, extra: object = {}) => ({ id, name, ...metricsOf(g.total), engagement: g.total.engagement, ...extra });
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

/**
 * Alcance e frequência por entidade, deduplicados pela Meta para a janela.
 *
 * Pedido à parte, sem `time_increment` (uma linha por entidade), porque alcance
 * não pode ser somado entre dias/anúncios — a mesma pessoa contaria duas vezes.
 * A chave é o mesmo slug dos ids do snapshot, para casar.
 */
interface ReachRow { campaign_name?: string; adset_name?: string; ad_name?: string; reach?: string; frequency?: string }

async function fetchEntityReach(
  cfg: { token: string; version: string; accountId: string },
  since: string,
  until: string,
  level: 'campaign' | 'adset' | 'ad'
): Promise<Map<string, { reach: number; frequency: number }>> {
  const names = level === 'campaign' ? 'campaign_name'
    : level === 'adset' ? 'campaign_name,adset_name'
    : 'campaign_name,adset_name,ad_name';
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  let url =
    `https://graph.facebook.com/${cfg.version}/${cfg.accountId}/insights` +
    `?level=${level}&limit=500&time_range=${timeRange}` +
    `&fields=${names},reach,frequency&access_token=${encodeURIComponent(cfg.token)}`;

  const out = new Map<string, { reach: number; frequency: number }>();
  for (let page = 0; page < 20 && url; page++) {
    if (page > 0) await sleep(300);
    const body = await fetchPage(url);
    for (const r of (body.data as ReachRow[])) {
      const c = slugify((r.campaign_name || '').trim());
      const s = slugify((r.adset_name || '').trim());
      const a = slugify((r.ad_name || '').trim());
      const id = level === 'campaign' ? `sheet_camp_${c}`
        : level === 'adset' ? `sheet_adset_${c}_${s}`
        : `sheet_ad_${c}_${s}_${a}`;
      out.set(id, { reach: Number(r.reach || 0), frequency: Number(r.frequency || 0) });
    }
    url = body.paging?.next || '';
  }
  return out;
}

/** Objetivo de cada campanha, por id de slug — para rotular a frente. */
async function fetchObjectives(cfg: { token: string; version: string; accountId: string }, since: string, until: string): Promise<Map<string, string>> {
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  const url =
    `https://graph.facebook.com/${cfg.version}/${cfg.accountId}/insights` +
    `?level=campaign&time_range=${timeRange}&limit=500&fields=campaign_name,objective&access_token=${encodeURIComponent(cfg.token)}`;
  const body = await fetchPage(url);
  const out = new Map<string, string>();
  for (const r of (body.data as Array<{ campaign_name?: string; objective?: string }>)) {
    if (r.objective) out.set(`sheet_camp_${slugify((r.campaign_name || '').trim())}`, r.objective);
  }
  return out;
}

/** Alcance e frequência da conta inteira na janela (uma linha). */
async function fetchAccountReach(cfg: { token: string; version: string; accountId: string }, since: string, until: string): Promise<{ reach: number | null; frequency: number | null }> {
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  const url =
    `https://graph.facebook.com/${cfg.version}/${cfg.accountId}/insights` +
    `?level=account&time_range=${timeRange}&fields=reach,frequency&access_token=${encodeURIComponent(cfg.token)}`;
  const body = await fetchPage(url);
  const row = (body.data as ReachRow[])[0];
  return { reach: row ? Number(row.reach || 0) : null, frequency: row ? Number(row.frequency || 0) : null };
}

/**
 * Snapshot pronto do período para uma conta da Meta.
 * `dashboardAccountId` é a chave da conta no painel; `metaAccountId` é o `act_`
 * da Meta. O token é único, do ambiente.
 */
export async function buildSnapshot(dashboardAccountId: string, metaAccountId: string, since: string, until: string): Promise<SheetsAccountSnapshot> {
  const t = envToken();
  if (!t) throw new Error('META_ACCESS_TOKEN ausente.');
  const cfg: MetaCfg = { token: t.token, version: t.version, accountId: metaAccountId };

  const rows = await fetchAdDaily(cfg, since, until);
  const snap = snapshotFromMeta(rows, dashboardAccountId, 'meta-marketing-api');

  // Alcance/frequência por entidade e da conta. Se a Meta recusar (limite),
  // seguem N/D — o resto do snapshot continua íntegro.
  try {
    const [campR, setR, adR, accR] = [
      await fetchEntityReach(cfg, since, until, 'campaign'),
      await fetchEntityReach(cfg, since, until, 'adset'),
      await fetchEntityReach(cfg, since, until, 'ad'),
      await fetchAccountReach(cfg, since, until)
    ];
    const apply = (rows: SheetsAccountSnapshot['campaigns'], map: Map<string, { reach: number; frequency: number }>) => {
      for (const row of rows) {
        const rf = map.get(row.id);
        if (rf) { row.reach = rf.reach; row.frequency = rf.frequency; }
      }
    };
    apply(snap.campaigns, campR);
    apply(snap.adSets, setR);
    apply(snap.ads, adR);
    snap.reach = accR.reach;
    snap.frequency = accR.frequency;
  } catch (err) {
    console.error('[Meta CA01] Alcance/frequência indisponível:', err instanceof Error ? err.message : err);
  }

  try {
    const objectives = await fetchObjectives(cfg, since, until);
    for (const c of snap.campaigns) {
      const obj = objectives.get(c.id);
      if (obj) c.objective = obj;
    }
  } catch (err) {
    console.error('[Meta CA01] Objetivos indisponíveis:', err instanceof Error ? err.message : err);
  }
  return snap;
}
