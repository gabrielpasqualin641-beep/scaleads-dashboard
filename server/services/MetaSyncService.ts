import { db } from '../db/database.js';
import { AdAccount, PeriodSelection } from '../models/types.js';
import { MetaAdsProvider } from '../providers/MetaAdsProvider.js';
import { metaMetricsStore } from '../integrations/meta/metricsStore.js';
import { normalizeAccountId } from '../integrations/metaMcp/MetaMcpSnapshotStore.js';
import { getAccessToken, hasAccessToken, tokenStatus, validateToken } from '../integrations/meta/credentials.js';
import { MetaApiError } from '../integrations/meta/graphClient.js';
import { SYNC_DELAY_MS } from '../integrations/meta/config.js';

/**
 * Sincronização com a Meta Marketing API.
 *
 * É o único ponto que fala com a Graph API. O painel lê o resultado persistido,
 * então nenhuma tela depende da latência ou do rate limit da Meta.
 *
 * Falha de uma conta não derruba as demais nem apaga o que já havia: o erro é
 * registrado e o último dado válido continua servindo.
 */

const provider = new MetaAdsProvider();

/** Intervalo mínimo entre sincronizações da mesma conta, evitando disparos repetidos. */
const MIN_INTERVAL_MS = Number(process.env.META_SYNC_MIN_INTERVAL_MS) || 5 * 60_000;

export interface AccountSyncResult {
  accountId: string;
  accountName: string;
  ok: boolean;
  message: string;
  days?: number;
  campaigns?: number;
  adSets?: number;
  ads?: number;
  skipped?: boolean;
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  range: { since: string; until: string };
  accounts: AccountSyncResult[];
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Janela padrão: últimos 30 dias encerrando ontem — a Meta ainda consolida hoje. */
export function defaultRange(days = 30): { since: string; until: string } {
  const until = new Date();
  until.setDate(until.getDate() - 1);
  const since = new Date(until);
  since.setDate(since.getDate() - (days - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { since: iso(since), until: iso(until) };
}

export class MetaSyncService {
  /** Contas Meta com token disponível. */
  public static syncableAccounts(): AdAccount[] {
    return db.getAllAccounts().filter((acc: AdAccount) => acc.platform === 'meta_ads' && hasAccessToken(acc));
  }

  private static tooRecent(account: AdAccount): boolean {
    const stored = metaMetricsStore.get(normalizeAccountId(account.externalAccountId));
    if (!stored?.lastSyncAt) return false;
    return Date.now() - new Date(stored.lastSyncAt).getTime() < MIN_INTERVAL_MS;
  }

  public static async syncAccount(
    account: AdAccount,
    range: { since: string; until: string },
    options: { force?: boolean } = {}
  ): Promise<AccountSyncResult> {
    const accountId = normalizeAccountId(account.externalAccountId);
    const base: AccountSyncResult = { accountId, accountName: account.name, ok: false, message: '' };

    if (!options.force && this.tooRecent(account)) {
      return { ...base, ok: true, skipped: true, message: 'Sincronizada há pouco; pulada.' };
    }

    const token = getAccessToken(account);
    if (!token) {
      const message = 'Sem token da Meta configurado para esta conta.';
      metaMetricsStore.saveError(accountId, message);
      return { ...base, message };
    }

    const status = tokenStatus(account);
    if (status.expired) {
      const message = 'Token da Meta expirado. Gere um novo e atualize a variável de ambiente.';
      metaMetricsStore.saveError(accountId, message);
      return { ...base, message };
    }
    if (status.expiringSoon) {
      console.warn(`[Meta sync] Token da conta act_${accountId} vence em ${status.daysToExpiry} dia(s).`);
    }

    const period: PeriodSelection = {
      preset: 'custom',
      startDate: range.since,
      endDate: range.until,
      compare: false,
      // Persistimos o número bruto da Meta. O ajuste de imposto é decisão de
      // exibição e acontece na leitura, não no armazenamento.
      includeMetaTax: false
    };

    console.log(`[Meta sync] Conta act_${accountId} · período ${range.since} → ${range.until}`);

    try {
      const [daily, campaigns, adSets, ads] = await Promise.all([
        provider.getDailyInsights(token, accountId, period),
        provider.getCampaigns(token, accountId, period),
        provider.getAdSets(token, accountId, period),
        provider.getAds(token, accountId, period)
      ]);

      metaMetricsStore.saveSync({ accountId, daily, campaigns, adSets, ads, range });
      db.updateAccount(account.id, { lastSyncAt: new Date().toISOString() });

      console.log(
        `[Meta sync] act_${accountId}: ${daily.length} dias, ${campaigns.length} campanhas, ` +
          `${adSets.length} conjuntos, ${ads.length} anúncios`
      );

      return {
        ...base,
        ok: true,
        message: 'Sincronizada.',
        days: daily.length,
        campaigns: campaigns.length,
        adSets: adSets.length,
        ads: ads.length
      };
    } catch (err) {
      const message = err instanceof MetaApiError ? err.message : 'Falha inesperada na sincronização.';
      // Guarda o erro sem tocar nos dados anteriores.
      metaMetricsStore.saveError(accountId, message);
      console.error(`[Meta sync] act_${accountId} falhou: ${message}`);
      return { ...base, message };
    }
  }

  /**
   * Sincroniza todas as contas com token, uma de cada vez.
   *
   * Sequencial e com pausa entre contas de propósito: disparar todas juntas
   * estoura o rate limit da Meta por app.
   */
  public static async syncAll(
    range = defaultRange(),
    options: { force?: boolean } = {}
  ): Promise<SyncReport> {
    const startedAt = new Date().toISOString();
    const accounts = this.syncableAccounts();
    const results: AccountSyncResult[] = [];

    console.log(`[Meta sync] Iniciando · ${accounts.length} conta(s) · ${range.since} → ${range.until}`);

    for (const [index, account] of accounts.entries()) {
      results.push(await this.syncAccount(account, range, options));
      if (index < accounts.length - 1) await sleep(SYNC_DELAY_MS);
    }

    // Métricas novas invalidam os agregados em cache do dashboard.
    db.clearCache();

    const ok = results.filter(r => r.ok).length;
    console.log(`[Meta sync] Concluída · ${ok}/${results.length} conta(s) com sucesso`);

    return { startedAt, finishedAt: new Date().toISOString(), range, accounts: results };
  }

  /** Diagnóstico de credencial, sem expor o token. */
  public static async checkCredentials(account: AdAccount) {
    const token = getAccessToken(account);
    if (!token) {
      return { ...tokenStatus(account), valid: false, message: 'Nenhum token configurado.', scopes: [] as string[] };
    }
    const validation = await validateToken(token);
    return { ...tokenStatus(account), ...validation };
  }
}
