import { Router } from 'express';
import { buildSnapshot, isConfigured } from '../integrations/metaMarketing/ca01Insights.js';
import { SheetsAccountSnapshot, SheetsEntityRow, SheetsDailyRow } from '../integrations/sheets/types.js';
import { sheetsSnapshotStore } from '../integrations/sheets/SheetsSnapshotStore.js';
import { META_TAX_FACTOR } from '../services/NormalizerService.js';
import { db } from '../db/database.js';

/**
 * Rota da CA 01 pela Meta Marketing API.
 *
 * `GET /api/meta-ca01?since=AAAA-MM-DD&until=AAAA-MM-DD&refresh=1`
 *
 * Protegida pela sessão (montada atrás de `requireAuth`, como as demais).
 * Cache de 15 min em memória por janela, com `refresh=1` para forçar. O erro
 * volta em JSON e nunca inclui o token (ele só existe em `process.env`).
 */

export const metaCa01Router = Router();

interface Cached { at: number; data: SheetsAccountSnapshot }
const cache = new Map<string, Cached>();
const TTL_MS = 15 * 60 * 1000;

function range(query: Record<string, unknown>): { since: string; until: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const until = typeof query.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.until) ? query.until : iso(new Date());
  const since = typeof query.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.since)
    ? query.since
    : iso(new Date(Date.now() - 30 * 86_400_000));
  return { since, until };
}

metaCa01Router.get('/', async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ success: false, error: 'Meta não configurada no servidor (META_ACCESS_TOKEN / META_CA01_ACCOUNT_ID).' });
  }

  const { since, until } = range(req.query as Record<string, unknown>);
  const key = `${since}:${until}`;
  const refresh = req.query.refresh === '1';
  const hit = cache.get(key);

  if (!refresh && hit && Date.now() - hit.at < TTL_MS) {
    res.set('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    return res.json({ success: true, cached: true, data: hit.data });
  }

  try {
    const data = await buildSnapshot('ca01', since, until);
    cache.set(key, { at: Date.now(), data });
    res.set('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    return res.json({ success: true, cached: false, data });
  } catch (err) {
    // Mensagem da Meta, sem token (ele não aparece no corpo de erro da Meta).
    return res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Falha ao consultar a Meta.' });
  }
});

/* -------------------------------------------------------------------------- */
/* Relatório da CA 01 (Visão Geral no padrão do painel)                       */
/* -------------------------------------------------------------------------- */

/** Conta do painel cujo nome é a CA 01 - Giacobelli. */
function ca01AccountId(): string | null {
  const acc = db.getAllAccounts().find(a => /ca\s*0?1\b/i.test(a.name) && /giacobelli/i.test(a.name));
  return acc?.externalAccountId || null;
}

const taxed = (spend: number) => Number((spend * META_TAX_FACTOR).toFixed(2));
const div = (a: number, b: number | null): number | null => (b && b > 0 ? Number((a / b).toFixed(2)) : null);

/** Soma dos dias de uma entidade dentro do período. Reach/frequência não somam. */
interface DaySum { spend: number; impressions: number; clicks: number; linkClicks: number; landingPageViews: number; engagement: number; leads: number; conversions: number; measuresLeads: boolean; measuresConv: boolean }

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

/** Entidade no formato do relatório, para o período pedido (imposto Meta incluso). */
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
    // Alcance/frequência não somam por dia: só no período que cobre a janela toda.
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
  const accountId = ca01AccountId();
  if (!accountId) return res.status(404).json({ success: false, error: 'Conta CA 01 não encontrada.' });

  const acc = sheetsSnapshotStore.getAccount(accountId);
  if (!acc) {
    return res.status(503).json({ success: false, error: 'Ainda não há coleta da Meta para a CA 01. Aguarde a sincronização.' });
  }

  // Período pedido pelo filtro; recortado à janela que o snapshot cobre.
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
      accountId,
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
