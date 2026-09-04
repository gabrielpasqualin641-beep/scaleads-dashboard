import fs from 'fs';
import { CampaignData, AdSetData, AdData, DailyMetricItem } from '../../models/types.js';
import { dataFile, ensureDataDir } from '../../config/paths.js';

/**
 * Métricas da Meta já normalizadas e persistidas.
 *
 * O painel lê daqui, nunca da Graph API. A API é tocada apenas pelo job de
 * sincronização — assim o carregamento da tela não depende da latência nem do
 * rate limit da Meta, e uma falha de sincronização deixa o último dado válido
 * no lugar em vez de zerar a tela.
 *
 * Os dias ficam guardados como série histórica por data, e não sobrescritos em
 * bloco: uma coleta de 7 dias não apaga o histórico de 90.
 */

const FILE = dataFile('meta-metrics.json');

export interface AccountMetrics {
  accountId: string;
  /** Série diária acumulada, indexada por data — permite comparar períodos. */
  daily: Record<string, DailyMetricItem>;
  /** Entidades do último período sincronizado. */
  campaigns: CampaignData[];
  adSets: AdSetData[];
  ads: AdData[];
  lastSyncAt: string;
  /** Janela da última sincronização, para a interface saber o que há. */
  lastSyncRange: { since: string; until: string } | null;
  /** Falha da última tentativa. O dado anterior continua servindo. */
  lastError: { message: string; at: string } | null;
}

interface MetricsFile {
  accounts: Record<string, AccountMetrics>;
  updatedAt: string;
}

const EMPTY: MetricsFile = { accounts: {}, updatedAt: '' };

class MetaMetricsStore {
  private cache: MetricsFile;

  constructor() {
    this.cache = this.load();
  }

  private load(): MetricsFile {
    try {
      if (fs.existsSync(FILE)) {
        const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as MetricsFile;
        if (parsed && typeof parsed === 'object' && parsed.accounts) return parsed;
      }
    } catch (err) {
      console.error('[MetaMetrics] Falha ao ler meta-metrics.json:', err);
    }
    return { ...EMPTY, accounts: {} };
  }

  private persist(): void {
    ensureDataDir();
    this.cache.updatedAt = new Date().toISOString();
    fs.writeFileSync(FILE, JSON.stringify(this.cache, null, 2), 'utf-8');
  }

  public get(accountId: string): AccountMetrics | null {
    return this.cache.accounts[accountId] ?? null;
  }

  public has(accountId: string): boolean {
    return !!this.cache.accounts[accountId];
  }

  /** Dias do intervalo pedido, em ordem. Ausência é ausência — não vira zero. */
  public getDailyRange(accountId: string, since: string, until: string): DailyMetricItem[] {
    const account = this.cache.accounts[accountId];
    if (!account) return [];
    return Object.values(account.daily)
      .filter(d => d.date >= since && d.date <= until)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Grava o resultado de uma sincronização bem-sucedida.
   *
   * Os dias entram por merge: a coleta nova substitui os dias que traz e
   * preserva os demais.
   */
  public saveSync(input: {
    accountId: string;
    daily: DailyMetricItem[];
    campaigns: CampaignData[];
    adSets: AdSetData[];
    ads: AdData[];
    range: { since: string; until: string };
  }): void {
    const current = this.cache.accounts[input.accountId];
    const daily: Record<string, DailyMetricItem> = { ...(current?.daily ?? {}) };
    for (const item of input.daily) daily[item.date] = item;

    this.cache.accounts[input.accountId] = {
      accountId: input.accountId,
      daily,
      campaigns: input.campaigns,
      adSets: input.adSets,
      ads: input.ads,
      lastSyncAt: new Date().toISOString(),
      lastSyncRange: input.range,
      lastError: null
    };
    this.persist();
  }

  /**
   * Registra a falha sem apagar o que já existia.
   *
   * A tela continua mostrando o último dado válido e sinaliza que a atualização
   * falhou — melhor que uma tela zerada por erro de rede.
   */
  public saveError(accountId: string, message: string): void {
    const current = this.cache.accounts[accountId];
    this.cache.accounts[accountId] = {
      accountId,
      daily: current?.daily ?? {},
      campaigns: current?.campaigns ?? [],
      adSets: current?.adSets ?? [],
      ads: current?.ads ?? [],
      lastSyncAt: current?.lastSyncAt ?? '',
      lastSyncRange: current?.lastSyncRange ?? null,
      lastError: { message, at: new Date().toISOString() }
    };
    this.persist();
  }

  public summary(): Array<{
    accountId: string;
    days: number;
    campaigns: number;
    adSets: number;
    ads: number;
    lastSyncAt: string;
    lastError: string | null;
  }> {
    return Object.values(this.cache.accounts).map(a => ({
      accountId: a.accountId,
      days: Object.keys(a.daily).length,
      campaigns: a.campaigns.length,
      adSets: a.adSets.length,
      ads: a.ads.length,
      lastSyncAt: a.lastSyncAt,
      lastError: a.lastError?.message ?? null
    }));
  }

  public reload(): void {
    this.cache = this.load();
  }
}

export const metaMetricsStore = new MetaMetricsStore();
