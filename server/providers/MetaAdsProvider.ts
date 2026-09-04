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
import { NormalizerService, RawMetricInput } from '../services/NormalizerService.js';
import { graphGet, graphGetAll, toActId, MetaApiError } from '../integrations/meta/graphClient.js';
import { parseMetaActions } from '../integrations/meta/actions.js';
import { INSIGHT_FIELDS, PRIMARY_CONVERSION } from '../integrations/meta/config.js';

/**
 * Provider da Meta Marketing API oficial.
 *
 * Três coisas que a versão anterior não fazia e mudavam os números:
 *
 * 1. Paginação. A Meta devolve 25 itens por página; sem seguir `paging.next`
 *    uma conta com muitas campanhas mostrava só as primeiras, e o total do
 *    painel ficava abaixo do Ads Manager sem sinal de erro.
 * 2. Interpretação única de `actions`. Cada método tinha a própria regra, então
 *    o total da conta e a soma das campanhas divergiam.
 * 3. Ausência vira `null`, não zero. `Number(x) || 0` transformava métrica não
 *    reportada em zero — o painel exibia "R$ 0,00" onde a verdade era N/D.
 */

type InsightRow = Record<string, unknown>;

/** Converte campo numérico da Meta preservando a diferença entre ausente e zero. */
function num(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export class MetaAdsProvider implements AdvertisingProvider {
  public platformId = 'meta_ads';

  /** Janela no formato que a Meta espera. */
  private timeRange(period: PeriodSelection): string {
    return JSON.stringify({ since: period.startDate, until: period.endDate });
  }

  /**
   * Insights viram o formato interno do projeto.
   *
   * Métrica que a Meta não devolveu fica `null`, e o NormalizerService a marca
   * como indisponível — é o que faz o painel mostrar N/D em vez de zero.
   */
  private toMetrics(row: InsightRow, period: PeriodSelection): NormalizedMetrics {
    const parsed = parseMetaActions(row.actions, row.action_values, PRIMARY_CONVERSION);

    const input: RawMetricInput = {
      spend: num(row.spend),
      impressions: num(row.impressions),
      reach: num(row.reach),
      frequency: num(row.frequency),
      clicks: num(row.clicks),
      leads: parsed.leads,
      // MQL e agendamento não existem na Meta Ads API. Ficam null de propósito:
      // derivá-los de leads seria inventar métrica.
      mqls: null,
      appointments: null,
      conversions: parsed.conversions,
      revenue: parsed.conversionValue
    };

    return NormalizerService.calculateMetrics(input, period.includeMetaTax ?? true);
  }

  private toDailyItem(row: InsightRow, period: PeriodSelection): DailyMetricItem {
    const m = this.toMetrics(row, period);
    return {
      date: str(row.date_start),
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
  }

  public async testConnection(accessToken: string, accountId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await graphGet<{ id: string; name: string }>(toActId(accountId), accessToken, {
        fields: 'id,name,account_status,currency,timezone_name'
      });
      return { success: true, message: `Conta ${res.name} (${res.id}) conectada com sucesso.` };
    } catch (err) {
      return {
        success: false,
        message: err instanceof MetaApiError ? err.message : 'Falha ao conectar com a Meta Ads.'
      };
    }
  }

  public async getAccountDetails(accessToken: string, externalAccountId: string): Promise<Partial<AdAccount>> {
    const res = await graphGet<{
      name: string;
      currency: string;
      timezone_name: string;
      account_status: number;
    }>(toActId(externalAccountId), accessToken, {
      fields: 'id,name,account_status,currency,timezone_name'
    });

    return {
      name: res.name,
      currency: res.currency,
      // O timezone da conta é o que define o corte do dia. Guardá-lo evita que
      // o painel e o Ads Manager discordem na virada.
      timezone: res.timezone_name,
      status: res.account_status === 1 ? 'active' : 'paused'
    };
  }

  public async getDailyInsights(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<DailyMetricItem[]> {
    const { rows } = await graphGetAll<InsightRow>(`${toActId(externalAccountId)}/insights`, accessToken, {
      time_range: this.timeRange(period),
      time_increment: '1',
      fields: INSIGHT_FIELDS
    });

    return rows.map(row => this.toDailyItem(row, period)).sort((a, b) => a.date.localeCompare(b.date));
  }

  public async getAggregatedMetrics(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<NormalizedMetrics> {
    // Pede o consolidado à própria Meta em vez de somar os dias: alcance é
    // deduplicado no período e não é a soma dos alcances diários.
    const { rows } = await graphGetAll<InsightRow>(`${toActId(externalAccountId)}/insights`, accessToken, {
      time_range: this.timeRange(period),
      fields: INSIGHT_FIELDS
    });

    if (rows.length === 0) {
      return NormalizerService.calculateMetrics(
        {
          spend: null,
          impressions: null,
          reach: null,
          frequency: null,
          clicks: null,
          leads: null,
          mqls: null,
          appointments: null,
          conversions: null,
          revenue: null
        },
        period.includeMetaTax ?? true
      );
    }

    return this.toMetrics(rows[0], period);
  }

  public async getCampaigns(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<CampaignData[]> {
    const { rows } = await graphGetAll<{
      id: string;
      name: string;
      status: string;
      objective?: string;
      insights?: { data?: InsightRow[] };
    }>(`${toActId(externalAccountId)}/campaigns`, accessToken, {
      fields: `id,name,status,objective,insights.time_range(${this.timeRange(period)}){${INSIGHT_FIELDS}}`
    });

    return rows.map(campaign => ({
      id: campaign.id,
      adAccountId: externalAccountId,
      externalCampaignId: campaign.id,
      name: campaign.name,
      status: campaign.status as CampaignData['status'],
      objective: campaign.objective,
      metrics: this.toMetrics(campaign.insights?.data?.[0] ?? {}, period)
    }));
  }

  public async getAdSets(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection,
    campaignId?: string
  ): Promise<AdSetData[]> {
    const parent = campaignId || toActId(externalAccountId);

    const { rows } = await graphGetAll<{
      id: string;
      name: string;
      status: string;
      campaign_id?: string;
      campaign?: { name?: string };
      insights?: { data?: InsightRow[] };
    }>(`${parent}/adsets`, accessToken, {
      // `campaign{name}` traz o nome real — antes a interface exibia
      // "Campanha <id>", que não ajuda ninguém.
      fields: `id,name,status,campaign_id,campaign{name},insights.time_range(${this.timeRange(period)}){${INSIGHT_FIELDS}}`
    });

    return rows.map(adset => ({
      id: adset.id,
      adAccountId: externalAccountId,
      campaignId: adset.campaign_id || '',
      campaignName: adset.campaign?.name || 'N/D',
      externalAdSetId: adset.id,
      name: adset.name,
      status: adset.status as AdSetData['status'],
      metrics: this.toMetrics(adset.insights?.data?.[0] ?? {}, period)
    }));
  }

  public async getAds(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection,
    adSetId?: string
  ): Promise<AdData[]> {
    const parent = adSetId || toActId(externalAccountId);

    const { rows } = await graphGetAll<{
      id: string;
      name: string;
      status: string;
      adset_id?: string;
      campaign_id?: string;
      adset?: { name?: string };
      campaign?: { name?: string };
      creative?: { image_url?: string; thumbnail_url?: string; instagram_permalink_url?: string; video_id?: string };
      insights?: { data?: InsightRow[] };
    }>(`${parent}/ads`, accessToken, {
      fields:
        `id,name,status,adset_id,campaign_id,adset{name},campaign{name},` +
        `creative{image_url,thumbnail_url,instagram_permalink_url,video_id},` +
        `insights.time_range(${this.timeRange(period)}){${INSIGHT_FIELDS}}`
    });

    return rows.map(ad => ({
      id: ad.id,
      adAccountId: externalAccountId,
      campaignId: ad.campaign_id || '',
      campaignName: ad.campaign?.name || 'N/D',
      adSetId: ad.adset_id || '',
      adSetName: ad.adset?.name || 'N/D',
      externalAdId: ad.id,
      name: ad.name,
      status: ad.status as AdData['status'],
      previewUrl: ad.creative?.thumbnail_url || ad.creative?.image_url,
      permalinkUrl: ad.creative?.instagram_permalink_url,
      format: ad.creative?.video_id ? 'video' : 'image',
      metrics: this.toMetrics(ad.insights?.data?.[0] ?? {}, period)
    }));
  }
}
