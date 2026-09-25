import React, { useEffect, useRef } from 'react';
import { Chart as ChartJS, registerables } from 'chart.js';
import { DailyMetricItem } from '../../types';
import { useTheme } from '../../context/ThemeContext';

ChartJS.register(...registerables);

/**
 * "Indicadores por dia": pares de métricas que se explicam uma pela outra.
 *
 * - CPM × CTR: o custo da mídia contra a atratividade do anúncio.
 * - CPL × CPMQL: quanto custa o lead e quanto custa o lead que presta.
 * - Tx. de lead × Tx. de qualificação: quem clica e cadastra, e de quem cadastra
 *   quantos são MQL.
 *
 * Dia sem base para uma razão (CTR sem impressão, CPMQL sem MQL) fica em branco.
 */

type Unit = 'money' | 'percent';

interface Series {
  label: string;
  unit: Unit;
  value: (d: DailyMetricItem) => number | null;
}

interface Pair {
  title: string;
  subtitle: string;
  a: Series;
  b: Series;
}

const has = (d: DailyMetricItem, ...keys: string[]) => !keys.some(k => d.unavailable?.includes(k as never));

const PAIRS: Pair[] = [
  {
    title: 'CPM e CTR por dia',
    subtitle: 'CPM (R$, esq.) · CTR (%, dir.)',
    a: { label: 'CPM', unit: 'money', value: d => (has(d, 'spend', 'impressions') && d.impressions > 0 ? (d.spend / d.impressions) * 1000 : null) },
    b: { label: 'CTR', unit: 'percent', value: d => (has(d, 'clicks', 'impressions') && d.impressions > 0 ? (d.clicks / d.impressions) * 100 : null) }
  },
  {
    title: 'CPL e CPMQL por dia',
    subtitle: 'Custo por lead e por lead qualificado (R$)',
    a: { label: 'CPL', unit: 'money', value: d => (has(d, 'cpl') ? d.cpl : null) },
    b: { label: 'CPMQL', unit: 'money', value: d => (has(d, 'cpmql') ? d.cpmql : null) }
  },
  {
    title: 'Taxa de lead e de qualificação',
    subtitle: 'Tx. lead = Leads / Cliques · Tx. qualif. = MQL / Leads',
    a: { label: 'Tx. lead', unit: 'percent', value: d => (has(d, 'leads', 'clicks') && d.clicks > 0 ? (d.leads / d.clicks) * 100 : null) },
    b: { label: 'Tx. qualificação', unit: 'percent', value: d => (has(d, 'mqls', 'leads') && d.leads > 0 ? (d.mqls / d.leads) * 100 : null) }
  }
];

const fmt = (unit: Unit, v: number) =>
  unit === 'money'
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
    : `${v.toFixed(2)}%`;

const axisTick = (unit: Unit) => (v: string | number) => {
  const n = Number(v);
  if (unit === 'percent') return `${n}%`;
  return n >= 1000 ? `R$${(n / 1000).toFixed(1)}k` : `R$${n}`;
};

const PairChart: React.FC<{ pair: Pair; daily: DailyMetricItem[]; theme: string }> = ({ pair, daily, theme }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    ChartJS.getChart(canvasRef.current)?.destroy();

    const isDark = theme === 'dark';
    const gridColor = isDark ? '#1F293D' : '#F1F5F9';
    const textColor = isDark ? '#94A3B8' : '#64748B';
    // Mesmo par de cores do gráfico combinado (CPL azul, CPMQL âmbar).
    const colorA = isDark ? '#3B82F6' : '#2563EB';
    const colorB = '#D97706';
    // Unidades diferentes ganham eixo próprio, com a unidade no subtítulo.
    const splitAxis = pair.a.unit !== pair.b.unit;

    const line = (s: Series, color: string, axis: string) => ({
      type: 'line' as const,
      label: s.label,
      data: daily.map(s.value),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      tension: 0.3,
      spanGaps: false,
      pointRadius: daily.length > 20 ? 0 : 3,
      pointHoverRadius: 5,
      yAxisID: axis
    });

    const chart = new ChartJS(canvasRef.current, {
      type: 'line',
      data: {
        labels: daily.map(d => d.date.split('-').reverse().slice(0, 2).join('/')),
        datasets: [line(pair.a, colorA, 'y'), line(pair.b, colorB, splitAxis ? 'y1' : 'y')]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: { boxWidth: 10, boxHeight: 10, font: { family: 'Plus Jakarta Sans', size: 11 }, color: textColor }
          },
          tooltip: {
            backgroundColor: isDark ? '#111722' : '#FFFFFF',
            titleColor: isDark ? '#F8FAFC' : '#0F172A',
            bodyColor: isDark ? '#94A3B8' : '#475569',
            borderColor: isDark ? '#1F293D' : '#E2E8F0',
            borderWidth: 1,
            padding: 10,
            usePointStyle: true,
            callbacks: {
              label: item => {
                const s = item.datasetIndex === 0 ? pair.a : pair.b;
                return item.raw === null ? ` ${s.label}: sem base no dia` : ` ${s.label}: ${fmt(s.unit, Number(item.raw))}`;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
          y: {
            beginAtZero: true,
            position: 'left',
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 10 }, maxTicksLimit: 5, callback: axisTick(pair.a.unit) }
          },
          ...(splitAxis
            ? {
                y1: {
                  beginAtZero: true,
                  position: 'right' as const,
                  grid: { drawOnChartArea: false },
                  ticks: { color: textColor, font: { size: 10 }, maxTicksLimit: 5, callback: axisTick(pair.b.unit) }
                }
              }
            : {})
        }
      }
    });
    return () => chart.destroy();
  }, [pair, daily, theme]);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div>
        <h3 style={{ fontSize: '13.5px', fontWeight: 700 }}>{pair.title}</h3>
        <p style={{ fontSize: '11px', color: 'var(--muted)' }}>{pair.subtitle}</p>
      </div>
      <div style={{ height: '190px', position: 'relative' }}>
        <canvas ref={canvasRef} role="img" aria-label={pair.title} />
      </div>
    </div>
  );
};

export const DailyIndicatorPairs: React.FC<{ daily: DailyMetricItem[] }> = ({ daily }) => {
  const { theme } = useTheme();
  // Par sem nenhum valor no período (ex.: conta sem mídia não tem CPM/CTR) sai.
  const visible = PAIRS.filter(p => daily.some(d => p.a.value(d) !== null || p.b.value(d) !== null));
  if (visible.length === 0) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
      {visible.map(p => (
        <PairChart key={p.title} pair={p} daily={daily} theme={theme} />
      ))}
    </div>
  );
};
