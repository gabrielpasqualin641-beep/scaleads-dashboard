import { parseMcpNumber, parseMcpResults, parseMcpEntities } from './parser.js';
import {
  MetaMcpSnapshot,
  McpAccountSnapshot,
  McpAccountCatalogItem,
  McpDailyRow,
  McpEntityRow,
  McpCreative
} from './types.js';

/**
 * Payload cru enviado pelo bridge MCP: exatamente o que as ferramentas
 * `ads_get_ad_accounts` e `ads_get_ad_entities` devolvem, sem pré-tratamento.
 */
export interface RawMcpIngestPayload {
  toolsUsed?: string[];
  generatedAt?: string;
  /** Saída de `ads_get_ad_accounts`. */
  accountsPayload?: { ad_accounts?: unknown[] };
  accounts?: RawMcpAccountPayload[];
}

export interface RawMcpAccountPayload {
  accountId: string;
  range: { since: string; until: string };
  fetchedAt?: string;
  /** Cada campo recebe a saída de `ads_get_ad_entities` no nível correspondente. */
  daily?: { ad_entities?: unknown };
  campaigns?: { ad_entities?: unknown };
  adSets?: { ad_entities?: unknown };
  ads?: { ad_entities?: unknown };
  /** Saída de `ads_get_creatives`, usada para a miniatura do anúncio. */
  creatives?: { ad_creatives?: unknown[] };
  /** Mesmos níveis com `time_increment=1`: uma linha por entidade e dia. */
  campaignsDaily?: { ad_entities?: unknown };
  adSetsDaily?: { ad_entities?: unknown };
  adsDaily?: { ad_entities?: unknown };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toCatalogItem(raw: Record<string, unknown>): McpAccountCatalogItem {
  return {
    adAccountId: str(raw.ad_account_id),
    adAccountName: str(raw.ad_account_name),
    businessId: str(raw.business_id),
    businessName: str(raw.business_name).trim(),
    currency: str(raw.currency) || 'BRL',
    accountStatus: str(raw.account_status),
    isAdsMcpEnabled: raw.is_ads_mcp_enabled === true,
    isQueryable: raw.is_queryable === true,
    notQueryableReason: typeof raw.not_queryable_reason === 'string' ? raw.not_queryable_reason : null
  };
}

/**
 * `lead` é o único campo de lead disponível na Meta Ads API através do MCP.
 * `omni_purchase_values` traz a receita atribuída. Não existe campo de MQL nem
 * de agendamento em nenhum nível — essas ficam de fora e viram N/D.
 */
function toDailyRow(raw: Record<string, unknown>): McpDailyRow {
  return {
    date: str(raw.date_start),
    spend: parseMcpNumber(raw.amount_spent),
    impressions: parseMcpNumber(raw.impressions),
    reach: parseMcpNumber(raw.reach),
    frequency: parseMcpNumber(raw.frequency),
    clicks: parseMcpNumber(raw.clicks),
    leads: parseMcpNumber(raw.lead),
    conversions: parseMcpNumber(raw.offsite_conversion_fb_pixel_purchase),
    revenue: parseMcpNumber(raw.omni_purchase_values)
  };
}

function toCreative(raw: Record<string, unknown>): McpCreative {
  return {
    id: str(raw.id),
    thumbnailUrl: str(raw.thumbnail_url) || str(raw.image_url) || null,
    objectType: str(raw.object_type) || null,
    videoId: str(raw.video_id) || null
  };
}

/** `PRIVACY_CHECK_FAIL` é o objeto que a Meta devolve quando oculta o criativo real. */
function toCreativeFormat(objectType: string | null, videoId: string | null): McpEntityRow['creativeFormat'] {
  if (videoId || objectType === 'VIDEO') return 'video';
  if (objectType === 'SHARE' || objectType === 'PHOTO') return 'image';
  return null;
}

function toEntityRow(raw: Record<string, unknown>): McpEntityRow {
  const results = parseMcpResults(raw.results);
  return {
    creativeId: str(raw.creative_id) || null,
    id: str(raw.id),
    name: str(raw.name),
    status: str(raw.status),
    objective: str(raw.objective) || undefined,
    campaignId: str(raw.campaign_id) || undefined,
    adSetId: str(raw.adset_id) || undefined,
    spend: parseMcpNumber(raw.amount_spent),
    impressions: parseMcpNumber(raw.impressions),
    reach: parseMcpNumber(raw.reach),
    frequency: parseMcpNumber(raw.frequency),
    clicks: parseMcpNumber(raw.clicks),
    leads: parseMcpNumber(raw.lead),
    conversions: parseMcpNumber(raw.offsite_conversion_fb_pixel_purchase),
    revenue: parseMcpNumber(raw.omni_purchase_values),
    results: results.value,
    resultIndicator: results.indicator
  };
}

/**
 * Agrupa as linhas de `time_increment=1` por entidade, em ordem cronológica.
 * A Meta devolve uma linha por (entidade, dia) e omite dias sem veiculação —
 * a série fica com buracos reais, que é o comportamento correto.
 */
function groupDailyByEntity(adEntities: unknown): Record<string, McpDailyRow[]> {
  const grouped: Record<string, McpDailyRow[]> = {};

  for (const raw of parseMcpEntities(adEntities)) {
    const id = str(raw.id);
    const row = toDailyRow(raw);
    if (!id || !row.date) continue;
    (grouped[id] ||= []).push(row);
  }

  for (const rows of Object.values(grouped)) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
  }
  return grouped;
}

export function buildSnapshot(payload: RawMcpIngestPayload): MetaMcpSnapshot {
  const catalog = (payload.accountsPayload?.ad_accounts ?? [])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(toCatalogItem);

  const catalogById = new Map(catalog.map(c => [c.adAccountId, c]));
  const accounts: Record<string, McpAccountSnapshot> = {};

  for (const acc of payload.accounts ?? []) {
    const accountId = acc.accountId.replace(/^act_/, '');
    const meta = catalogById.get(accountId);

    const creatives: Record<string, McpCreative> = {};
    for (const raw of acc.creatives?.ad_creatives ?? []) {
      if (!raw || typeof raw !== 'object') continue;
      const creative = toCreative(raw as Record<string, unknown>);
      if (creative.id) creatives[creative.id] = creative;
    }

    // Anexa a miniatura em cada anúncio para o provider não precisar do join.
    const ads = parseMcpEntities(acc.ads?.ad_entities).map(toEntityRow).map(ad => {
      const creative = ad.creativeId ? creatives[ad.creativeId] : undefined;
      if (!creative) return ad;
      return {
        ...ad,
        thumbnailUrl: creative.thumbnailUrl,
        creativeFormat: toCreativeFormat(creative.objectType, creative.videoId)
      };
    });

    accounts[accountId] = {
      creatives,
      ads,
      dailyByEntity: {
        campaigns: groupDailyByEntity(acc.campaignsDaily?.ad_entities),
        adSets: groupDailyByEntity(acc.adSetsDaily?.ad_entities),
        ads: groupDailyByEntity(acc.adsDaily?.ad_entities)
      },
      accountId,
      name: meta?.adAccountName || accountId,
      currency: meta?.currency || 'BRL',
      accountStatus: meta?.accountStatus || 'UNKNOWN',
      businessId: meta?.businessId,
      businessName: meta?.businessName,
      fetchedAt: acc.fetchedAt || new Date().toISOString(),
      range: acc.range,
      daily: parseMcpEntities(acc.daily?.ad_entities).map(toDailyRow).filter(d => d.date),
      campaigns: parseMcpEntities(acc.campaigns?.ad_entities).map(toEntityRow),
      adSets: parseMcpEntities(acc.adSets?.ad_entities).map(toEntityRow)
    };
  }

  return {
    version: 1,
    generatedAt: payload.generatedAt || new Date().toISOString(),
    toolsUsed: payload.toolsUsed ?? [],
    catalog,
    accounts
  };
}
