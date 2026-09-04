import { Router } from 'express';
import { db } from '../db/database.js';
import { MetaSyncService, defaultRange } from '../services/MetaSyncService.js';
import { metaMetricsStore } from '../integrations/meta/metricsStore.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { queryParam } from '../utils/http.js';

export const metaSyncRouter = Router();

// Sincronizar consome cota da Meta e altera dados: mínimo editor.
metaSyncRouter.use(requireAuth, requireRole('editor'));

/** Situação da sincronização e das credenciais. Nunca devolve token. */
metaSyncRouter.get('/status', async (req, res) => {
  try {
    const accounts = MetaSyncService.syncableAccounts();
    const credentials = await Promise.all(
      accounts.map(async acc => {
        const check = await MetaSyncService.checkCredentials(acc);
        return {
          accountId: acc.externalAccountId,
          accountName: acc.name,
          // `source` é o NOME da variável de ambiente, não o valor.
          tokenSource: check.source,
          valid: check.valid,
          message: check.message,
          expiresAt: check.expiresAt,
          daysToExpiry: check.daysToExpiry,
          expired: check.expired,
          expiringSoon: check.expiringSoon
        };
      })
    );

    res.json({
      success: true,
      data: {
        syncableAccounts: accounts.length,
        credentials,
        stored: metaMetricsStore.summary()
      }
    });
  } catch (err: any) {
    console.error('[Meta sync] Falha ao consultar status:', err?.message);
    res.status(500).json({ success: false, error: 'Erro ao consultar o status da sincronização.' });
  }
});

/**
 * Dispara a sincronização sob demanda (botão "Atualizar Dados").
 *
 * O serviço aplica intervalo mínimo por conta; `force=true` ignora esse
 * intervalo e é o que o botão manual usa.
 */
metaSyncRouter.post('/run', async (req, res) => {
  try {
    const since = queryParam(req, 'since');
    const until = queryParam(req, 'until');
    const accountId = queryParam(req, 'accountId');
    const range = since && until ? { since, until } : defaultRange();

    if (accountId) {
      const account = db.getAccountById(accountId);
      if (!account) {
        return res.status(404).json({ success: false, error: 'Conta não encontrada.' });
      }
      const result = await MetaSyncService.syncAccount(account, range, { force: true });
      return res.json({ success: true, data: { range, accounts: [result] } });
    }

    const report = await MetaSyncService.syncAll(range, { force: true });
    res.json({ success: true, data: report });
  } catch (err: any) {
    console.error('[Meta sync] Falha na execução:', err?.message);
    res.status(500).json({ success: false, error: 'Erro ao executar a sincronização.' });
  }
});
