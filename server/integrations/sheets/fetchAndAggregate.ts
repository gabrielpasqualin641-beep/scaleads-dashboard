import { parseCsv, parseBrNumber } from './csv.js';
import { SheetsAccountSnapshot, SheetsDailyRow, SheetsEntityRow } from './types.js';

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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

interface FlatRow {
  date: string;
  campaignName: string;
  adSetName: string;
  adName: string;
  impressions: number;
  clicks: number;
  landingPageViews: number;
  conversions: number;
  spend: number;
}

const HEADER_ALIASES: Record<string, keyof FlatRow> = {
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
  'amount spent': 'spend'
};

function parseRows(csv: string): FlatRow[] {
  const table = parseCsv(csv);
  if (table.length === 0) return [];

  const header = table[0].map(h => h.trim().toLowerCase());
  const columnFor: Partial<Record<keyof FlatRow, number>> = {};
  header.forEach((h, idx) => {
    const key = HEADER_ALIASES[h];
    if (key) columnFor[key] = idx;
  });

  const required: (keyof FlatRow)[] = ['date', 'campaignName', 'adSetName', 'adName', 'spend'];
  const missing = required.filter(k => columnFor[k] === undefined);
  if (missing.length > 0) {
    throw new Error(`Planilha sem as colunas esperadas: ${missing.join(', ')}. Cabeçalho encontrado: ${table[0].join(' | ')}`);
  }

  const col = (row: string[], key: keyof FlatRow): string => {
    const idx = columnFor[key];
    return idx === undefined ? '' : (row[idx] ?? '');
  };

  return table.slice(1).map(row => ({
    date: normalizeDate(col(row, 'date')),
    campaignName: col(row, 'campaignName').trim(),
    adSetName: col(row, 'adSetName').trim(),
    adName: col(row, 'adName').trim(),
    impressions: parseBrNumber(col(row, 'impressions')),
    clicks: parseBrNumber(col(row, 'clicks')),
    landingPageViews: parseBrNumber(col(row, 'landingPageViews')),
    conversions: parseBrNumber(col(row, 'conversions')),
    spend: parseBrNumber(col(row, 'spend'))
  }));
}

/** Soma um grupo de linhas nas métricas agregadas do período inteiro. */
function sumRows(rows: FlatRow[]): Omit<SheetsEntityRow, 'id' | 'name' | 'campaignId' | 'adSetId'> {
  return rows.reduce(
    (acc, r) => ({
      spend: acc.spend + r.spend,
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      landingPageViews: acc.landingPageViews + r.landingPageViews,
      conversions: acc.conversions + r.conversions
    }),
    { spend: 0, impressions: 0, clicks: 0, landingPageViews: 0, conversions: 0 }
  );
}

function dailySeries(rows: FlatRow[]): SheetsDailyRow[] {
  const byDate = new Map<string, FlatRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) || [];
    list.push(r);
    byDate.set(r.date, list);
  }
  return Array.from(byDate.entries())
    .map(([date, dayRows]) => ({ date, ...sumRows(dayRows) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function aggregateSnapshot(csv: string, accountId: string, sourceUrl: string): SheetsAccountSnapshot {
  const rows = parseRows(csv);
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
      ...sumRows(groupRows),
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
    campaigns: Object.fromEntries(Array.from(campaignGroups.entries()).map(([id, r]) => [id, dailySeries(r)])),
    adSets: Object.fromEntries(Array.from(adSetGroups.entries()).map(([id, r]) => [id, dailySeries(r)])),
    ads: Object.fromEntries(Array.from(adGroups.entries()).map(([id, r]) => [id, dailySeries(r)]))
  };

  return {
    accountId,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    range: { since: dates[0] || '', until: dates[dates.length - 1] || '' },
    daily: dailySeries(rows),
    campaigns,
    adSets,
    ads,
    dailyByEntity
  };
}
