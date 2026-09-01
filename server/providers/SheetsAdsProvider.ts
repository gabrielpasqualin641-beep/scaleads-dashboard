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
import { sheetsSnapshotStore } from '../integrations/sheets/SheetsSnapshotStore.js';
import { SheetsDailyRow, SheetsEntityRow } from '../integrations/sheets/types.js';
import { db } from '../db/database.js';
import { BriefService } from '../services/BriefService.js';

/**
 * Provider alimentado por uma planilha (Adveronix). A origem não reporta
 * reach, frequência, leads, MQLs nem agendamentos — ficam sempre N/D.
 *
 * Receita não existe na planilha. Quando o cliente tem ticket médio cadastrado
 * no briefing, a receita é estimada como `conversões × ticket médio` — uma
 * aproximação, não um valor real de venda — para permitir ROAS aproximado.
 * Sem ticket cadastrado, receita e ROAS ficam N/D.
 */
export class SheetsAdsProvider implements AdvertisingProvider {
  public platformId = 'sheets';

  private averageTicketFor(externalAccountId: string): number | null {
    const account = db.getAccountByExternalId(externalAccountId);
    if (!account) return null;
    const brief = BriefService.get(account.clientId);
    return brief?.averageTicket ?? null;
  }

  private toRaw(row: { spend: number; impressions: number; clicks: number; conversions: number }, ticket: number | null): RawMetricInput {
    return {
      spend: row.spend,
      impressions: row.impressions,
      reach: null,
      frequency: null,
      clicks: row.clicks,
      leads: null,
      mqls: null,
      appointments: null,
      conversions: row.conversions,
      revenue: ticket !== null ? row.conversions * ticket : null
    };
  }

  private entityMetrics(row: SheetsEntityRow, period: PeriodSelection, ticket: number | null): NormalizedMetrics {
    return NormalizerService.calculateMetrics(this.toRaw(row, ticket), period.includeMetaTax ?? true);
  }

  private entityDaily(series: SheetsDailyRow[] | undefined, period: PeriodSelection, ticket: number | null): DailyMetricItem[] | undefined {
    if (!series || series.length === 0) return undefined;
    const rows = series.filter(d => d.date >= period.startDate && d.date <= period.endDate);
    if (rows.length === 0) return undefined;

    return rows.map(row => {
      const m = NormalizerService.calculateMetrics(this.toRaw(row, ticket), period.includeMetaTax ?? true);
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
    const acc = sheetsSnapshotStore.getAccount(accountId);
    if (!acc) {
      return { success: false, message: `Nenhuma planilha sincronizada para a conta ${accountId} ainda.` };
    }
    return {
      success: true,
      message: `Planilha sincronizada: ${acc.daily.length} dias, ${acc.campaigns.length} campanhas, coletada em ${acc.fetchedAt}.`
    };
  }

  public async getAccountDetails(_accessToken: string, _externalAccountId: string): Promise<Partial<AdAccount>> {
    return {};
  }

  public async getDailyInsights(_accessToken: string, externalAccountId: string, period: PeriodSelection): Promise<DailyMetricItem[]> {
    const ticket = this.averageTicketFor(externalAccountId);
    const rows = sheetsSnapshotStore.getDailyRange(externalAccountId, period.startDate, period.endDate);

    return rows.map(row => {
      const m = NormalizerService.calculateMetrics(this.toRaw(row, ticket), period.includeMetaTax ?? true);
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

  public async getAggregatedMetrics(_accessToken: string, externalAccountId: string, period: PeriodSelection): Promise<NormalizedMetrics> {
    const ticket = this.averageTicketFor(externalAccountId);
    const rows = sheetsSnapshotStore.getDailyRange(externalAccountId, period.startDate, period.endDate);
    const sum = (pick: (r: SheetsDailyRow) => number) => rows.reduce((total, r) => total + pick(r), 0);

    return NormalizerService.calculateMetrics(
      this.toRaw(
        { spend: sum(r => r.spend), impressions: sum(r => r.impressions), clicks: sum(r => r.clicks), conversions: sum(r => r.conversions) },
        ticket
      ),
      period.includeMetaTax ?? true
    );
  }

  public async getCampaigns(_accessToken: string, externalAccountId: string, period: PeriodSelection): Promise<CampaignData[]> {
    const acc = sheetsSnapshotStore.getAccount(externalAccountId);
    if (!acc) return [];
    const ticket = this.averageTicketFor(externalAccountId);

    return acc.campaigns.map(row => ({
      id: row.id,
      adAccountId: externalAccountId,
      externalCampaignId: row.id,
      name: row.name,
      status: 'UNKNOWN', // a planilha não reporta status de veiculação
      metrics: this.entityMetrics(row, period, ticket),
      dailyMetrics: this.entityDaily(acc.dailyByEntity.campaigns[row.id], period, ticket)
    }));
  }

  public async getAdSets(_accessToken: string, externalAccountId: string, period: PeriodSelection, campaignId?: string): Promise<AdSetData[]> {
    const acc = sheetsSnapshotStore.getAccount(externalAccountId);
    if (!acc) return [];
    const ticket = this.averageTicketFor(externalAccountId);

    const campaignNames = new Map(acc.campaigns.map(c => [c.id, c.name]));
    const rows = campaignId ? acc.adSets.filter(a => a.campaignId === campaignId) : acc.adSets;

    return rows.map(row => ({
      id: row.id,
      adAccountId: externalAccountId,
      campaignId: row.campaignId || '',
      campaignName: campaignNames.get(row.campaignId || '') || 'N/D',
      externalAdSetId: row.id,
      name: row.name,
      status: 'UNKNOWN', // a planilha não reporta status de veiculação
      metrics: this.entityMetrics(row, period, ticket),
      dailyMetrics: this.entityDaily(acc.dailyByEntity.adSets[row.id], period, ticket)
    }));
  }

  public async getAds(_accessToken: string, externalAccountId: string, period: PeriodSelection, adSetId?: string): Promise<AdData[]> {
    const acc = sheetsSnapshotStore.getAccount(externalAccountId);
    if (!acc) return [];
    const ticket = this.averageTicketFor(externalAccountId);

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
      status: 'UNKNOWN', // a planilha não reporta status de veiculação
      metrics: this.entityMetrics(row, period, ticket),
      dailyMetrics: this.entityDaily(acc.dailyByEntity.ads[row.id], period, ticket)
    }));
  }
}
