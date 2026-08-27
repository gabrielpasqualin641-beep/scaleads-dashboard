import {
  AdAccount,
  CampaignData,
  AdSetData,
  AdData,
  DailyMetricItem,
  PeriodSelection,
  NormalizedMetrics
} from '../models/types.js';

export interface AdvertisingProvider {
  platformId: string;
  testConnection(accessToken: string, accountId: string): Promise<{ success: boolean; message: string }>;
  getAccountDetails(accessToken: string, externalAccountId: string): Promise<Partial<AdAccount>>;
  getCampaigns(accessToken: string, externalAccountId: string, period: PeriodSelection): Promise<CampaignData[]>;
  getAdSets(accessToken: string, externalAccountId: string, period: PeriodSelection, campaignId?: string): Promise<AdSetData[]>;
  getAds(accessToken: string, externalAccountId: string, period: PeriodSelection, adSetId?: string): Promise<AdData[]>;
  getDailyInsights(accessToken: string, externalAccountId: string, period: PeriodSelection): Promise<DailyMetricItem[]>;
  getAggregatedMetrics(accessToken: string, externalAccountId: string, period: PeriodSelection): Promise<NormalizedMetrics>;
}
