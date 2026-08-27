import {
  AdAccount,
  CampaignData,
  AdSetData,
  AdData,
  DailyMetricItem,
  PeriodSelection,
  NormalizedMetrics,
  RankedItem,
  FunnelSegmentItem,
  QualifiedLeadItem
} from '../models/types.js';
import { AdvertisingProvider } from './AdvertisingProvider.js';
import { NormalizerService } from '../services/NormalizerService.js';

export class MockMetaProvider implements AdvertisingProvider {
  public platformId = 'meta_ads';

  public async testConnection(accessToken: string, accountId: string): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Conexão Meta Ads simulada com sucesso.' };
  }

  public async getAccountDetails(accessToken: string, externalAccountId: string): Promise<Partial<AdAccount>> {
    return {
      status: 'active',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo'
    };
  }

  /**
   * Gera uma seed determinística baseada na string
   */
  private pseudoRandom(seedStr: string): number {
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
      hash = (hash << 5) - hash + seedStr.charCodeAt(i);
      hash |= 0;
    }
    const x = Math.sin(hash) * 10000;
    return x - Math.floor(x);
  }

  public async getDailyInsights(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<DailyMetricItem[]> {
    const start = new Date(period.startDate);
    const end = new Date(period.endDate);
    const days: DailyMetricItem[] = [];

    // Fator de escala por conta
    const isMundo = externalAccountId.includes('472');
    const isGlow = externalAccountId.includes('552');
    const isPrime = externalAccountId.includes('773');
    
    const baseSpendPerDay = isGlow ? 420 : isPrime ? 650 : isMundo ? 280 : 380;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const rand = this.pseudoRandom(dateStr + externalAccountId);
      const rand2 = this.pseudoRandom(dateStr + 'metrics');
      const rand3 = this.pseudoRandom(dateStr + 'sales');

      const daySpend = Math.round(baseSpendPerDay * (0.8 + rand * 0.45));
      const dayImpressions = Math.round(daySpend * (18 + rand * 8));
      const dayReach = Math.round(dayImpressions * 0.78);
      const dayClicks = Math.round(dayImpressions * (0.015 + rand2 * 0.012));
      const dayLeads = Math.max(1, Math.round(dayClicks * (0.12 + rand * 0.08)));
      const dayMqls = Math.max(0, Math.round(dayLeads * (0.35 + rand2 * 0.25)));
      const dayAppointments = Math.max(0, Math.round(dayMqls * (0.28 + rand3 * 0.2)));
      const dayConversions = Math.max(0, Math.round(dayAppointments * (0.35 + rand3 * 0.35)));
      
      const ticketValue = isGlow ? 189 : isPrime ? 18500 : isMundo ? 450 : 2500;
      const dayRevenue = dayConversions * ticketValue;

      const norm = NormalizerService.calculateMetrics({
        spend: daySpend,
        impressions: dayImpressions,
        reach: dayReach,
        clicks: dayClicks,
        leads: dayLeads,
        mqls: dayMqls,
        appointments: dayAppointments,
        conversions: dayConversions,
        revenue: dayRevenue
      }, period.includeMetaTax ?? true);

      days.push({
        date: dateStr,
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
      });
    }

    return days;
  }

  public async getAggregatedMetrics(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<NormalizedMetrics> {
    const daily = await this.getDailyInsights(accessToken, externalAccountId, period);
    const totals = daily.reduce(
      (acc, item) => ({
        spend: acc.spend + item.spend,
        impressions: acc.impressions + item.impressions,
        reach: acc.reach + item.reach,
        clicks: acc.clicks + item.clicks,
        leads: acc.leads + item.leads,
        mqls: acc.mqls + item.mqls,
        appointments: acc.appointments + item.appointments,
        conversions: acc.conversions + item.conversions,
        revenue: acc.revenue + item.revenue
      }),
      { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, mqls: 0, appointments: 0, conversions: 0, revenue: 0 }
    );

    // Como os itens diários já consideraram o imposto, passamos applyTax = false para não aplicar em duplicidade
    return NormalizerService.calculateMetrics(totals, false);
  }

  public async getCampaigns(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection
  ): Promise<CampaignData[]> {
    const daily = await this.getDailyInsights(accessToken, externalAccountId, period);
    const totalSpend = daily.reduce((s, d) => s + d.spend, 0);

    const baseCampaigns = [
      {
        id: 'cmp_01',
        externalCampaignId: '2385102938401',
        name: 'APD | E2-CAP | P1-QUENTE | CONV | CBO | BR | Top Criativos',
        status: 'ACTIVE' as const,
        objective: 'OUTCOME_LEADS',
        share: 0.38
      },
      {
        id: 'cmp_02',
        externalCampaignId: '2385102938402',
        name: 'APD | E2-CAP | P2-FRIO | CONV | ABO | BR | Teste de Ads & LPs',
        status: 'ACTIVE' as const,
        objective: 'OUTCOME_LEADS',
        share: 0.32
      },
      {
        id: 'cmp_03',
        externalCampaignId: '2385102938403',
        name: 'DIAG | E2-CAP | P2-FRIO | CONV | ABO | BR | Diagnóstico Express',
        status: 'ACTIVE' as const,
        objective: 'OUTCOME_LEADS',
        share: 0.18
      },
      {
        id: 'cmp_04',
        externalCampaignId: '2385102938404',
        name: 'REMARKETING | E3-VENDAS | P1-QUENTE | CBO | Inscrições Abertas',
        status: 'PAUSED' as const,
        objective: 'OUTCOME_SALES',
        share: 0.12
      }
    ];

    return baseCampaigns.map(c => {
      const campSpend = totalSpend * c.share;
      const impressions = Math.round(campSpend * 22);
      const clicks = Math.round(impressions * 0.024);
      const leads = Math.round(clicks * 0.16);
      const mqls = Math.round(leads * 0.42);
      const appointments = Math.round(mqls * 0.3);
      const conversions = Math.round(appointments * 0.4);
      const revenue = conversions * 2500;

      const metrics = NormalizerService.calculateMetrics({
        spend: campSpend,
        impressions,
        clicks,
        leads,
        mqls,
        appointments,
        conversions,
        revenue
      }, false);

      return {
        id: c.id,
        adAccountId: externalAccountId,
        externalCampaignId: c.externalCampaignId,
        name: c.name,
        status: c.status,
        objective: c.objective,
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
    const campaigns = await this.getCampaigns(accessToken, externalAccountId, period);
    const targetCampaigns = campaignId ? campaigns.filter(c => c.id === campaignId) : campaigns;
    const adSets: AdSetData[] = [];

    const adSetTemplates = [
      { name: 'AUTO | Advantage+ | Públicos Semelhantes (Lookalike 1%)', share: 0.45 },
      { name: 'AUTO | MIX PQ | Interesses Qualificados em Formação', share: 0.35 },
      { name: 'AUTO | Aberto | Mulheres 25-54 Brasil', share: 0.20 }
    ];

    for (const cmp of targetCampaigns) {
      for (let i = 0; i < adSetTemplates.length; i++) {
        const tpl = adSetTemplates[i];
        const spend = cmp.metrics.spend * tpl.share;
        const impressions = Math.round(cmp.metrics.impressions * tpl.share);
        const clicks = Math.round(cmp.metrics.clicks * tpl.share);
        const leads = Math.round(cmp.metrics.leads * tpl.share);
        const mqls = Math.round(cmp.metrics.mqls * tpl.share);
        const appointments = Math.round(cmp.metrics.appointments * tpl.share);
        const conversions = Math.round(cmp.metrics.conversions * tpl.share);
        const revenue = conversions * 2500;

        const metrics = NormalizerService.calculateMetrics({
          spend,
          impressions,
          clicks,
          leads,
          mqls,
          appointments,
          conversions,
          revenue
        }, false);

        adSets.push({
          id: `adset_${cmp.id}_${i + 1}`,
          adAccountId: externalAccountId,
          campaignId: cmp.id,
          campaignName: cmp.name,
          externalAdSetId: `23852029384${i}${cmp.id.slice(-2)}`,
          name: tpl.name,
          status: 'ACTIVE',
          metrics
        });
      }
    }

    return adSets;
  }

  public async getAds(
    accessToken: string,
    externalAccountId: string,
    period: PeriodSelection,
    adSetId?: string
  ): Promise<AdData[]> {
    const adSets = await this.getAdSets(accessToken, externalAccountId, period);
    const targetAdSets = adSetId ? adSets.filter(a => a.id === adSetId) : adSets;
    const ads: AdData[] = [];

    const adTemplates = [
      {
        name: '[AD02] [VERSALHES] [VID] [LD] Vídeo Depoimento Transição de Carreira',
        format: 'video' as const,
        share: 0.40,
        permalinkUrl: 'https://instagram.com/p/C9example01',
        previewUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&auto=format&fit=crop&q=80'
      },
      {
        name: '[AD10] [VERSALHES] [BNR] [LD] Carrossel 5 Pilares do Método',
        format: 'image' as const,
        share: 0.32,
        permalinkUrl: 'https://instagram.com/p/C9example02',
        previewUrl: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=400&auto=format&fit=crop&q=80'
      },
      {
        name: '[AD20] [DIAGNÓSTICO] [VID] Convite Diagnóstico Gratuito 10min',
        format: 'video' as const,
        share: 0.18,
        permalinkUrl: 'https://instagram.com/p/C9example03',
        previewUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80'
      },
      {
        name: '[AD25] [ESTÁTICO] Frase de Impacto Faturamento Terapeuta',
        format: 'image' as const,
        share: 0.10,
        permalinkUrl: 'https://instagram.com/p/C9example04',
        previewUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&auto=format&fit=crop&q=80'
      }
    ];

    for (const as of targetAdSets) {
      for (let i = 0; i < adTemplates.length; i++) {
        const tpl = adTemplates[i];
        const spend = as.metrics.spend * tpl.share;
        const impressions = Math.round(as.metrics.impressions * tpl.share);
        const clicks = Math.round(as.metrics.clicks * tpl.share);
        const leads = Math.round(as.metrics.leads * tpl.share);
        const mqls = Math.round(as.metrics.mqls * tpl.share);
        const appointments = Math.round(as.metrics.appointments * tpl.share);
        const conversions = Math.round(as.metrics.conversions * tpl.share);
        const revenue = conversions * 2500;

        const metrics = NormalizerService.calculateMetrics({
          spend,
          impressions,
          clicks,
          leads,
          mqls,
          appointments,
          conversions,
          revenue
        }, false);

        ads.push({
          id: `ad_${as.id}_${i + 1}`,
          adAccountId: externalAccountId,
          campaignId: as.campaignId,
          campaignName: as.campaignName,
          adSetId: as.id,
          adSetName: as.name,
          externalAdId: `23853029384${i}${as.id.slice(-2)}`,
          name: tpl.name,
          status: 'ACTIVE',
          format: tpl.format,
          permalinkUrl: tpl.permalinkUrl,
          previewUrl: tpl.previewUrl,
          metrics
        });
      }
    }

    return ads;
  }

  public getDemographics(): {
    countries: RankedItem[];
    states: RankedItem[];
    moments: RankedItem[];
    experiences: RankedItem[];
    results: RankedItem[];
    invest: RankedItem[];
    returns: RankedItem[];
  } {
    return {
      countries: [
        { label: 'Brasil', count: 1842, percentage: 76.5 },
        { label: 'Portugal', count: 284, percentage: 11.8 },
        { label: 'Estados Unidos', count: 168, percentage: 7.0 },
        { label: 'Reino Unido', count: 48, percentage: 2.0 },
        { label: 'Outros', count: 66, percentage: 2.7 }
      ],
      states: [
        { label: 'São Paulo', count: 642, percentage: 34.8 },
        { label: 'Rio de Janeiro', count: 320, percentage: 17.4 },
        { label: 'Minas Gerais', count: 248, percentage: 13.5 },
        { label: 'Paraná', count: 184, percentage: 10.0 },
        { label: 'Rio Grande do Sul', count: 142, percentage: 7.7 },
        { label: 'Santa Catarina', count: 118, percentage: 6.4 },
        { label: 'Demais Estados', count: 188, percentage: 10.2 }
      ],
      moments: [
        { label: 'Sou autônoma / prestadora de serviços', count: 980, percentage: 40.7 },
        { label: 'Estou em transição de carreira', count: 624, percentage: 25.9 },
        { label: 'Trabalho com vínculo CLT', count: 412, percentage: 17.1 },
        { label: 'Sou empresária / tenho negócio próprio', count: 236, percentage: 9.8 },
        { label: 'Funcionária pública', count: 156, percentage: 6.5 }
      ],
      experiences: [
        { label: 'Não tenho nenhuma experiência', count: 1120, percentage: 46.5 },
        { label: 'Já fiz terapias ou cursos para mim', count: 680, percentage: 28.2 },
        { label: 'Estou estudando / em formação na área', count: 410, percentage: 17.0 },
        { label: 'Já atendo como terapeuta', count: 198, percentage: 8.3 }
      ],
      results: [
        { label: 'Fazer transição com total segurança', count: 1040, percentage: 43.2 },
        { label: 'Curar minhas dores e bloqueios', count: 680, percentage: 28.2 },
        { label: 'Crescer, me posicionar e acelerar', count: 420, percentage: 17.4 },
        { label: 'Aplicar no trabalho atual', count: 268, percentage: 11.2 }
      ],
      invest: [
        { label: 'Sim, se fizer sentido para mim', count: 1580, percentage: 65.6 },
        { label: 'Talvez', count: 540, percentage: 22.4 },
        { label: 'Ainda não', count: 288, percentage: 12.0 }
      ],
      returns: [
        { label: 'De 2 a 3 vezes mais', count: 920, percentage: 38.2 },
        { label: 'De 4 a 5 vezes mais', count: 640, percentage: 26.6 },
        { label: 'Ter retorno acima de 5x', count: 480, percentage: 19.9 },
        { label: 'Apenas aprender, sem foco imediato', count: 368, percentage: 15.3 }
      ]
    };
  }

  public getFunnelSegments(totalMetrics: NormalizedMetrics): FunnelSegmentItem[] {
    return [
      {
        id: 'seg_01',
        name: 'APD - BR (Brasil)',
        spend: Number((totalMetrics.spend * 0.62).toFixed(2)),
        leads: Math.round(totalMetrics.leads * 0.65),
        mqls: Math.round(totalMetrics.mqls * 0.64),
        appointments: Math.round(totalMetrics.appointments * 0.62),
        conversions: Math.round(totalMetrics.conversions * 0.60),
        revenue: Number((totalMetrics.revenue * 0.60).toFixed(2)),
        cpl: Number(((totalMetrics.spend * 0.62) / (totalMetrics.leads * 0.65 || 1)).toFixed(2)),
        cpmql: Number(((totalMetrics.spend * 0.62) / (totalMetrics.mqls * 0.64 || 1)).toFixed(2)),
        roas: Number(((totalMetrics.revenue * 0.60) / (totalMetrics.spend * 0.62 || 1)).toFixed(2))
      },
      {
        id: 'seg_02',
        name: 'APD - MUNDO (Internacional)',
        spend: Number((totalMetrics.spend * 0.25).toFixed(2)),
        leads: Math.round(totalMetrics.leads * 0.22),
        mqls: Math.round(totalMetrics.mqls * 0.24),
        appointments: Math.round(totalMetrics.appointments * 0.26),
        conversions: Math.round(totalMetrics.conversions * 0.28),
        revenue: Number((totalMetrics.revenue * 0.28).toFixed(2)),
        cpl: Number(((totalMetrics.spend * 0.25) / (totalMetrics.leads * 0.22 || 1)).toFixed(2)),
        cpmql: Number(((totalMetrics.spend * 0.25) / (totalMetrics.mqls * 0.24 || 1)).toFixed(2)),
        roas: Number(((totalMetrics.revenue * 0.28) / (totalMetrics.spend * 0.25 || 1)).toFixed(2))
      },
      {
        id: 'seg_03',
        name: 'DIAGNÓSTICO (Express)',
        spend: Number((totalMetrics.spend * 0.13).toFixed(2)),
        leads: Math.round(totalMetrics.leads * 0.13),
        mqls: Math.round(totalMetrics.mqls * 0.12),
        appointments: Math.round(totalMetrics.appointments * 0.12),
        conversions: Math.round(totalMetrics.conversions * 0.12),
        revenue: Number((totalMetrics.revenue * 0.12).toFixed(2)),
        cpl: Number(((totalMetrics.spend * 0.13) / (totalMetrics.leads * 0.13 || 1)).toFixed(2)),
        cpmql: Number(((totalMetrics.spend * 0.13) / (totalMetrics.mqls * 0.12 || 1)).toFixed(2)),
        roas: Number(((totalMetrics.revenue * 0.12) / (totalMetrics.spend * 0.13 || 1)).toFixed(2))
      }
    ];
  }

  public getQualifiedLeads(): QualifiedLeadItem[] {
    return [
      {
        id: 'ql_01',
        date: '2026-08-25',
        name: 'Fabiana Alencar',
        emailMasked: 'fa****@hotmail.com',
        phoneMasked: '…6833',
        campaign: 'APD | E2-CAP | P1-QUENTE | CONV',
        adSet: 'AUTO | MIX PQ | LP26',
        ad: '[AD10] [VERSALHES] [BNR] [LD]',
        funnel: 'APD-MUNDO',
        funil: 'APD-MUNDO',
        score: 'A',
        cityState: 'Massachusetts / US',
        country: 'United States',
        moment: 'Transição de carreira',
        appointmentBooked: true
      },
      {
        id: 'ql_02',
        date: '2026-08-25',
        name: 'Juliana Carvalho',
        emailMasked: 'ju****@gmail.com',
        phoneMasked: '…8858',
        campaign: 'APD | E2-CAP | P2-FRIO | CONV',
        adSet: 'AUTO | Advantage | AD025_IMG',
        ad: 'AD25_ESTATICO_APD_CAP',
        funnel: 'APD-BR',
        funil: 'APD-BR',
        score: 'B',
        cityState: 'Teresina / PI',
        country: 'Brasil',
        moment: 'Funcionária pública',
        appointmentBooked: true
      },
      {
        id: 'ql_03',
        date: '2026-08-24',
        name: 'Jane Silva',
        emailMasked: 'ja****@gmail.com',
        phoneMasked: '…5684',
        campaign: 'APD | E2-CAP | P2-FRIO | CONV',
        adSet: 'AUTO | Advantage | LP-3',
        ad: 'AD20_VIDEO_APD_CAP',
        funnel: 'APD-BR',
        funil: 'APD-BR',
        score: 'B',
        cityState: 'São Paulo / SP',
        country: 'Brasil',
        moment: 'Em formação na área',
        appointmentBooked: true
      },
      {
        id: 'ql_04',
        date: '2026-08-24',
        name: 'Érica Miranda',
        emailMasked: 'er****@gmail.com',
        phoneMasked: '…9744',
        campaign: 'DIAG | E2-CAP | P1-QUENTE | CONV',
        adSet: 'AUTO | Advantage | AD02',
        ad: '[AD02] [DIAGNÓSTICO] [VID]',
        funnel: 'DIAG',
        funil: 'DIAG',
        score: 'A',
        cityState: 'North Carolina / US',
        country: 'United States',
        moment: 'Já atende como terapeuta',
        appointmentBooked: true
      },
      {
        id: 'ql_05',
        date: '2026-08-23',
        name: 'Pamella Ramos',
        emailMasked: 'pa****@gmail.com',
        phoneMasked: '…0689',
        campaign: 'APD | E2-CAP | P2-FRIO | CONV',
        adSet: 'AUTO | Advantage | AD024_IMG',
        ad: 'AD24_ESTATICO_APD_CAP',
        funnel: 'APD-BR',
        funil: 'APD-BR',
        score: 'B',
        cityState: 'Florianópolis / SC',
        country: 'Brasil',
        moment: 'Autônoma / Serviços',
        appointmentBooked: false
      }
    ];
  }
}
