import React from 'react';
import { ColumnDef } from '../components/common/DataTable';
import { DailyMetricItem, NormalizedMetrics } from '../types';
import { metricText } from './metrics';

/**
 * Colunas da tabela diária com heatmap — a mesma na Visão Geral e no raio-X da
 * campanha, para os dois lugares lerem igual.
 *
 * CPM e CTR não vêm prontos na série diária; saem de gasto, impressões e
 * cliques do próprio dia. Se o dia não tem base (sem impressão), o normalizador
 * já marcou a métrica como indisponível e a célula mostra N/D.
 */

const money = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const num = (v: number) => new Intl.NumberFormat('pt-BR').format(v || 0);
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const dailyCpm = (d: DailyMetricItem) => (d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0);
export const dailyCtr = (d: DailyMetricItem) => (d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0);

export function buildDailyColumns(): ColumnDef<DailyMetricItem>[] {
  return [
    { id: 'date', header: 'Data', accessor: d => d.date.split('-').reverse().join('/'), align: 'left', sticky: true, width: '96px' },
    {
      id: 'weekday',
      header: 'Dia',
      accessor: d => WEEKDAYS[new Date(`${d.date}T12:00:00Z`).getUTCDay()],
      align: 'left',
      width: '48px',
      cell: v => <span style={{ color: 'var(--muted)' }}>{v}</span>
    },
    { id: 'spend', header: 'Investimento', accessor: d => d.spend, cell: (v, r) => metricText(r, 'spend', v, money), heatmap: true, heatmapColor: 'var(--heat-gasto)' },
    { id: 'impressions', header: 'Impressões', accessor: d => d.impressions, cell: (v, r) => metricText(r, 'impressions', v, num) },
    { id: 'cpm', header: 'CPM', accessor: dailyCpm, cell: (v, r) => metricText(r, 'cpm', v, money) },
    { id: 'clicks', header: 'Cliques', accessor: d => d.clicks, cell: (v, r) => metricText(r, 'clicks', v, num) },
    { id: 'ctr', header: 'CTR', accessor: dailyCtr, cell: (v, r) => metricText(r, 'ctr', v, n => `${n.toFixed(2)}%`) },
    { id: 'leads', header: 'Leads', accessor: d => d.leads, cell: (v, r) => metricText(r, 'leads', v, num), heatmap: true, heatmapColor: 'var(--heat-leads)' },
    { id: 'cpl', header: 'CPL', accessor: d => d.cpl, cell: (v, r) => metricText(r, 'cpl', v, money) },
    { id: 'mqls', header: 'MQLs', accessor: d => d.mqls, cell: (v, r) => metricText(r, 'mqls', v, num), heatmap: true, heatmapColor: 'var(--heat-mqls)' },
    { id: 'cpmql', header: 'CPMQL', accessor: d => d.cpmql, cell: (v, r) => metricText(r, 'cpmql', v, money) },
    { id: 'appointments', header: 'Agendamentos', accessor: d => d.appointments, cell: (v, r) => metricText(r, 'appointments', v, num) },
    { id: 'conversions', header: 'Vendas', accessor: d => d.conversions, cell: (v, r) => metricText(r, 'conversions', v, num), heatmap: true, heatmapColor: 'var(--heat-vendas)' },
    { id: 'revenue', header: 'Receita', accessor: d => d.revenue, cell: (v, r) => metricText(r, 'revenue', v, money), heatmap: true, heatmapColor: 'var(--heat-rec)' },
    {
      id: 'roas',
      header: 'ROAS',
      accessor: d => d.roas,
      cell: (v, r) => <span style={{ fontWeight: 800, color: 'var(--good)' }}>{metricText(r, 'roas', v, n => `${n.toFixed(2)}x`)}</span>
    }
  ];
}

/** Linha de total do período, a partir das métricas já agregadas pelo backend. */
export function buildDailyFooter(m: NormalizedMetrics, label = 'TOTAL ACUMULADO'): Record<string, React.ReactNode> {
  return {
    date: label,
    spend: metricText(m, 'spend', m.spend, money),
    impressions: metricText(m, 'impressions', m.impressions, num),
    cpm: metricText(m, 'cpm', m.cpm, money),
    clicks: metricText(m, 'clicks', m.clicks, num),
    ctr: metricText(m, 'ctr', m.ctr, n => `${n.toFixed(2)}%`),
    leads: metricText(m, 'leads', m.leads, num),
    cpl: metricText(m, 'cpl', m.cpl, money),
    mqls: metricText(m, 'mqls', m.mqls, num),
    cpmql: metricText(m, 'cpmql', m.cpmql, money),
    appointments: metricText(m, 'appointments', m.appointments, num),
    conversions: metricText(m, 'conversions', m.conversions, num),
    revenue: metricText(m, 'revenue', m.revenue, money),
    roas: metricText(m, 'roas', m.roas, n => `${n.toFixed(2)}x`)
  };
}
