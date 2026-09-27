import { Router } from 'express';
import { buildSnapshot, isConfigured } from '../integrations/metaMarketing/ca01Insights.js';
import { SheetsAccountSnapshot } from '../integrations/sheets/types.js';

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
