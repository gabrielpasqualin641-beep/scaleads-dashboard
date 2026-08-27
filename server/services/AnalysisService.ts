import {
  AnalysisBenchmark,
  AnalysisItem,
  AnalysisResponse,
  AnalysisSignal,
  AnalysisVerdict,
  CampaignData,
  AdSetData,
  AdData,
  NormalizedMetrics,
  PeriodSelection,
  ProjectBrief,
  MetricName
} from '../models/types.js';
import { db } from '../db/database.js';
import { resolveProvider } from './ProviderResolver.js';
import { BriefService } from './BriefService.js';

/**
 * Análise de performance por regras determinísticas sobre métricas reais.
 *
 * Não há IA aqui, e é de propósito: todo veredito é reproduzível e vem
 * acompanhado do número que o disparou, para o gestor conferir a conta em vez
 * de confiar. Métrica ausente nunca vira suposição — a entidade cai em
 * `sem_dados`.
 */

/** Abaixo desse volume de leads o CPL oscila demais para sustentar decisão. */
const MIN_LEADS_PARA_DECIDIR = 20;

/** Gasto sem nenhum lead a partir do qual já dá para chamar de desperdício. */
const GASTO_SEM_RESULTADO = 200;

/** Frequência a partir da qual o público começa a saturar. */
const FREQUENCIA_SATURADA = 2.5;

const CPL_BOM = 0.8; // <= 80% da referência
const CPL_RUIM = 1.5; // >= 150% da referência

type Entity = CampaignData | AdSetData | AdData;

function has(metrics: NormalizedMetrics, metric: MetricName): boolean {
  return !metrics.unavailable.includes(metric);
}

/** Média ponderada pelo investimento — evita que entidade minúscula distorça. */
function weightedAverage(items: Array<{ value: number; weight: number }>): number | null {
  const valid = items.filter(i => Number.isFinite(i.value) && i.weight > 0);
  const totalWeight = valid.reduce((sum, i) => sum + i.weight, 0);
  if (totalWeight === 0) return null;
  return valid.reduce((sum, i) => sum + i.value * i.weight, 0) / totalWeight;
}

export class AnalysisService {
  private static benchmark(entities: Entity[], brief: ProjectBrief | null): AnalysisBenchmark {
    const comCpl = entities.filter(e => has(e.metrics, 'cpl') && e.metrics.leads > 0);

    const cplMedio = weightedAverage(comCpl.map(e => ({ value: e.metrics.cpl, weight: e.metrics.spend })));

    const ctrMedio = weightedAverage(
      entities.filter(e => has(e.metrics, 'ctr')).map(e => ({ value: e.metrics.ctr, weight: e.metrics.impressions }))
    );

    const freqMedia = weightedAverage(
      entities
        .filter(e => has(e.metrics, 'frequency'))
        .map(e => ({ value: e.metrics.frequency, weight: e.metrics.impressions }))
    );

    // A meta do briefing tem prioridade: comparar contra a média da própria
    // conta só diz quem é melhor que a média, não quem é bom.
    if (brief?.targetCpl && brief.targetCpl > 0) {
      return { cplSource: 'meta_do_briefing', cpl: brief.targetCpl, ctr: ctrMedio, frequency: freqMedia };
    }
    if (cplMedio !== null) {
      return { cplSource: 'media_da_conta', cpl: cplMedio, ctr: ctrMedio, frequency: freqMedia };
    }
    return { cplSource: 'indisponivel', cpl: null, ctr: ctrMedio, frequency: freqMedia };
  }

  private static classify(
    entity: Entity,
    benchmark: AnalysisBenchmark
  ): { verdict: AnalysisVerdict; signals: AnalysisSignal[]; rationale: string } {
    const m = entity.metrics;
    const signals: AnalysisSignal[] = [];

    const temCpl = has(m, 'cpl') && m.leads > 0;
    const temGasto = has(m, 'spend') && m.spend > 0;

    // Sem custo por lead não há como julgar eficiência de captação.
    if (!temCpl) {
      if (temGasto && m.spend >= GASTO_SEM_RESULTADO && has(m, 'leads') && m.leads === 0) {
        signals.push({
          metric: 'leads',
          label: 'Investimento sem nenhum lead no período',
          value: m.spend,
          reference: null,
          direction: 'bad'
        });
        return {
          verdict: 'cortar',
          signals,
          rationale: `Consumiu investimento e não gerou lead algum no período.`
        };
      }
      return {
        verdict: 'sem_dados',
        signals,
        rationale: 'A Meta não reportou leads para esta entidade — sem base para classificar.'
      };
    }

    const ratio = benchmark.cpl ? m.cpl / benchmark.cpl : null;

    if (ratio !== null) {
      signals.push({
        metric: 'cpl',
        label: benchmark.cplSource === 'meta_do_briefing' ? 'CPL vs. meta do briefing' : 'CPL vs. média da conta',
        value: m.cpl,
        reference: benchmark.cpl,
        direction: ratio <= CPL_BOM ? 'good' : ratio >= CPL_RUIM ? 'bad' : 'neutral'
      });
    }

    const volumeOk = m.leads >= MIN_LEADS_PARA_DECIDIR;
    signals.push({
      metric: 'volume',
      label: 'Volume de leads no período',
      value: m.leads,
      reference: MIN_LEADS_PARA_DECIDIR,
      direction: volumeOk ? 'good' : 'neutral'
    });

    if (has(m, 'frequency') && m.frequency >= FREQUENCIA_SATURADA) {
      signals.push({
        metric: 'frequency',
        label: 'Frequência alta — público saturando',
        value: m.frequency,
        reference: FREQUENCIA_SATURADA,
        direction: 'bad'
      });
    }

    if (has(m, 'ctr') && benchmark.ctr !== null && m.ctr < benchmark.ctr * 0.7) {
      signals.push({
        metric: 'ctr',
        label: 'CTR abaixo da média da conta',
        value: m.ctr,
        reference: benchmark.ctr,
        direction: 'bad'
      });
    }

    const saturado = signals.some(s => s.metric === 'frequency' && s.direction === 'bad');
    const ctrFraco = signals.some(s => s.metric === 'ctr' && s.direction === 'bad');

    // Volume baixo nunca vira decisão de escalar ou cortar: fica em observação.
    if (!volumeOk) {
      return {
        verdict: 'observar',
        signals,
        rationale: `Apenas ${m.leads} lead(s) no período — amostra pequena demais para decidir.`
      };
    }

    if (ratio !== null && ratio <= CPL_BOM && !saturado) {
      return {
        verdict: 'escalar',
        signals,
        rationale: `CPL ${(100 - ratio * 100).toFixed(0)}% abaixo da referência com volume relevante.`
      };
    }

    if (ratio !== null && ratio >= CPL_RUIM) {
      return {
        verdict: 'cortar',
        signals,
        rationale: `CPL ${((ratio - 1) * 100).toFixed(0)}% acima da referência com volume relevante.`
      };
    }

    const motivos: string[] = [];
    if (saturado) motivos.push('frequência alta');
    if (ctrFraco) motivos.push('CTR abaixo da média');
    if (ratio !== null && ratio > CPL_BOM) motivos.push('CPL próximo do limite');

    return {
      verdict: 'otimizar',
      signals,
      rationale: motivos.length ? `Dá para melhorar: ${motivos.join(', ')}.` : 'Dentro da faixa aceitável, sem folga para escalar.'
    };
  }

  public static async analyze(
    clientId: string,
    accountId: string,
    period: PeriodSelection
  ): Promise<AnalysisResponse> {
    const client = db.getClientById(clientId);
    if (!client) throw new Error(`Cliente ${clientId} não encontrado.`);

    const accounts = db.getAccountsByClient(clientId);
    const targets = accountId === 'all' ? accounts : accounts.filter(a => a.id === accountId);
    const brief = BriefService.get(clientId);

    const campaigns: Array<{ entity: CampaignData; accId: string; accName: string }> = [];
    const adSets: Array<{ entity: AdSetData; accId: string; accName: string }> = [];
    const ads: Array<{ entity: AdData; accId: string; accName: string }> = [];

    for (const acc of targets) {
      const { provider } = resolveProvider(acc);
      const [c, s, a] = await Promise.all([
        provider.getCampaigns('', acc.externalAccountId, period),
        provider.getAdSets('', acc.externalAccountId, period),
        provider.getAds('', acc.externalAccountId, period)
      ]);
      campaigns.push(...c.map(entity => ({ entity, accId: acc.id, accName: acc.name })));
      adSets.push(...s.map(entity => ({ entity, accId: acc.id, accName: acc.name })));
      ads.push(...a.map(entity => ({ entity, accId: acc.id, accName: acc.name })));
    }

    const todas = [...campaigns, ...adSets, ...ads];
    // A referência sai do nível campanha: é onde o orçamento é decidido.
    const benchmark = this.benchmark(campaigns.map(c => c.entity), brief);

    const gastoTotal = campaigns.reduce((sum, c) => sum + (has(c.entity.metrics, 'spend') ? c.entity.metrics.spend : 0), 0);

    const items: AnalysisItem[] = todas.map(({ entity, accId, accName }) => {
      const level: AnalysisItem['level'] =
        'externalCampaignId' in entity ? 'campaign' : 'externalAdSetId' in entity ? 'adset' : 'ad';
      const { verdict, signals, rationale } = this.classify(entity, benchmark);

      return {
        level,
        id: entity.id,
        name: entity.name,
        accountId: accId,
        accountName: accName,
        status: entity.status,
        verdict,
        rationale,
        signals,
        metrics: entity.metrics,
        spendShare: gastoTotal > 0 && has(entity.metrics, 'spend') ? entity.metrics.spend / gastoTotal : 0
      };
    });

    const porVeredito = (v: AnalysisVerdict) => items.filter(i => i.level === 'campaign' && i.verdict === v).length;

    const limitacoes: string[] = [];
    if (benchmark.cplSource === 'media_da_conta') {
      limitacoes.push(
        'Sem meta de CPL no briefing, a comparação é contra a média da própria conta — mostra quem está acima ou abaixo da média, não se o custo é saudável para o negócio.'
      );
    }
    if (benchmark.cplSource === 'indisponivel') {
      limitacoes.push('Nenhuma entidade tem CPL no período: não há referência para classificar.');
    }
    limitacoes.push(
      'MQL, agendamento e venda não são reportados nesta integração, então a análise para no custo por lead e não alcança qualidade de lead nem CAC.'
    );

    // Uma meta única de CPL não serve para contas com objetivos diferentes:
    // captação de lead e venda direta têm custos por lead incomparáveis.
    const objetivos = new Set(
      campaigns.map(c => c.entity.objective).filter((o): o is string => !!o)
    );
    if (objetivos.size > 1 && benchmark.cplSource === 'meta_do_briefing') {
      limitacoes.push(
        `As campanhas do período têm objetivos diferentes (${[...objetivos].join(', ')}), mas a comparação usa um único CPL alvo. ` +
          'Campanha de venda direta tem custo por lead naturalmente mais alto que campanha de captação — leia os vereditos por conta, não misturado.'
      );
    }

    return {
      clientId,
      period: {
        startDate: period.startDate,
        endDate: period.endDate,
        label: `${period.startDate.split('-').reverse().join('/')} a ${period.endDate.split('-').reverse().join('/')}`
      },
      benchmark,
      items,
      summary: {
        escalar: porVeredito('escalar'),
        otimizar: porVeredito('otimizar'),
        cortar: porVeredito('cortar'),
        observar: porVeredito('observar'),
        semDados: porVeredito('sem_dados'),
        spendEmCorte: items
          .filter(i => i.level === 'campaign' && i.verdict === 'cortar')
          .reduce((sum, i) => sum + i.metrics.spend, 0)
      },
      limitacoes
    };
  }
}
