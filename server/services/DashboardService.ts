import { db } from '../db/database.js';
import {
  DashboardOverviewResponse,
  PeriodSelection,
  NormalizedMetrics,
  DailyMetricItem,
  CampaignData,
  AdSetData,
  AdData,
  DataSource,
  MetricName,
  AdAccount,
  SnapshotFreshness
} from '../models/types.js';
import { NormalizerService, RawMetricInput } from './NormalizerService.js';
import { resolveProvider, resolveDataSource, combineDataSources, mockProvider } from './ProviderResolver.js';
import { metaMcpSnapshotStore } from '../integrations/metaMcp/MetaMcpSnapshotStore.js';
import { sheetsSnapshotStore } from '../integrations/sheets/SheetsSnapshotStore.js';

/** Acima disso o snapshot é considerado velho o bastante para avisar. */
const STALE_AFTER_DAYS = 7;

export class DashboardService {
  /**
   * Idade e cobertura da coleta (MCP ou planilha, conforme a origem resolvida
   * de cada conta) para as contas em questão.
   *
   * Sem isso o painel apresenta dado de semanas atrás com a mesma cara de dado
   * fresco. Usa a coleta mais antiga entre as contas, que é o pior caso.
   */
  private static snapshotFreshness(
    accounts: AdAccount[],
    period: PeriodSelection
  ): SnapshotFreshness | null {
    const snapshots = accounts
      .map(acc => {
        const source = resolveDataSource(acc);
        if (source === 'sheets') return sheetsSnapshotStore.getAccount(acc.externalAccountId);
        if (source === 'meta_mcp') return metaMcpSnapshotStore.getAccount(acc.externalAccountId);
        return undefined;
      })
      .filter((s): s is NonNullable<typeof s> => !!s && !!s.fetchedAt);

    if (snapshots.length === 0) return null;

    const oldest = snapshots.reduce((a, b) => (a.fetchedAt < b.fetchedAt ? a : b));
    const ageInDays = (Date.now() - new Date(oldest.fetchedAt).getTime()) / 86_400_000;

    // Cobertura combinada: a menor janela que contém todas as coletas.
    const ranges = snapshots.map(s => s.range).filter((r): r is NonNullable<typeof r> => !!r?.since && !!r?.until);
    const coverage = ranges.length
      ? {
          since: ranges.reduce((min, r) => (r.since < min ? r.since : min), ranges[0].since),
          until: ranges.reduce((max, r) => (r.until > max ? r.until : max), ranges[0].until)
        }
      : null;

    return {
      collectedAt: oldest.fetchedAt,
      ageInDays: Number(ageInDays.toFixed(1)),
      coverage,
      periodExceedsCoverage: !!coverage && (period.startDate < coverage.since || period.endDate > coverage.until),
      stale: ageInDays > STALE_AFTER_DAYS
    };
  }


  /**
   * Soma as contribuições diárias mantendo N/D: uma métrica só some quando
   * nenhuma das origens tinha o dado, evitando que ausência vire zero real.
   */
  private static sumContributions(rows: DailyMetricItem[]): RawMetricInput {
    const field = (key: keyof DailyMetricItem & MetricName): number | null => {
      const available = rows.filter(r => !r.unavailable.includes(key));
      if (available.length === 0) return null;
      return available.reduce((total, r) => total + (r[key] as number), 0);
    };

    return {
      spend: field('spend'),
      impressions: field('impressions'),
      reach: field('reach'),
      clicks: field('clicks'),
      leads: field('leads'),
      mqls: field('mqls'),
      appointments: field('appointments'),
      conversions: field('conversions'),
      revenue: field('revenue')
    };
  }

  /**
   * Calcula o período anterior equivalente para comparação
   */
  public static calculatePreviousPeriod(startDate: string, endDate: string): { start: string; end: string } {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);

    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (diffDays - 1));

    return {
      start: prevStart.toISOString().split('T')[0],
      end: prevEnd.toISOString().split('T')[0]
    };
  }

  public static async getOverview(
    clientId: string,
    accountId: string = 'all',
    period: PeriodSelection
  ): Promise<DashboardOverviewResponse> {
    const cacheKey = `overview_${clientId}_${accountId}_${period.startDate}_${period.endDate}_${period.compare}_${period.includeMetaTax}`;
    const cached = db.getCache<DashboardOverviewResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const client = db.getClientById(clientId);
    if (!client) {
      throw new Error(`Cliente ${clientId} não encontrado.`);
    }

    const accounts = db.getAccountsByClient(clientId);
    const targetAccounts = accountId === 'all' ? accounts : accounts.filter(a => a.id === accountId);

    if (targetAccounts.length === 0) {
      throw new Error(`Nenhuma conta de anúncio encontrada para o cliente ${client.name}.`);
    }

    // 1. Coleta dados do período atual
    const dataSourceByAccount: Record<string, DataSource> = {};
    const contributionsByDate: Record<string, DailyMetricItem[]> = {};

    for (const acc of targetAccounts) {
      const { provider, source } = resolveProvider(acc);
      dataSourceByAccount[acc.id] = source;
      const days = await provider.getDailyInsights('', acc.externalAccountId, period);
      for (const d of days) {
        (contributionsByDate[d.date] ||= []).push(d);
      }
    }

    const dataSource = combineDataSources(Object.values(dataSourceByAccount));

    const dailyTrends: DailyMetricItem[] = Object.keys(contributionsByDate)
      .sort()
      .map(date => {
        const rows = contributionsByDate[date];
        const norm = NormalizerService.calculateMetrics(this.sumContributions(rows), false);
        return {
          date,
          spend: norm.spend,
          impressions: norm.impressions,
          reach: norm.reach,
          clicks: norm.clicks,
          leads: norm.leads,
          mqls: norm.mqls,
          appointments: norm.appointments,
          conversions: norm.conversions,
          revenue: norm.revenue,
          cpl: norm.cpl,
          cpmql: norm.cpmql,
          cpagd: norm.cpagd,
          cpa: norm.cpa,
          roas: norm.roas,
          unavailable: norm.unavailable
        };
      });

    const currentMetrics = NormalizerService.calculateMetrics(this.sumContributions(dailyTrends), false);

    // 2. Coleta dados do período anterior (se comparação ativa)
    let previousMetrics: NormalizedMetrics | null = null;
    const deltas: { [K in keyof NormalizedMetrics]?: number | null } = {};

    if (period.compare) {
      const prevRange = this.calculatePreviousPeriod(period.startDate, period.endDate);
      const prevPeriod: PeriodSelection = {
        preset: 'custom',
        startDate: prevRange.start,
        endDate: prevRange.end,
        compare: false,
        includeMetaTax: period.includeMetaTax
      };

      const prevRows: DailyMetricItem[] = [];
      for (const acc of targetAccounts) {
        const { provider } = resolveProvider(acc);
        prevRows.push(...(await provider.getDailyInsights('', acc.externalAccountId, prevPeriod)));
      }

      previousMetrics = NormalizerService.calculateMetrics(this.sumContributions(prevRows), false);

      // Delta só existe quando a métrica é real nos dois períodos.
      for (const key of Object.keys(currentMetrics) as Array<keyof NormalizedMetrics>) {
        if (key === 'unavailable') continue;
        const metric = key as MetricName;
        if (currentMetrics.unavailable.includes(metric) || previousMetrics.unavailable.includes(metric)) {
          deltas[metric] = null;
          continue;
        }
        deltas[metric] = NormalizerService.calculateDeltaPercentage(
          currentMetrics[metric],
          previousMetrics[metric]
        );
      }
    }

    // 3. Funil de Conversão
    const funnel = {
      spend: currentMetrics.spend,
      leads: currentMetrics.leads,
      mqls: currentMetrics.mqls,
      appointments: currentMetrics.appointments,
      sales: currentMetrics.conversions,
      revenue: currentMetrics.revenue,
      rates: {
        leadToMql: currentMetrics.leads > 0 ? Number(((currentMetrics.mqls / currentMetrics.leads) * 100).toFixed(1)) : 0,
        mqlToAgd: currentMetrics.mqls > 0 ? Number(((currentMetrics.appointments / currentMetrics.mqls) * 100).toFixed(1)) : 0,
        agdToSale: currentMetrics.appointments > 0 ? Number(((currentMetrics.conversions / currentMetrics.appointments) * 100).toFixed(1)) : 0,
        overallConv: currentMetrics.leads > 0 ? Number(((currentMetrics.conversions / currentMetrics.leads) * 100).toFixed(1)) : 0
      }
    };

    // Demografia, segmentos e leads nominais não têm origem real nesta integração.
    // Com dados reais eles ficam vazios (a interface mostra N/D) em vez de fabricados.
    const isMock = dataSource === 'mock';
    const emptyRanked = { countries: [], states: [], moments: [], experiences: [], results: [], invest: [], returns: [] };
    const demographics = isMock ? mockProvider.getDemographics() : emptyRanked;
    const funnelSegments = isMock ? mockProvider.getFunnelSegments(currentMetrics) : [];
    const qualifiedLeads = isMock ? mockProvider.getQualifiedLeads() : [];

    const response: DashboardOverviewResponse = {
      client,
      accounts,
      selectedAccountId: accountId,
      period: {
        startDate: period.startDate,
        endDate: period.endDate,
        label: `${period.startDate.split('-').reverse().join('/')} a ${period.endDate.split('-').reverse().join('/')}`,
        includeMetaTax: period.includeMetaTax ?? true
      },
      currentMetrics,
      previousMetrics,
      deltas,
      funnel,
      dailyTrends,
      demographics,
      funnelSegments,
      qualifiedLeads,
      lastSyncAt: targetAccounts[0]?.lastSyncAt || new Date().toISOString(),
      dataSource,
      dataSourceByAccount,
      snapshotFreshness: this.snapshotFreshness(targetAccounts, period)
    };

    // Cache por 15 minutos (900s)
    db.setCache(cacheKey, response, 900);

    return response;
  }

  public static async getCampaigns(
    clientId: string,
    accountId: string = 'all',
    period: PeriodSelection
  ): Promise<CampaignData[]> {
    const client = db.getClientById(clientId);
    if (!client) throw new Error(`Cliente ${clientId} não encontrado.`);

    const accounts = db.getAccountsByClient(clientId);
    const targetAccounts = accountId === 'all' ? accounts : accounts.filter(a => a.id === accountId);
    const campaigns: CampaignData[] = [];

    for (const acc of targetAccounts) {
      const { provider } = resolveProvider(acc);
      const list = await provider.getCampaigns('', acc.externalAccountId, period);
      campaigns.push(...list);
    }

    return campaigns;
  }

  public static async getAdSets(
    clientId: string,
    accountId: string = 'all',
    period: PeriodSelection,
    campaignId?: string
  ): Promise<AdSetData[]> {
    const accounts = db.getAccountsByClient(clientId);
    const targetAccounts = accountId === 'all' ? accounts : accounts.filter(a => a.id === accountId);
    const adSets: AdSetData[] = [];

    for (const acc of targetAccounts) {
      const { provider } = resolveProvider(acc);
      const list = await provider.getAdSets('', acc.externalAccountId, period, campaignId);
      adSets.push(...list);
    }

    return adSets;
  }

  public static async getAds(
    clientId: string,
    accountId: string = 'all',
    period: PeriodSelection,
    adSetId?: string
  ): Promise<AdData[]> {
    const accounts = db.getAccountsByClient(clientId);
    const targetAccounts = accountId === 'all' ? accounts : accounts.filter(a => a.id === accountId);
    const ads: AdData[] = [];

    for (const acc of targetAccounts) {
      const { provider } = resolveProvider(acc);
      const list = await provider.getAds('', acc.externalAccountId, period, adSetId);
      ads.push(...list);
    }

    return ads;
  }

  public static async syncAccount(accountId: string): Promise<{ success: boolean; lastSyncAt: string }> {
    const acc = db.getAccountById(accountId);
    if (!acc) throw new Error('Conta não encontrada.');

    // Limpa cache
    db.clearCache();

    const now = new Date().toISOString();
    db.updateAccount(accountId, { lastSyncAt: now });
    db.addLog({
      clientId: acc.clientId,
      adAccountId: acc.id,
      status: 'SUCCESS',
      message: `Sincronização manual da conta ${acc.name} executada com sucesso.`
    });

    return { success: true, lastSyncAt: now };
  }
}
