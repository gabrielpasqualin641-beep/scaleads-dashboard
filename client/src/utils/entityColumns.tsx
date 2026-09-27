import React from 'react';
import { ColumnDef } from '../components/common/DataTable';
import { MqlSource, NormalizedMetrics } from '../types';
import { metricText, mqlSourceLabel } from './metrics';

/**
 * Colunas de métrica de uma entidade (campanha, conjunto ou anúncio), da
 * verba ao ROAS. Usadas nas tabelas de conjuntos e criativos do raio-X da
 * campanha; o que a origem não mede é tirado depois por
 * `dropEmptyMetricColumns`.
 */

interface WithMetrics {
  metrics: NormalizedMetrics;
  mqlSource?: MqlSource;
}

const money = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const num = (v: number) => new Intl.NumberFormat('pt-BR').format(v || 0);

export function entityMetricColumns<T extends WithMetrics>(): ColumnDef<T>[] {
  return [
    { id: 'spend', header: 'Investimento', accessor: r => r.metrics.spend, cell: (v, r) => metricText(r.metrics, 'spend', v, money), heatmap: true, heatmapColor: 'var(--heat-gasto)' },
    { id: 'impressions', header: 'Impressões', accessor: r => r.metrics.impressions, cell: (v, r) => metricText(r.metrics, 'impressions', v, num) },
    { id: 'cpm', header: 'CPM', accessor: r => r.metrics.cpm, cell: (v, r) => metricText(r.metrics, 'cpm', v, money) },
    { id: 'clicks', header: 'Cliques', accessor: r => r.metrics.clicks, cell: (v, r) => metricText(r.metrics, 'clicks', v, num) },
    { id: 'ctr', header: 'CTR', accessor: r => r.metrics.ctr, cell: (v, r) => metricText(r.metrics, 'ctr', v, n => `${n.toFixed(2)}%`) },
    { id: 'cpc', header: 'CPC', accessor: r => r.metrics.cpc, cell: (v, r) => metricText(r.metrics, 'cpc', v, money) },
    { id: 'leads', header: 'Leads', accessor: r => r.metrics.leads, cell: (v, r) => metricText(r.metrics, 'leads', v, num), heatmap: true, heatmapColor: 'var(--heat-leads)' },
    { id: 'cpl', header: 'CPL', accessor: r => r.metrics.cpl, cell: (v, r) => metricText(r.metrics, 'cpl', v, money) },
    {
      id: 'mqls',
      header: 'MQLs',
      accessor: r => r.metrics.mqls,
      cell: (v, r) => (
        <span title={mqlSourceLabel(r.mqlSource)} style={{ cursor: 'help', borderBottom: '1px dotted var(--border)' }}>
          {metricText(r.metrics, 'mqls', v, num)}
        </span>
      ),
      heatmap: true,
      heatmapColor: 'var(--heat-mqls)'
    },
    { id: 'cpmql', header: 'CPMQL', accessor: r => r.metrics.cpmql, cell: (v, r) => metricText(r.metrics, 'cpmql', v, money) },
    { id: 'conversions', header: 'Vendas', accessor: r => r.metrics.conversions, cell: (v, r) => metricText(r.metrics, 'conversions', v, num), heatmap: true, heatmapColor: 'var(--heat-vendas)' },
    { id: 'cpa', header: 'CAC', accessor: r => r.metrics.cpa, cell: (v, r) => metricText(r.metrics, 'cpa', v, money) },
    { id: 'revenue', header: 'Receita', accessor: r => r.metrics.revenue, cell: (v, r) => metricText(r.metrics, 'revenue', v, money), heatmap: true, heatmapColor: 'var(--heat-rec)' },
    {
      id: 'roas',
      header: 'ROAS',
      accessor: r => r.metrics.roas,
      cell: (v, r) => <span style={{ fontWeight: 800, color: 'var(--good)' }}>{metricText(r.metrics, 'roas', v, n => `${n.toFixed(2)}x`)}</span>
    }
  ];
}
