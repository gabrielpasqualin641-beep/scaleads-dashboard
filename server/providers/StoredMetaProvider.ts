import {
  AdAccount,
  CampaignData,
  AdSetData,
  AdData,
  DailyMetricItem,
  PeriodSelection,
  NormalizedMetrics
} from '../models/types.js';
import { AdvertisingProvider } from './AdvertisingProvider.js';
import { NormalizerService } from '../services/NormalizerService.js';
import { metaMetricsStore } from '../integrations/meta/metricsStore.js';
import { normalizeAccountId } from '../integrations/metaMcp/MetaMcpSnapshotStore.js';

/**
 * Lê as métricas já sincronizadas da Meta.
 *
 * É este provider que atende o painel. O `MetaAdsProvider` fala com a Graph API
 * e é usado só pelo job de sincronização — assim nenhuma requisição de tela
 * espera a Meta responder.
 */
export class StoredMetaProvider implements AdvertisingProvider {
  public platformId = 'meta_stored';

  public async testConnection(_token: string, accountId: string): Promise<{ success: boolean; message: string }> {
    const stored = metaMetricsStore.get(normalizeAccountId(accountId));
    if (!stored) {
      return { success: false, message: `Nenhuma sincronização registrada para a conta ${accountId}.` };
    }
    return {
      success: true,
      message: `Última sincronização em ${stored.lastSyncAt} · ${Object.keys(stored.daily).length} dias armazenados.`
    };
  }

  public async getAccountDetails(_token: string, _externalAccountId: string): Promise<Partial<AdAccount>> {
    // Cadastro da conta vem do banco do projeto; aqui só há métrica.
    return {};
  }

  public async getDailyInsights(
    _token: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<DailyMetricItem[]> {
    return metaMetricsStore.getDailyRange(normalizeAccountId(externalAccountId), period.startDate, period.endDate);
  }

  public async getAggregatedMetrics(
    _token: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<NormalizedMetrics> {
    const rows = metaMetricsStore.getDailyRange(
      normalizeAccountId(externalAccountId),
      period.startDate,
      period.endDate
    );

    // Soma só o que existe: métrica ausente em todos os dias permanece ausente,
    // em vez de virar zero.
    const sum = (key: 'spend' | 'impressions' | 'reach' | 'clicks' | 'leads' | 'conversions' | 'revenue') => {
      const available = rows.filter(r => !r.unavailable.includes(key));
      return available.length > 0 ? available.reduce((total, r) => total + r[key], 0) : null;
    };

    return NormalizerService.calculateMetrics(
      {
        spend: sum('spend'),
        impressions: sum('impressions'),
        reach: sum('reach'),
        clicks: sum('clicks'),
        leads: sum('leads'),
        mqls: null,
        appointments: null,
        conversions: sum('conversions'),
        revenue: sum('revenue')
      },
      false
    );
  }

  public async getCampaigns(
    _token: string,
    externalAccountId: string,
    _period: PeriodSelection
  ): Promise<CampaignData[]> {
    return metaMetricsStore.get(normalizeAccountId(externalAccountId))?.campaigns ?? [];
  }

  public async getAdSets(
    _token: string,
    externalAccountId: string,
    _period: PeriodSelection,
    campaignId?: string
  ): Promise<AdSetData[]> {
    const all = metaMetricsStore.get(normalizeAccountId(externalAccountId))?.adSets ?? [];
    return campaignId ? all.filter(a => a.campaignId === campaignId) : all;
  }

  public async getAds(
    _token: string,
    externalAccountId: string,
    _period: PeriodSelection,
    adSetId?: string
  ): Promise<AdData[]> {
    const all = metaMetricsStore.get(normalizeAccountId(externalAccountId))?.ads ?? [];
    return adSetId ? all.filter(a => a.adSetId === adSetId) : all;
  }
}
