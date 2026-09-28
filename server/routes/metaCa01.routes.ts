import { Router } from 'express';
import { SheetsEntityRow, SheetsDailyRow } from '../integrations/sheets/types.js';
import { sheetsSnapshotStore } from '../integrations/sheets/SheetsSnapshotStore.js';
import { META_TAX_FACTOR } from '../services/NormalizerService.js';
import { db } from '../db/database.js';

/**
 * Relatório de uma conta puxada pela Meta Marketing API, no padrão da Visão
 * Geral. Genérico: serve qualquer conta com `metaAccountId` (CA 01, Manhattan,
 * Bruno, ...). Protegido pela sessão (montado atrás de `requireAuth`).
 *
 * `GET /api/meta-ca01/report?accountId=<idDaConta>&since=AAAA-MM-DD&until=...`
 *
 * `accountId` é o id da conta no painel (externalAccountId ou o id interno). O
 * período do filtro é recortado à janela que o snapshot cobre.
 */

export const metaCa01Router = Router();

/** Conta Meta do painel, por externalAccountId ou id interno. */
function resolveMetaAccount(accountId: unknown) {
  if (typeof accountId !== 'string' || !accountId) return null;
  const acc = db.getAllAccounts().find(a => a.externalAccountId === accountId || a.id === accountId);
  return acc?.metaAccountId ? acc : null;
}

const taxed = (spend: number) => Number((spend * META_TAX_FACTOR).toFixed(2));
const div = (a: number, b: number | null): number | null => (b && b > 0 ? Number((a / b).toFixed(2)) : null);

interface DaySum { spend: number; impressions: number; clicks: number; linkClicks: number; landingPageViews: number; engagement: number; leads: number; conversions: number; measuresLeads: boolean; measuresConv: boolean }

/** Soma dos dias de uma entidade dentro do período. Alcance/frequência não somam. */
function sumDays(daily: SheetsDailyRow[] | undefined, since: string, until: string): DaySum {
  const s: DaySum = { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, landingPageViews: 0, engagement: 0, leads: 0, conversions: 0, measuresLeads: false, measuresConv: false };
  for (const d of daily || []) {
    if (d.date < since || d.date > until) continue;
    s.spend += d.spend; s.impressions += d.impressions; s.clicks += d.clicks;
    s.linkClicks += d.linkClicks ?? 0; s.landingPageViews += d.landingPageViews ?? 0; s.engagement += d.engagement ?? 0;
    if (d.leads != null) { s.leads += d.leads; s.measuresLeads = true; }
    if (d.conversions != null) { s.conversions += d.conversions; s.measuresConv = true; }
  }
  return s;
}

function reportEntity(e: SheetsEntityRow, daily: SheetsDailyRow[] | undefined, since: string, until: string, fullWindow: boolean) {
  const g = sumDays(daily, since, until);
  const spend = taxed(g.spend);
  const leads = g.measuresLeads ? g.leads : null;
  const conversions = g.measuresConv ? g.conversions : null;
  return {
    id: e.id,
    name: e.name,
    campaignId: e.campaignId,
    adSetId: e.adSetId,
    objective: e.objective ?? null,
    spend,
    impressions: g.impressions,
    clicks: g.clicks,
    linkClicks: g.linkClicks,
    ctr: g.impressions > 0 ? Number(((g.clicks / g.impressions) * 100).toFixed(2)) : null,
    leads,
    cpl: div(spend, leads),
    conversions,
    cpa: div(spend, conversions),
    landingPageViews: g.landingPageViews,
    cpv: div(spend, g.landingPageViews),
    engagement: g.engagement,
    cpe: div(spend, g.engagement),
    reach: fullWindow ? (e.reach ?? null) : null,
    frequency: fullWindow ? (e.frequency ?? null) : null,
    hasLeads: g.measuresLeads,
    hasConversions: g.measuresConv,
    _leads: g.leads,
    _conversions: g.conversions,
    _lpv: g.landingPageViews
  };
}

metaCa01Router.get('/report', (req, res) => {
  const account = resolveMetaAccount(req.query.accountId);
  if (!account) return res.status(404).json({ success: false, error: 'Conta Meta não encontrada.' });

  const acc = sheetsSnapshotStore.getAccount(account.externalAccountId);
  if (!acc) {
    return res.status(503).json({ success: false, error: 'Ainda não há coleta da Meta para esta conta. Aguarde a sincronização.' });
  }

  const q = req.query as Record<string, unknown>;
  const valid = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const since = valid(q.since) && (q.since as string) > acc.range.since ? (q.since as string) : acc.range.since;
  const until = valid(q.until) && (q.until as string) < acc.range.until ? (q.until as string) : acc.range.until;
  const fullWindow = since <= acc.range.since && until >= acc.range.until;

  const build = (rows: SheetsEntityRow[], daily: Record<string, SheetsDailyRow[]>) =>
    rows.map(e => reportEntity(e, daily[e.id], since, until, fullWindow))
      .filter(e => e.spend > 0 || e.impressions > 0)
      .sort((a, b) => b.spend - a.spend);

  const campaigns = build(acc.campaigns, acc.dailyByEntity.campaigns);
  const adSets = build(acc.adSets, acc.dailyByEntity.adSets);
  const ads = build(acc.ads, acc.dailyByEntity.ads);

  const sum = (pick: (e: typeof campaigns[number]) => number) => campaigns.reduce((t, e) => t + pick(e), 0);
  const spend = sum(e => e.spend);
  const impressions = sum(e => e.impressions);
  const clicks = sum(e => e.clicks);
  const leads = sum(e => e._leads);
  const conversions = sum(e => e._conversions);
  const landingPageViews = sum(e => e._lpv);

  return res.json({
    success: true,
    data: {
      accountId: account.externalAccountId,
      accountName: account.name,
      range: { since, until },
      windowRange: acc.range,
      fetchedAt: acc.fetchedAt,
      kpis: {
        spend,
        impressions,
        clicks,
        linkClicks: sum(e => e.linkClicks ?? 0),
        ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : null,
        cpm: impressions > 0 ? Number(((spend / impressions) * 1000).toFixed(2)) : null,
        leads,
        cpl: div(spend, leads),
        conversions,
        cpa: div(spend, conversions),
        landingPageViews,
        reach: fullWindow ? (acc.reach ?? null) : null,
        frequency: fullWindow ? (acc.frequency ?? null) : null
      },
      campaigns,
      adSets,
      ads
    }
  });
});
