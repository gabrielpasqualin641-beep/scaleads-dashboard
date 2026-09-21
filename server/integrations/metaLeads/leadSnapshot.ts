import { ExportedLead } from './leadExports.js';
import { slugify } from '../sheets/fetchAndAggregate.js';
import { SheetsAccountSnapshot, SheetsDailyRow, SheetsMetricSet } from '../sheets/types.js';

/**
 * Monta um snapshot de conta a partir da planilha de leads, para a conta que
 * não tem Adveronix — só a planilha de backup de leads como origem.
 *
 * A planilha de leads não traz gasto, impressões nem cliques: é uma linha por
 * lead, com anúncio e resposta. Então este snapshot reporta apenas a contagem
 * de leads por campanha, conjunto e anúncio; as métricas de mídia ficam
 * zeradas na estrutura mas a conta é marcada com `hasSpend: false`, e o
 * provider as trata como N/D — nunca R$ 0, que afirmaria "não gastou" onde a
 * verdade é "esta origem não mede".
 *
 * Os ids seguem o mesmo esquema do snapshot do Adveronix
 * (`sheet_camp_`/`sheet_adset_`/`sheet_ad_`), de modo que o `adKey` de cada
 * anúncio casa com o do export de leads e o MQL por criativo se encaixa.
 */

const campaignId = (l: ExportedLead) => `sheet_camp_${slugify(l.campaignName)}`;
const adSetId = (l: ExportedLead) => `sheet_adset_${slugify(l.campaignName)}_${slugify(l.adSetName)}`;
const adId = (l: ExportedLead) => `sheet_ad_${slugify(l.campaignName)}_${slugify(l.adSetName)}_${slugify(l.adName)}`;

/** Métricas de um grupo: só leads são reais; mídia fica zerada (N/D via hasSpend). */
function metrics(leads: number): SheetsMetricSet {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    landingPageViews: null,
    conversions: null,
    leads,
    reach: null
  };
}

function dailySeries(leads: ExportedLead[]): SheetsDailyRow[] {
  const byDate = new Map<string, number>();
  for (const l of leads) byDate.set(l.date, (byDate.get(l.date) || 0) + 1);
  return Array.from(byDate.entries())
    .map(([date, count]) => ({ date, ...metrics(count) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function snapshotFromLeads(
  leads: ExportedLead[],
  accountId: string,
  sourceUrl: string
): SheetsAccountSnapshot {
  const campGroups = new Map<string, ExportedLead[]>();
  const setGroups = new Map<string, ExportedLead[]>();
  const adGroups = new Map<string, ExportedLead[]>();

  const push = (groups: Map<string, ExportedLead[]>, id: string, l: ExportedLead) => {
    const list = groups.get(id);
    if (list) list.push(l);
    else groups.set(id, [l]);
  };

  for (const l of leads) {
    push(campGroups, campaignId(l), l);
    push(setGroups, adSetId(l), l);
    push(adGroups, adId(l), l);
  }

  const dates = leads.map(l => l.date).filter(Boolean).sort();

  const campaigns = Array.from(campGroups.entries()).map(([id, group]) => ({
    id,
    name: group[0].campaignName || 'Sem nome',
    ...metrics(group.length)
  }));
  const adSets = Array.from(setGroups.entries()).map(([id, group]) => ({
    id,
    name: group[0].adSetName || 'Sem nome',
    campaignId: campaignId(group[0]),
    ...metrics(group.length)
  }));
  const ads = Array.from(adGroups.entries()).map(([id, group]) => ({
    id,
    name: group[0].adName || 'Sem nome',
    campaignId: campaignId(group[0]),
    adSetId: adSetId(group[0]),
    ...metrics(group.length)
  }));

  const dailyByEntity = {
    campaigns: Object.fromEntries(Array.from(campGroups.entries()).map(([id, g]) => [id, dailySeries(g)])),
    adSets: Object.fromEntries(Array.from(setGroups.entries()).map(([id, g]) => [id, dailySeries(g)])),
    ads: Object.fromEntries(Array.from(adGroups.entries()).map(([id, g]) => [id, dailySeries(g)]))
  };

  return {
    accountId,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    range: { since: dates[0] || '', until: dates[dates.length - 1] || '' },
    // Só a contagem de leads é real nesta origem.
    availableMetrics: ['leads'],
    hasSpend: false,
    daily: dailySeries(leads),
    campaigns,
    adSets,
    ads,
    dailyByEntity
  };
}
