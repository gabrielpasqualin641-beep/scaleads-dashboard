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

export class MetaAdsProvider implements AdvertisingProvider {
  public platformId = 'meta_ads';
  private apiVersion = 'v21.0';
  private baseUrl = 'https://graph.facebook.com';

  private async fetchGraph(endpoint: string, accessToken: string, params: Record<string, string> = {}) {
    const url = new URL(`${this.baseUrl}/${this.apiVersion}/${endpoint}`);
    url.searchParams.append('access_token', accessToken);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.append(k, v);
    }

    const res = await fetch(url.toString());
    const json = await res.json();
    if (!res.ok || json.error) {
      const errMsg = json?.error?.message || `Erro Meta Graph API: status ${res.status}`;
      throw new Error(errMsg);
    }
    return json;
  }

  public async testConnection(accessToken: string, accountId: string): Promise<{ success: boolean; message: string }> {
    try {
      const cleanId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
      const res = await this.fetchGraph(cleanId, accessToken, { fields: 'id,name,account_status,currency,timezone_name' });
      return {
        success: true,
        message: `Conta ${res.name} (${res.id}) conectada com sucesso.`
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Falha ao conectar com Meta Ads'
      };
    }
  }

  public async getAccountDetails(accessToken: string, externalAccountId: string): Promise<Partial<AdAccount>> {
    const cleanId = externalAccountId.startsWith('act_') ? externalAccountId : `act_${externalAccountId}`;
    const res = await this.fetchGraph(cleanId, accessToken, { fields: 'id,name,account_status,currency,timezone_name' });
    return {
      name: res.name,
      currency: res.currency,
      timezone: res.timezone_name,
      status: res.account_status === 1 ? 'active' : 'paused'
    };
  }

  public async getDailyInsights(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<DailyMetricItem[]> {
    const cleanId = externalAccountId.startsWith('act_') ? externalAccountId : `act_${externalAccountId}`;
    const timeRange = JSON.stringify({
      since: period.startDate,
      until: period.endDate
    });

    const params: Record<string, string> = {
      time_range: timeRange,
      time_increment: '1',
      fields: 'date_start,spend,impressions,reach,clicks,actions,action_values'
    };

    const res = await this.fetchGraph(`${cleanId}/insights`, accessToken, params);
    const data = res.data || [];

    return data.map((item: any) => {
      let leads = 0;
      let conversions = 0;
      let revenue = 0;

      if (Array.isArray(item.actions)) {
        for (const act of item.actions) {
          if (act.action_type === 'lead' || act.action_type === 'contact' || act.action_type === 'submit_application') {
            leads += Number(act.value) || 0;
          }
          if (act.action_type === 'purchase' || act.action_type === 'omni_purchase') {
            conversions += Number(act.value) || 0;
          }
        }
      }

      if (Array.isArray(item.action_values)) {
        for (const val of item.action_values) {
          if (val.action_type === 'purchase' || val.action_type === 'omni_purchase') {
            revenue += Number(val.value) || 0;
          }
        }
      }


      const norm = NormalizerService.calculateMetrics({
        spend: Number(item.spend) || 0,
        impressions: Number(item.impressions) || 0,
        reach: Number(item.reach) || 0,
        clicks: Number(item.clicks) || 0,
        leads,
        mqls: null,
        appointments: null,
        conversions,
        revenue
      }, period.includeMetaTax ?? true);

      return {
        date: item.date_start,
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
  }

  public async getAggregatedMetrics(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<NormalizedMetrics> {
    const daily = await this.getDailyInsights(accessToken, externalAccountId, period);
    const sum = (key: 'spend' | 'impressions' | 'reach' | 'clicks' | 'leads' | 'conversions' | 'revenue') => {
      const available = daily.filter(d => !d.unavailable.includes(key));
      return available.length > 0 ? available.reduce((total, d) => total + d[key], 0) : null;
    };

    return NormalizerService.calculateMetrics({
      spend: sum('spend'),
      impressions: sum('impressions'),
      reach: sum('reach'),
      clicks: sum('clicks'),
      leads: sum('leads'),
      mqls: null,
      appointments: null,
      conversions: sum('conversions'),
      revenue: sum('revenue')
    }, false);
  }

  public async getCampaigns(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<CampaignData[]> {
    const cleanId = externalAccountId.startsWith('act_') ? externalAccountId : `act_${externalAccountId}`;
    const timeRange = JSON.stringify({ since: period.startDate, until: period.endDate });

    const res = await this.fetchGraph(`${cleanId}/campaigns`, accessToken, {
      fields: 'id,name,status,objective,insights.time_range(' + timeRange + '){spend,impressions,reach,clicks,actions,action_values}'
    });

    return (res.data || []).map((cmp: any) => {
      const ins = cmp.insights?.data?.[0] || {};
      let leads = 0;
      let conversions = 0;
      let revenue = 0;

      if (Array.isArray(ins.actions)) {
        for (const act of ins.actions) {
          if (act.action_type === 'lead' || act.action_type === 'contact') leads += Number(act.value) || 0;
          if (act.action_type === 'purchase' || act.action_type === 'omni_purchase') conversions += Number(act.value) || 0;
        }
      }
      if (Array.isArray(ins.action_values)) {
        for (const val of ins.action_values) {
          if (val.action_type === 'purchase') revenue += Number(val.value) || 0;
        }
      }


      const metrics = NormalizerService.calculateMetrics({
        spend: Number(ins.spend) || 0,
        impressions: Number(ins.impressions) || 0,
        reach: Number(ins.reach) || 0,
        clicks: Number(ins.clicks) || 0,
        leads,
        mqls: null,
        appointments: null,
        conversions,
        revenue
      }, period.includeMetaTax ?? true);

      return {
        id: cmp.id,
        adAccountId: externalAccountId,
        externalCampaignId: cmp.id,
        name: cmp.name,
        status: cmp.status,
        objective: cmp.objective,
        metrics
      };
    });
  }

  public async getAdSets(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection,
    campaignId?: string
  ): Promise<AdSetData[]> {
    const parentId = campaignId || (externalAccountId.startsWith('act_') ? externalAccountId : `act_${externalAccountId}`);
    const timeRange = JSON.stringify({ since: period.startDate, until: period.endDate });

    const res = await this.fetchGraph(`${parentId}/adsets`, accessToken, {
      fields: 'id,name,status,campaign_id,insights.time_range(' + timeRange + '){spend,impressions,reach,clicks,actions,action_values}'
    });

    return (res.data || []).map((as: any) => {
      const ins = as.insights?.data?.[0] || {};
      let leads = 0;
      let conversions = 0;
      let revenue = 0;

      if (Array.isArray(ins.actions)) {
        for (const act of ins.actions) {
          if (act.action_type === 'lead') leads += Number(act.value) || 0;
          if (act.action_type === 'purchase') conversions += Number(act.value) || 0;
        }
      }
      if (Array.isArray(ins.action_values)) {
        for (const val of ins.action_values) {
          if (val.action_type === 'purchase') revenue += Number(val.value) || 0;
        }
      }


      const metrics = NormalizerService.calculateMetrics({
        spend: Number(ins.spend) || 0,
        impressions: Number(ins.impressions) || 0,
        reach: Number(ins.reach) || 0,
        clicks: Number(ins.clicks) || 0,
        leads,
        mqls: null,
        appointments: null,
        conversions,
        revenue
      }, period.includeMetaTax ?? true);

      return {
        id: as.id,
        adAccountId: externalAccountId,
        campaignId: as.campaign_id,
        campaignName: 'Campanha ' + as.campaign_id,
        externalAdSetId: as.id,
        name: as.name,
        status: as.status,
        metrics
      };
    });
  }

  public async getAds(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection,
    adSetId?: string
  ): Promise<AdData[]> {
    const parentId = adSetId || (externalAccountId.startsWith('act_') ? externalAccountId : `act_${externalAccountId}`);
    const timeRange = JSON.stringify({ since: period.startDate, until: period.endDate });

    const res = await this.fetchGraph(`${parentId}/ads`, accessToken, {
      fields: 'id,name,status,adset_id,campaign_id,creative{image_url,thumbnail_url,instagram_permalink_url},insights.time_range(' + timeRange + '){spend,impressions,reach,clicks,actions,action_values}'
    });

    return (res.data || []).map((ad: any) => {
      const ins = ad.insights?.data?.[0] || {};
      let leads = 0;
      let conversions = 0;
      let revenue = 0;

      if (Array.isArray(ins.actions)) {
        for (const act of ins.actions) {
          if (act.action_type === 'lead') leads += Number(act.value) || 0;
          if (act.action_type === 'purchase') conversions += Number(act.value) || 0;
        }
      }
      if (Array.isArray(ins.action_values)) {
        for (const val of ins.action_values) {
          if (val.action_type === 'purchase') revenue += Number(val.value) || 0;
        }
      }


      const metrics = NormalizerService.calculateMetrics({
        spend: Number(ins.spend) || 0,
        impressions: Number(ins.impressions) || 0,
        reach: Number(ins.reach) || 0,
        clicks: Number(ins.clicks) || 0,
        leads,
        mqls: null,
        appointments: null,
        conversions,
        revenue
      }, period.includeMetaTax ?? true);

      return {
        id: ad.id,
        adAccountId: externalAccountId,
        campaignId: ad.campaign_id,
        campaignName: 'Campanha ' + ad.campaign_id,
        adSetId: ad.adset_id,
        adSetName: 'Conjunto ' + ad.adset_id,
        externalAdId: ad.id,
        name: ad.name,
        status: ad.status,
        previewUrl: ad.creative?.thumbnail_url || ad.creative?.image_url,
        permalinkUrl: ad.creative?.instagram_permalink_url,
        metrics
      };
    });
  }
}
