import { Router } from 'express';
import { db } from '../db/database.js';
import { metaMcpSnapshotStore, normalizeAccountId } from '../integrations/metaMcp/MetaMcpSnapshotStore.js';
import { buildSnapshot, RawMcpIngestPayload } from '../integrations/metaMcp/buildSnapshot.js';
import { AdAccount } from '../models/types.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { allowIngestKeyOn } from '../middleware/allowIngestKey.js';

export const metaMcpRouter = Router();

// A integração inteira mexe em dados de todos os clientes: mínimo editor, e
// vincular conta a cliente fica restrito a administradores. A exceção é
// POST /snapshot, que também aceita a chave de ingestão da coleta automática.
metaMcpRouter.use(
  allowIngestKeyOn(
    [
      { method: 'POST', path: '/snapshot' },
      { method: 'GET', path: '/status' }
    ],
    (req, res, next) => requireAuth(req, res, () => requireRole('editor')(req, res, next))
  )
);

/**
 * O runtime do Express não consegue chamar o MCP Meta Ads: o servidor MCP é um
 * conector remoto autenticado dentro do cliente Claude, sem endpoint nem
 * credencial expostos a este processo. Quem executa as ferramentas é o cliente,
 * que entrega o resultado real aqui.
 */
const RUNTIME_CAPABILITY = {
  backendCanCallMcpDirectly: false,
  reason:
    'O servidor Meta Ads MCP é um conector remoto autenticado no cliente Claude. Não há entrada em .mcp.json, ' +
    'transporte stdio local nem credencial disponível para este processo Node. Os dados reais chegam por ingestão ' +
    'em POST /api/meta-mcp/snapshot.',
  ingestEndpoint: 'POST /api/meta-mcp/snapshot'
};

metaMcpRouter.get('/status', (req, res) => {
  const snapshot = metaMcpSnapshotStore.getSnapshot();
  const accounts = Object.values(snapshot.accounts).map(acc => ({
    accountId: acc.accountId,
    name: acc.name,
    currency: acc.currency,
    range: acc.range,
    fetchedAt: acc.fetchedAt,
    dailyRows: acc.daily.length,
    campaigns: acc.campaigns.length,
    adSets: acc.adSets.length,
    ads: acc.ads.length
  }));

  res.json({
    success: true,
    data: {
      runtime: RUNTIME_CAPABILITY,
      generatedAt: snapshot.generatedAt,
      toolsUsed: snapshot.toolsUsed,
      catalogSize: snapshot.catalog.length,
      accounts
    }
  });
});

/** Catálogo real de contas devolvido por `ads_get_ad_accounts`. */
metaMcpRouter.get('/accounts', (req, res) => {
  const catalog = metaMcpSnapshotStore.getCatalog();
  const linked = new Map<string, AdAccount>();
  for (const client of db.getClients()) {
    for (const acc of db.getAccountsByClient(client.id)) {
      linked.set(normalizeAccountId(acc.externalAccountId), acc);
    }
  }

  res.json({
    success: true,
    data: catalog.map(item => {
      const existing = linked.get(item.adAccountId);
      return {
        ...item,
        hasSnapshot: metaMcpSnapshotStore.hasRealDataFor(item.adAccountId),
        linkedClientId: existing?.clientId ?? null,
        linkedAccountId: existing?.id ?? null
      };
    })
  });
});

/**
 * Recebe a saída bruta das ferramentas MCP (`ads_get_ad_accounts` e
 * `ads_get_ad_entities`) e a converte no snapshot que os providers consomem.
 */
metaMcpRouter.post('/snapshot', (req, res) => {
  const payload = req.body as RawMcpIngestPayload;

  if (!payload || (!payload.accountsPayload && !payload.accounts)) {
    return res.status(400).json({
      success: false,
      error: 'Payload inválido. Esperado { toolsUsed, accountsPayload, accounts[] } com a saída bruta do MCP.'
    });
  }

  const snapshot = buildSnapshot(payload);
  metaMcpSnapshotStore.save(snapshot);

  // Dados novos invalidam qualquer agregado em cache.
  db.clearCache();

  res.json({
    success: true,
    data: {
      accountsIngested: Object.keys(snapshot.accounts).length,
      catalogSize: snapshot.catalog.length,
      accounts: Object.values(snapshot.accounts).map(a => ({
        accountId: a.accountId,
        name: a.name,
        dailyRows: a.daily.length,
        campaigns: a.campaigns.length,
        adSets: a.adSets.length,
        ads: a.ads.length
      }))
    }
  });
});

/** Vincula uma conta Meta real (ID verdadeiro do catálogo MCP) a um cliente. */
metaMcpRouter.post('/link', requireRole('admin'), (req, res) => {
  const { clientId, adAccountId } = req.body as { clientId?: string; adAccountId?: string };

  if (!clientId || !adAccountId) {
    return res.status(400).json({ success: false, error: 'clientId e adAccountId são obrigatórios.' });
  }
  if (!db.getClientById(clientId)) {
    return res.status(404).json({ success: false, error: `Cliente ${clientId} não encontrado.` });
  }

  const normalized = normalizeAccountId(adAccountId);
  const catalogItem = metaMcpSnapshotStore.getCatalog().find(c => c.adAccountId === normalized);
  if (!catalogItem) {
    return res.status(404).json({
      success: false,
      error: `Conta ${normalized} não está no catálogo real do MCP. Contas fictícias não são aceitas.`
    });
  }

  const existing = db
    .getAccountsByClient(clientId)
    .find(a => normalizeAccountId(a.externalAccountId) === normalized);

  const fields = {
    name: catalogItem.adAccountName,
    currency: catalogItem.currency,
    businessId: catalogItem.businessId,
    businessName: catalogItem.businessName,
    mcpEnabled: catalogItem.isAdsMcpEnabled,
    mcpQueryable: catalogItem.isQueryable,
    mcpUnavailableReason: catalogItem.notQueryableReason ?? undefined,
    status: (catalogItem.accountStatus === 'ACTIVE' ? 'active' : 'paused') as AdAccount['status']
  };

  const account = existing
    ? db.updateAccount(existing.id, fields)
    : db.createAccount({
        clientId,
        externalAccountId: normalized,
        platform: 'meta_ads',
        timezone: 'America/Sao_Paulo',
        lastSyncAt: new Date().toISOString(),
        ...fields
      });

  db.clearCache();
  res.json({ success: true, data: account });
});
