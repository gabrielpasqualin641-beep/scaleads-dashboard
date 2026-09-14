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
import { SheetsDailyRow, SheetsEntityRow, SheetsMetricSet } from '../integrations/sheets/types.js';
import { db } from '../db/database.js';
import { BriefService } from '../services/BriefService.js';
import { kommoMqlStore } from '../integrations/kommo/mqlStore.js';
import { leadExportStore } from '../integrations/metaLeads/leadExports.js';

/**
 * Provider alimentado por uma planilha (Adveronix).
 *
 * Cada cliente exporta colunas diferentes, então o que a origem reporta varia
 * por conta: uma planilha de e-commerce traz checkouts, uma de captação traz
 * leads. O snapshot já resolve isso — métrica que a planilha não tem chega
 * aqui como `null` e é repassada como N/D, nunca como zero.
 *
 * MQL não vem da planilha — é a qualificação humana do lead, e mora no CRM.
 * Quando a conta está ligada a um Kommo, a contagem vem de lá; caso contrário
 * fica N/D. Só entra no total da conta e na série diária: os leads chegam ao
 * CRM sem UTM, então não há como dizer de qual campanha veio cada MQL, e nas
 * linhas de campanha, conjunto e anúncio a métrica segue N/D.
 *
 * Agendamentos não existem em nenhuma das duas origens e seguem sempre N/D.
 *
 * Receita também não existe na planilha. Quando o cliente tem ticket médio
 * cadastrado no briefing, a receita é estimada como `conversões × ticket
 * médio` — uma aproximação, não um valor real de venda — para permitir ROAS
 * aproximado. Sem ticket cadastrado, receita e ROAS ficam N/D.
 */
export class SheetsAdsProvider implements AdvertisingProvider {
  public platformId = 'sheets';

  private averageTicketFor(externalAccountId: string): number | null {
    const account = db.getAccountByExternalId(externalAccountId);
    if (!account) return null;
    const brief = BriefService.get(account.clientId);
    return brief?.averageTicket ?? null;
  }

  private toRaw(row: SheetsMetricSet, ticket: number | null, mqls: number | null = null): RawMetricInput {
    return {
      spend: row.spend,
      impressions: row.impressions,
      // Reach só vem preenchido quando não houve agregação; frequência deriva
      // dele no normalizador e fica N/D junto.
      reach: row.reach,
      frequency: null,
      clicks: row.clicks,
      leads: row.leads,
      // MQL vem do CRM, nao da planilha: e a qualificacao humana do lead.
      // Ausente quando a conta nao esta ligada a um CRM.
      mqls,
      appointments: null,
      conversions: row.conversions,
      // Sem conversão medida não há o que multiplicar pelo ticket: estimar
      // receita a partir de nada seria inventar faturamento.
      revenue: ticket !== null && row.conversions !== null ? row.conversions * ticket : null
    };
  }

  /**
   * Métricas da entidade dentro do período selecionado.
   *
   * Antes usava a linha consolidada do snapshot, que soma a planilha inteira:
   * as tabelas de campanha, conjunto e anúncio mostravam o histórico todo, fosse
   * qual fosse a data escolhida. Com o MQL por criativo isso deixava de ser só
   * impreciso e virava contraditório — MQL do período dividido por leads de
   * todos os tempos.
   */
  private entityMetrics(
    series: SheetsDailyRow[] | undefined,
    period: PeriodSelection,
    ticket: number | null,
    mqls: number | null = null
  ): NormalizedMetrics {
    const rows = (series || []).filter(d => d.date >= period.startDate && d.date <= period.endDate);
    const merged = this.mergeRows(rows, period.startDate);
    return NormalizerService.calculateMetrics(this.toRaw(merged, ticket, mqls), period.includeMetaTax ?? true);
  }

  /**
   * MQL da conta num dia.
   *
   * O export manual vem primeiro: nos dias que ele cobre, é a contagem completa,
   * enquanto o CRM pode estar perdendo leads — um formulário novo sem mapeamento
   * no conector fez 98% dos leads dele não chegarem ao Kommo. Fora da janela do
   * export, quem responde é o CRM. Cada dia tem uma origem só, para o mesmo lead
   * nunca ser contado duas vezes.
   */
  private mqlForDate(accountId: string, date: string): number | null {
    const exportado = leadExportStore.forAccountDate(accountId, date);
    if (exportado) return exportado.mqls;
    return kommoMqlStore.forDate(accountId, date)?.mqls ?? null;
  }

  private mqlForPeriod(accountId: string, period: PeriodSelection): number | null {
    let total = 0;
    let algum = false;
    const d = new Date(`${period.startDate}T12:00:00Z`);
    const fim = new Date(`${period.endDate}T12:00:00Z`);
    for (; d <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
      const v = this.mqlForDate(accountId, d.toISOString().slice(0, 10));
      if (v !== null) { total += v; algum = true; }
    }
    return algum ? total : null;
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

  /** Trechos de nome de campanha que esta conta mantém fora dos totais. */
  private exclusionsFor(externalAccountId: string): string[] {
    return db.getAccountByExternalId(externalAccountId)?.excludedCampaigns ?? [];
  }

  private isExcluded(campaignName: string, patterns: string[]): boolean {
    const name = campaignName.toLowerCase();
    return patterns.some(p => name.includes(p.trim().toLowerCase()));
  }

  /**
   * Soma linhas diárias de várias campanhas num único dia.
   *
   * Métrica que nenhuma campanha reporta continua null: somar daria zero, e
   * zero afirma "não aconteceu" onde a verdade é "não é medido".
   */
  private mergeRows(rows: SheetsDailyRow[], date: string): SheetsDailyRow {
    const sumNullable = (pick: (r: SheetsDailyRow) => number | null): number | null =>
      rows.some(r => pick(r) !== null) ? rows.reduce((t, r) => t + (pick(r) ?? 0), 0) : null;

    return {
      date,
      spend: rows.reduce((t, r) => t + r.spend, 0),
      impressions: rows.reduce((t, r) => t + r.impressions, 0),
      clicks: rows.reduce((t, r) => t + r.clicks, 0),
      landingPageViews: sumNullable(r => r.landingPageViews),
      conversions: sumNullable(r => r.conversions),
      leads: sumNullable(r => r.leads),
      // Alcance não soma entre campanhas: a mesma pessoa pode ter visto as duas.
      reach: null
    };
  }

  /**
   * Série diária da conta considerando apenas as campanhas incluídas.
   *
   * Sem exclusão, usa a série pronta do snapshot. Com exclusão, reconstrói a
   * partir das campanhas que ficam — é a única forma de tirar o gasto de uma
   * campanha do total, já que a série da conta já vem somada.
   */
  private dailyRows(externalAccountId: string, period: PeriodSelection): SheetsDailyRow[] {
    const patterns = this.exclusionsFor(externalAccountId);
    if (patterns.length === 0) {
      return sheetsSnapshotStore.getDailyRange(externalAccountId, period.startDate, period.endDate);
    }

    const acc = sheetsSnapshotStore.getAccount(externalAccountId);
    if (!acc) return [];

    const byDate = new Map<string, SheetsDailyRow[]>();
    for (const campaign of acc.campaigns) {
      if (this.isExcluded(campaign.name, patterns)) continue;
      for (const row of acc.dailyByEntity.campaigns[campaign.id] || []) {
        if (row.date < period.startDate || row.date > period.endDate) continue;
        const list = byDate.get(row.date) || [];
        list.push(row);
        byDate.set(row.date, list);
      }
    }

    return Array.from(byDate.entries())
      .map(([date, rows]) => this.mergeRows(rows, date))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Campanhas fora do total, com o quanto cada uma gastou no período. */
  public excludedSummary(externalAccountId: string, period: PeriodSelection): Array<{ name: string; spend: number }> {
    const patterns = this.exclusionsFor(externalAccountId);
    if (patterns.length === 0) return [];
    const acc = sheetsSnapshotStore.getAccount(externalAccountId);
    if (!acc) return [];

    return acc.campaigns
      .filter(c => this.isExcluded(c.name, patterns))
      .map(c => ({
        name: c.name,
        spend: (acc.dailyByEntity.campaigns[c.id] || [])
          .filter(r => r.date >= period.startDate && r.date <= period.endDate)
          .reduce((t, r) => t + r.spend, 0)
      }))
      .filter(c => c.spend > 0);
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
    const rows = this.dailyRows(externalAccountId, period);

    return rows.map(row => {
      const mqls = this.mqlForDate(externalAccountId, row.date);
      const m = NormalizerService.calculateMetrics(this.toRaw(row, ticket, mqls), period.includeMetaTax ?? true);
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
    const rows = this.dailyRows(externalAccountId, period);
    const sum = (pick: (r: SheetsDailyRow) => number) => rows.reduce((total, r) => total + pick(r), 0);

    // Métrica que a planilha não reporta é null em todos os dias e continua
    // null no total — somar daria zero, que o painel exibiria como "nenhum
    // resultado" em vez de "não medido".
    const sumNullable = (pick: (r: SheetsDailyRow) => number | null): number | null =>
      rows.some(r => pick(r) !== null) ? rows.reduce((total, r) => total + (pick(r) ?? 0), 0) : null;

    return NormalizerService.calculateMetrics(
      this.toRaw(
        {
          spend: sum(r => r.spend),
          impressions: sum(r => r.impressions),
          clicks: sum(r => r.clicks),
          landingPageViews: sumNullable(r => r.landingPageViews),
          conversions: sumNullable(r => r.conversions),
          leads: sumNullable(r => r.leads),
          // Alcance não soma entre dias: a mesma pessoa alcançada ontem e hoje
          // seria contada duas vezes.
          reach: null
        },
        ticket,
        this.mqlForPeriod(externalAccountId, period)
      ),
      period.includeMetaTax ?? true
    );
  }

  public async getCampaigns(_accessToken: string, externalAccountId: string, period: PeriodSelection): Promise<CampaignData[]> {
    const acc = sheetsSnapshotStore.getAccount(externalAccountId);
    if (!acc) return [];
    const ticket = this.averageTicketFor(externalAccountId);

    const patterns = this.exclusionsFor(externalAccountId);
    return acc.campaigns.filter(c => !this.isExcluded(c.name, patterns)).map(row => ({
      id: row.id,
      adAccountId: externalAccountId,
      externalCampaignId: row.id,
      name: row.name,
      status: 'UNKNOWN', // a planilha não reporta status de veiculação
      metrics: this.entityMetrics(acc.dailyByEntity.campaigns[row.id], period, ticket),
      dailyMetrics: this.entityDaily(acc.dailyByEntity.campaigns[row.id], period, ticket)
    }));
  }

  public async getAdSets(_accessToken: string, externalAccountId: string, period: PeriodSelection, campaignId?: string): Promise<AdSetData[]> {
    const acc = sheetsSnapshotStore.getAccount(externalAccountId);
    if (!acc) return [];
    const ticket = this.averageTicketFor(externalAccountId);

    const campaignNames = new Map(acc.campaigns.map(c => [c.id, c.name]));
    const patterns = this.exclusionsFor(externalAccountId);
    const hidden = new Set(acc.campaigns.filter(c => this.isExcluded(c.name, patterns)).map(c => c.id));
    const visible = acc.adSets.filter(a => !hidden.has(a.campaignId || ''));
    const rows = campaignId ? visible.filter(a => a.campaignId === campaignId) : visible;

    return rows.map(row => ({
      id: row.id,
      adAccountId: externalAccountId,
      campaignId: row.campaignId || '',
      campaignName: campaignNames.get(row.campaignId || '') || 'N/D',
      externalAdSetId: row.id,
      name: row.name,
      status: 'UNKNOWN', // a planilha não reporta status de veiculação
      metrics: this.entityMetrics(acc.dailyByEntity.adSets[row.id], period, ticket),
      dailyMetrics: this.entityDaily(acc.dailyByEntity.adSets[row.id], period, ticket)
    }));
  }

  public async getAds(_accessToken: string, externalAccountId: string, period: PeriodSelection, adSetId?: string): Promise<AdData[]> {
    const acc = sheetsSnapshotStore.getAccount(externalAccountId);
    if (!acc) return [];
    const ticket = this.averageTicketFor(externalAccountId);

    const campaignNames = new Map(acc.campaigns.map(c => [c.id, c.name]));
    const adSetNames = new Map(acc.adSets.map(a => [a.id, a.name]));
    const patterns = this.exclusionsFor(externalAccountId);
    const hidden = new Set(acc.campaigns.filter(c => this.isExcluded(c.name, patterns)).map(c => c.id));
    const visible = acc.ads.filter(a => !hidden.has(a.campaignId || ''));
    const rows = adSetId ? visible.filter(a => a.adSetId === adSetId) : visible;

    return rows.map(row => {
      // MQL por criativo só existe onde houve export: o CRM não sabe de qual
      // anúncio veio cada lead.
      const exportado = leadExportStore.forAd(externalAccountId, row.id, period.startDate, period.endDate);
      return {
        id: row.id,
        adAccountId: externalAccountId,
        campaignId: row.campaignId || '',
        campaignName: campaignNames.get(row.campaignId || '') || 'N/D',
        adSetId: row.adSetId || '',
        adSetName: adSetNames.get(row.adSetId || '') || 'N/D',
        externalAdId: row.id,
        name: row.name,
        status: 'UNKNOWN', // a planilha não reporta status de veiculação
        metrics: this.entityMetrics(acc.dailyByEntity.ads[row.id], period, ticket, exportado?.mqls ?? null),
        dailyMetrics: this.entityDaily(acc.dailyByEntity.ads[row.id], period, ticket),
        mqlCoverage: exportado?.coverage ?? null
      };
    });
  }
}
