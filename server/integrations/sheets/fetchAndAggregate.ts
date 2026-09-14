import { parseCsv, parseBrNumber } from './csv.js';
import { SheetsAccountSnapshot, SheetsDailyRow, SheetsEntityRow, SheetsMetricSet } from './types.js';

/**
 * Aceita o link normal de edição do Google Sheets (com `#gid=`) e devolve a
 * URL de exportação CSV pública. Só funciona para planilhas publicadas/
 * compartilhadas como "qualquer pessoa com o link pode ver" — é o mesmo
 * requisito que já vale para o link que o usuário informou.
 */
export function toCsvExportUrl(shareUrl: string): string {
  const idMatch = shareUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) {
    throw new Error(`Link de planilha inválido: "${shareUrl}". Esperava algo como .../spreadsheets/d/<id>/edit...`);
  }
  const spreadsheetId = idMatch[1];
  const gidMatch = shareUrl.match(/[?#&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

export async function fetchAdveronixCsv(shareUrl: string): Promise<string> {
  const url = toCsvExportUrl(shareUrl);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Falha ao buscar a planilha (HTTP ${res.status}). Verifique se ela está publicada/compartilhada como "qualquer pessoa com o link pode ver".`);
  }
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error('A planilha não é pública — o Google devolveu uma tela de login em vez do CSV.');
  }
  return text;
}

/** Converte `DD/MM/AAAA` ou `AAAA-MM-DD` (o Sheets pode exportar em qualquer um) para `AAAA-MM-DD`. */
function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const br = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const [, d, m, y] = br;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return trimmed;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Métricas que só existem se a planilha trouxer a coluna preenchida. */
type OptionalMetric = 'landingPageViews' | 'conversions' | 'leads' | 'reach';
const OPTIONAL_METRICS: OptionalMetric[] = ['landingPageViews', 'conversions', 'leads', 'reach'];

interface FlatRow {
  date: string;
  campaignName: string;
  adSetName: string;
  adName: string;
  spend: number;
  impressions: number;
  clicks: number;
  landingPageViews: number | null;
  conversions: number | null;
  leads: number | null;
  reach: number | null;
}

type ColumnKey = keyof FlatRow;

const HEADER_ALIASES: Record<string, ColumnKey> = {
  day: 'date',
  date: 'date',
  'campaign name': 'campaignName',
  'ad set name': 'adSetName',
  'adset name': 'adSetName',
  'ad name': 'adName',
  impressions: 'impressions',
  'link clicks': 'clicks',
  clicks: 'clicks',
  'landing page views': 'landingPageViews',
  'checkouts initiated': 'conversions',
  purchases: 'conversions',
  leads: 'leads',
  'leads (form)': 'leads',
  reach: 'reach',
  'amount spent': 'spend'
};

interface ParsedSheet {
  rows: FlatRow[];
  /** Métricas opcionais que esta planilha realmente reporta. */
  available: Set<OptionalMetric>;
}

function parseRows(csv: string): ParsedSheet {
  const table = parseCsv(csv);
  if (table.length === 0) return { rows: [], available: new Set() };

  const header = table[0].map(h => h.trim().toLowerCase());
  const columnFor: Partial<Record<ColumnKey, number>> = {};
  header.forEach((h, idx) => {
    const key = HEADER_ALIASES[h];
    // Primeira ocorrência vence: uma segunda coluna com nome sinônimo não
    // sobrescreve a que já foi mapeada.
    if (key && columnFor[key] === undefined) columnFor[key] = idx;
  });

  const required: ColumnKey[] = ['date', 'campaignName', 'adSetName', 'adName', 'spend'];
  const missing = required.filter(k => columnFor[k] === undefined);
  if (missing.length > 0) {
    throw new Error(`Planilha sem as colunas esperadas: ${missing.join(', ')}. Cabeçalho encontrado: ${table[0].join(' | ')}`);
  }

  const raw = (row: string[], key: ColumnKey): string => {
    const idx = columnFor[key];
    return idx === undefined ? '' : (row[idx] ?? '');
  };

  const body = table.slice(1).filter(row => row.some(cell => cell.trim() !== ''));

  /**
   * Uma coluna só conta como reportada se existir E tiver ao menos um valor.
   * O Adveronix inclui colunas que a Meta não preenche para aquele objetivo —
   * uma campanha de formulário não tem landing page view. Tratá-las como zero
   * mostraria "0" onde a verdade é "esta conta não mede isso".
   */
  const available = new Set<OptionalMetric>();
  for (const metric of OPTIONAL_METRICS) {
    if (columnFor[metric] === undefined) continue;
    if (body.some(row => raw(row, metric).trim() !== '')) available.add(metric);
  }

  // Coluna reportada: célula em branco é zero real (o Adveronix omite zeros).
  // Coluna ausente ou vazia na planilha inteira: null, que vira N/D.
  const optional = (row: string[], metric: OptionalMetric): number | null =>
    available.has(metric) ? parseBrNumber(raw(row, metric)) : null;

  const rows = body.map(row => ({
    date: normalizeDate(raw(row, 'date')),
    campaignName: raw(row, 'campaignName').trim(),
    adSetName: raw(row, 'adSetName').trim(),
    adName: raw(row, 'adName').trim(),
    spend: parseBrNumber(raw(row, 'spend')),
    impressions: parseBrNumber(raw(row, 'impressions')),
    clicks: parseBrNumber(raw(row, 'clicks')),
    landingPageViews: optional(row, 'landingPageViews'),
    conversions: optional(row, 'conversions'),
    leads: optional(row, 'leads'),
    reach: optional(row, 'reach')
  }));

  return { rows, available };
}

/**
 * Soma um grupo de linhas.
 *
 * Reach fica de fora da soma: conta pessoas únicas, e quem foi alcançado por
 * dois anúncios apareceria duas vezes. Só sobrevive quando o grupo é uma linha
 * só — aí não há o que deduplicar.
 */
function sumRows(rows: FlatRow[], available: Set<OptionalMetric>): SheetsMetricSet {
  const sumOf = (metric: 'landingPageViews' | 'conversions' | 'leads'): number | null =>
    available.has(metric) ? rows.reduce((acc, r) => acc + (r[metric] ?? 0), 0) : null;

  return {
    spend: rows.reduce((acc, r) => acc + r.spend, 0),
    impressions: rows.reduce((acc, r) => acc + r.impressions, 0),
    clicks: rows.reduce((acc, r) => acc + r.clicks, 0),
    landingPageViews: sumOf('landingPageViews'),
    conversions: sumOf('conversions'),
    leads: sumOf('leads'),
    reach: available.has('reach') && rows.length === 1 ? rows[0].reach : null
  };
}

function dailySeries(rows: FlatRow[], available: Set<OptionalMetric>): SheetsDailyRow[] {
  const byDate = new Map<string, FlatRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) || [];
    list.push(r);
    byDate.set(r.date, list);
  }
  return Array.from(byDate.entries())
    .map(([date, dayRows]) => ({ date, ...sumRows(dayRows, available) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function aggregateSnapshot(csv: string, accountId: string, sourceUrl: string): SheetsAccountSnapshot {
  const { rows, available } = parseRows(csv);
  const dates = rows.map(r => r.date).filter(Boolean).sort();

  const campaignGroups = new Map<string, FlatRow[]>();
  const adSetGroups = new Map<string, FlatRow[]>();
  const adGroups = new Map<string, FlatRow[]>();

  const pushTo = (groups: Map<string, FlatRow[]>, id: string, r: FlatRow) => {
    const list = groups.get(id);
    if (list) list.push(r);
    else groups.set(id, [r]);
  };

  for (const r of rows) {
    const campaignId = `sheet_camp_${slugify(r.campaignName)}`;
    const adSetId = `sheet_adset_${slugify(r.campaignName)}_${slugify(r.adSetName)}`;
    const adId = `sheet_ad_${slugify(r.campaignName)}_${slugify(r.adSetName)}_${slugify(r.adName)}`;

    pushTo(campaignGroups, campaignId, r);
    pushTo(adSetGroups, adSetId, r);
    pushTo(adGroups, adId, r);
  }

  const buildEntities = (
    groups: Map<string, FlatRow[]>,
    nameOf: (r: FlatRow) => string,
    extra?: (id: string, r: FlatRow) => Partial<Pick<SheetsEntityRow, 'campaignId' | 'adSetId'>>
  ): SheetsEntityRow[] =>
    Array.from(groups.entries()).map(([id, groupRows]) => ({
      id,
      name: nameOf(groupRows[0]),
      ...sumRows(groupRows, available),
      ...(extra ? extra(id, groupRows[0]) : {})
    }));

  const campaigns = buildEntities(campaignGroups, r => r.campaignName);
  const adSets = buildEntities(adSetGroups, r => r.adSetName, (_id, r) => ({
    campaignId: `sheet_camp_${slugify(r.campaignName)}`
  }));
  const ads = buildEntities(adGroups, r => r.adName, (_id, r) => ({
    campaignId: `sheet_camp_${slugify(r.campaignName)}`,
    adSetId: `sheet_adset_${slugify(r.campaignName)}_${slugify(r.adSetName)}`
  }));

  const dailyByEntity = {
    campaigns: Object.fromEntries(Array.from(campaignGroups.entries()).map(([id, r]) => [id, dailySeries(r, available)])),
    adSets: Object.fromEntries(Array.from(adSetGroups.entries()).map(([id, r]) => [id, dailySeries(r, available)])),
    ads: Object.fromEntries(Array.from(adGroups.entries()).map(([id, r]) => [id, dailySeries(r, available)]))
  };

  return {
    accountId,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    range: { since: dates[0] || '', until: dates[dates.length - 1] || '' },
    availableMetrics: OPTIONAL_METRICS.filter(m => available.has(m)),
    daily: dailySeries(rows, available),
    campaigns,
    adSets,
    ads,
    dailyByEntity
  };
}
