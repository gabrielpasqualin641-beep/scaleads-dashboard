import { Router } from 'express';
import { buildSnapshot, isConfigured } from '../integrations/metaMarketing/ca01Insights.js';
import { SheetsAccountSnapshot, SheetsEntityRow } from '../integrations/sheets/types.js';
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

/** Métricas de uma entidade do snapshot no formato do relatório (imposto Meta incluso). */
function reportEntity(e: SheetsEntityRow) {
  const spend = taxed(e.spend);
  const leads = e.leads ?? 0;
  const conversions = e.conversions ?? 0;
  const lpv = e.landingPageViews ?? 0;
  return {
    id: e.id,
    name: e.name,
    campaignId: e.campaignId,
    adSetId: e.adSetId,
    objective: e.objective ?? null,
    spend,
    impressions: e.impressions,
    clicks: e.clicks,
    linkClicks: e.linkClicks ?? null,
    ctr: e.impressions > 0 ? Number(((e.clicks / e.impressions) * 100).toFixed(2)) : null,
    leads: e.leads ?? null,
    cpl: div(spend, e.leads ?? null),
    conversions: e.conversions ?? null,
    cpa: div(spend, e.conversions ?? null),
    landingPageViews: e.landingPageViews ?? null,
    cpv: div(spend, e.landingPageViews ?? null),
    engagement: e.engagement ?? null,
    cpe: div(spend, e.engagement ?? null),
    reach: e.reach ?? null,
    frequency: e.frequency ?? null,
    // Vendas e leads são zero de verdade quando a origem mede e não houve;
    // mantém os brutos para o front decidir o rótulo (— vs 0).
    hasLeads: e.leads != null,
    hasConversions: e.conversions != null,
    _leads: leads,
    _conversions: conversions,
    _lpv: lpv
  };
}

metaCa01Router.get('/report', (req, res) => {
  const accountId = ca01AccountId();
  if (!accountId) return res.status(404).json({ success: false, error: 'Conta CA 01 não encontrada.' });

  const acc = sheetsSnapshotStore.getAccount(accountId);
  if (!acc) {
    return res.status(503).json({ success: false, error: 'Ainda não há coleta da Meta para a CA 01. Aguarde a sincronização.' });
  }

  const campaigns = acc.campaigns.map(reportEntity).sort((a, b) => b.spend - a.spend);
  const adSets = acc.adSets.map(reportEntity).sort((a, b) => b.spend - a.spend);
  const ads = acc.ads.map(reportEntity).sort((a, b) => b.spend - a.spend);

  // KPIs da conta: somas do que é somável; alcance/frequência vêm do snapshot.
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
      range: acc.range,
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
        reach: acc.reach ?? null,
        frequency: acc.frequency ?? null
      },
      campaigns,
      adSets,
      ads
    }
  });
});
