import { DailyMetricItem, NormalizedMetrics, MetricName } from '../types';

/** Métricas que existem tanto no total quanto na série diária. */
export type SeriesMetric = Extract<MetricName, keyof DailyMetricItem>;

export interface EntityWithSeries {
  id: string;
  name: string;
  metrics: NormalizedMetrics;
  dailyMetrics?: DailyMetricItem[];
}

export interface ChartItem {
  id: string;
  name: string;
  color: string;
  dailyValues: { date: string; value: number }[];
  totalValue: number;
}

export const SERIES_COLORS = ['#3B5BDB', '#1BAF7A', '#E34948', '#E8A400', '#8AA0F0', '#9B59B6', '#16A085'];

/**
 * Monta as séries do gráfico a partir do diário REAL de cada entidade.
 *
 * Entidade sem série no snapshot fica de fora — antes o gráfico distribuía o
 * total do período pelos dias com uma oscilação inventada, o que produzia uma
 * curva convincente e falsa. Dias sem veiculação continuam ausentes.
 */
export function buildChartItems(
  entities: EntityWithSeries[],
  metric: SeriesMetric,
  limit = 8
): ChartItem[] {
  return entities
    .filter(e => Array.isArray(e.dailyMetrics) && e.dailyMetrics.length > 0)
    .filter(e => !e.metrics.unavailable.includes(metric))
    .slice(0, limit)
    .map((entity, idx) => ({
      id: entity.id,
      name: entity.name,
      color: SERIES_COLORS[idx % SERIES_COLORS.length],
      dailyValues: entity
        .dailyMetrics!.filter(d => !d.unavailable.includes(metric))
        .map(d => ({ date: d.date, value: d[metric] })),
      totalValue: entity.metrics[metric]
    }))
    .filter(item => item.dailyValues.length > 0);
}

export const NO_SERIES_MESSAGE =
  'Sem série diária no snapshot atual para estas entidades. Rode uma nova coleta pelo MCP incluindo o detalhamento por dia.';
