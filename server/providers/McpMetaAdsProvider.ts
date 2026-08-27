import {
  AdAccount,
  CampaignData,
  AdSetData,
  AdData,
  DailyMetricItem,
  PeriodSelection,
  NormalizedMetrics,
  EntityStatus
} from '../models/types.js';
import { AdvertisingProvider } from './AdvertisingProvider.js';
import { NormalizerService, RawMetricInput } from '../services/NormalizerService.js';
import { metaMcpSnapshotStore } from '../integrations/metaMcp/MetaMcpSnapshotStore.js';
import { McpEntityRow, McpDailyRow } from '../integrations/metaMcp/types.js';

const ENTITY_STATUSES: EntityStatus[] = ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES'];

function toEntityStatus(status: string | undefined): EntityStatus {
  const upper = (status || '').toUpperCase() as EntityStatus;
  return ENTITY_STATUSES.includes(upper) ? upper : 'UNKNOWN';
}

/**
 * Provider alimentado pelos dados reais do MCP Meta Ads.
 *
 * MQLs e agendamentos não existem na Meta Ads API — não há campo equivalente em
 * nenhum nível. Ficam sempre `null` e são renderizados como N/D, em vez de
 * derivados de leads por um fator arbitrário.
 */
export class McpMetaAdsProvider implements AdvertisingProvider {
  public platformId = 'meta_ads_mcp';

  private toRaw(row: {
    spend: number | null;
    impressions: number | null;
    reach: number | null;
    frequency: number | null;
    clicks: number | null;
    leads: number | null;
    conversions: number | null;
    revenue: number | null;
  }): RawMetricInput {
    return {
      spend: row.spend,
      impressions: row.impressions,
      reach: row.reach,
      frequency: row.frequency,
      clicks: row.clicks,
      leads: row.leads,
      mqls: null,
      appointments: null,
      conversions: row.conversions,
      revenue: row.revenue
    };
  }

  private entityMetrics(row: McpEntityRow, period: PeriodSelection): NormalizedMetrics {
    return NormalizerService.calculateMetrics(this.toRaw(row), period.includeMetaTax ?? true);
  }

  /**
   * Série diária real da entidade, recortada pelo período. Retorna `undefined`
   * quando o snapshot não tem a série — a interface então não desenha o gráfico,
   * em vez de inventar uma curva.
   */
  private entityDaily(
    series: McpDailyRow[] | undefined,
    period: PeriodSelection
  ): DailyMetricItem[] | undefined {
    if (!series || series.length === 0) return undefined;

    const rows = series.filter(d => d.date >= period.startDate && d.date <= period.endDate);
    if (rows.length === 0) return undefined;

    return rows.map(row => {
      const m = NormalizerService.calculateMetrics(this.toRaw(row), period.includeMetaTax ?? true);
      return {
        date: row.date,
        spend: m.spend,
        impressions: m.impressions,
        reach: m.reach,
        clicks: m.clicks,
        leads: m.leads,
        mqls: m.mqls,
        appointments: m.appointments,
        conversions: m.conversions,
        revenue: m.revenue,
        cpl: m.cpl,
        cpmql: m.cpmql,
        cpagd: m.cpagd,
        cpa: m.cpa,
        roas: m.roas,
        unavailable: m.unavailable
      };
    });
  }

  public async testConnection(_accessToken: string, accountId: string): Promise<{ success: boolean; message: string }> {
    const acc = metaMcpSnapshotStore.getAccount(accountId);
    if (!acc) {
      return {
        success: false,
        message: `Nenhum dado do MCP Meta Ads para a conta ${accountId}. Rode a coleta via MCP e envie para POST /api/meta-mcp/snapshot.`
      };
    }
    return {
      success: true,
      message: `Conta ${acc.name} (${acc.accountId}) com dados reais do MCP Meta Ads: ${acc.daily.length} dias, ${acc.campaigns.length} campanhas, coletados em ${acc.fetchedAt}.`
    };
  }

  public async getAccountDetails(_accessToken: string, externalAccountId: string): Promise<Partial<AdAccount>> {
    const acc = metaMcpSnapshotStore.getAccount(externalAccountId);
    if (!acc) return {};
    return {
      name: acc.name,
      currency: acc.currency,
      status: acc.accountStatus === 'ACTIVE' ? 'active' : 'paused',
      businessId: acc.businessId,
      businessName: acc.businessName
    };
  }

  public async getDailyInsights(
    _accessToken: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<DailyMetricItem[]> {
    const rows = metaMcpSnapshotStore.getDailyRange(externalAccountId, period.startDate, period.endDate);

    return rows.map(row => {
      const m = NormalizerService.calculateMetrics(this.toRaw(row), period.includeMetaTax ?? true);
      return {
        date: row.date,
        spend: m.spend,
        impressions: m.impressions,
        reach: m.reach,
        clicks: m.clicks,
        leads: m.leads,
        mqls: m.mqls,
        appointments: m.appointments,
        conversions: m.conversions,
        revenue: m.revenue,
        cpl: m.cpl,
        cpmql: m.cpmql,
        cpagd: m.cpagd,
        cpa: m.cpa,
        roas: m.roas,
        unavailable: m.unavailable
      };
    });
  }

  public async getAggregatedMetrics(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<NormalizedMetrics> {
    const rows = metaMcpSnapshotStore.getDailyRange(externalAccountId, period.startDate, period.endDate);
    const sum = (pick: (r: typeof rows[number]) => number | null): number | null => {
      const values = rows.map(pick).filter((v): v is number => v !== null);
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
    };

    return NormalizerService.calculateMetrics({
      spend: sum(r => r.spend),
      impressions: sum(r => r.impressions),
      reach: sum(r => r.reach),
      clicks: sum(r => r.clicks),
      leads: sum(r => r.leads),
      mqls: null,
      appointments: null,
      conversions: sum(r => r.conversions),
      revenue: sum(r => r.revenue)
    }, period.includeMetaTax ?? true);
  }

  public async getCampaigns(
    _accessToken: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<CampaignData[]> {
    const acc = metaMcpSnapshotStore.getAccount(externalAccountId);
    if (!acc) return [];

    return acc.campaigns.map(row => ({
      id: row.id,
      adAccountId: externalAccountId,
      externalCampaignId: row.id,
      name: row.name,
      status: toEntityStatus(row.status),
      objective: row.objective,
      metrics: this.entityMetrics(row, period),
      dailyMetrics: this.entityDaily(acc.dailyByEntity?.campaigns?.[row.id], period)
    }));
  }

  public async getAdSets(
    _accessToken: string,
    externalAccountId: string,
    period: PeriodSelection,
    campaignId?: string
  ): Promise<AdSetData[]> {
    const acc = metaMcpSnapshotStore.getAccount(externalAccountId);
    if (!acc) return [];

    const campaignNames = new Map(acc.campaigns.map(c => [c.id, c.name]));
    const rows = campaignId ? acc.adSets.filter(a => a.campaignId === campaignId) : acc.adSets;

    return rows.map(row => ({
      id: row.id,
      adAccountId: externalAccountId,
      campaignId: row.campaignId || '',
      campaignName: campaignNames.get(row.campaignId || '') || 'N/D',
      externalAdSetId: row.id,
      name: row.name,
      status: toEntityStatus(row.status),
      metrics: this.entityMetrics(row, period),
      dailyMetrics: this.entityDaily(acc.dailyByEntity?.adSets?.[row.id], period)
    }));
  }

  public async getAds(
    _accessToken: string,
    externalAccountId: string,
    period: PeriodSelection,
    adSetId?: string
  ): Promise<AdData[]> {
    const acc = metaMcpSnapshotStore.getAccount(externalAccountId);
    if (!acc) return [];

    const campaignNames = new Map(acc.campaigns.map(c => [c.id, c.name]));
    const adSetNames = new Map(acc.adSets.map(a => [a.id, a.name]));
    const rows = adSetId ? acc.ads.filter(a => a.adSetId === adSetId) : acc.ads;

    return rows.map(row => ({
      id: row.id,
      adAccountId: externalAccountId,
      campaignId: row.campaignId || '',
      campaignName: campaignNames.get(row.campaignId || '') || 'N/D',
      adSetId: row.adSetId || '',
      adSetName: adSetNames.get(row.adSetId || '') || 'N/D',
      externalAdId: row.id,
      name: row.name,
      status: toEntityStatus(row.status),
      // Miniatura real do criativo. Sem imagem disponível fica indefinido — a
      // interface mostra um marcador, nunca uma foto genérica no lugar.
      previewUrl: row.thumbnailUrl || undefined,
      format: row.creativeFormat || undefined,
      metrics: this.entityMetrics(row, period),
      dailyMetrics: this.entityDaily(acc.dailyByEntity?.ads?.[row.id], period)
    }));
  }
}
