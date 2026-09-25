import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chart as ChartJS, registerables } from 'chart.js';
import { DailyMetricItem, MetricName, NormalizedMetrics } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { metricText } from '../../utils/metrics';

ChartJS.register(...registerables);

/**
 * Todas as métricas diárias de uma campanha, uma por painel.
 *
 * Um painel por métrica (small multiples) em vez de um gráfico com tudo junto:
 * investimento em reais, CTR em % e leads em unidades não cabem na mesma escala,
 * e um segundo eixo faria a leitura depender de qual eixo é de quem. Todos os
 * painéis compartilham a mesma linha do tempo, então dá para bater o olho e ver
 * que o dia em que o CPM subiu é o dia em que o CPL piorou.
 *
 * Volume (gasto, leads, cliques) é barra; custo e taxa (CPL, CTR, CPM) é linha.
 * Dia sem base para a razão — CPL num dia sem lead — vira buraco na linha, não
 * zero: zero diria "o lead saiu de graça".
 */

type Kind = 'money' | 'count' | 'percent';
type Mark = 'bar' | 'line';

interface MetricDef {
  key: string;
  label: string;
  kind: Kind;
  mark: Mark;
  /** Valor do dia, ou null quando o dia não tem base para a métrica. */
  value: (d: DailyMetricItem) => number | null;
  /** Número do período, vindo do total já calculado pelo backend. */
  total: MetricName;
  /** Métricas de origem: se alguma está indisponível no dia, o valor é null. */
  needs: MetricName[];
}

const safe = (d: DailyMetricItem, needs: MetricName[], v: () => number | null): number | null =>
  needs.some(n => d.unavailable?.includes(n)) ? null : v();

const METRICS: MetricDef[] = [
  { key: 'spend', label: 'Investimento', kind: 'money', mark: 'bar', total: 'spend', needs: ['spend'], value: d => d.spend },
  { key: 'leads', label: 'Leads', kind: 'count', mark: 'bar', total: 'leads', needs: ['leads'], value: d => d.leads },
  { key: 'mqls', label: 'MQL', kind: 'count', mark: 'bar', total: 'mqls', needs: ['mqls'], value: d => d.mqls },
  { key: 'cpl', label: 'CPL', kind: 'money', mark: 'line', total: 'cpl', needs: ['spend', 'leads'],
    value: d => (d.leads > 0 ? d.spend / d.leads : null) },
  { key: 'cpmql', label: 'CPMQL', kind: 'money', mark: 'line', total: 'cpmql', needs: ['spend', 'mqls'],
    value: d => (d.mqls > 0 ? d.spend / d.mqls : null) },
  { key: 'impressions', label: 'Impressões', kind: 'count', mark: 'bar', total: 'impressions', needs: ['impressions'], value: d => d.impressions },
  { key: 'cpm', label: 'CPM', kind: 'money', mark: 'line', total: 'cpm', needs: ['spend', 'impressions'],
    value: d => (d.impressions > 0 ? (d.spend / d.impressions) * 1000 : null) },
  { key: 'clicks', label: 'Cliques', kind: 'count', mark: 'bar', total: 'clicks', needs: ['clicks'], value: d => d.clicks },
  { key: 'ctr', label: 'CTR', kind: 'percent', mark: 'line', total: 'ctr', needs: ['clicks', 'impressions'],
    value: d => (d.impressions > 0 ? (d.clicks / d.impressions) * 100 : null) },
  { key: 'cpc', label: 'CPC', kind: 'money', mark: 'line', total: 'cpc', needs: ['spend', 'clicks'],
    value: d => (d.clicks > 0 ? d.spend / d.clicks : null) },
  { key: 'conversions', label: 'Conversões', kind: 'count', mark: 'bar', total: 'conversions', needs: ['conversions'], value: d => d.conversions },
  { key: 'cpa', label: 'CPA', kind: 'money', mark: 'line', total: 'cpa', needs: ['spend', 'conversions'],
    value: d => (d.conversions > 0 ? d.spend / d.conversions : null) },
  { key: 'revenue', label: 'Receita', kind: 'money', mark: 'bar', total: 'revenue', needs: ['revenue'], value: d => d.revenue },
  { key: 'roas', label: 'ROAS', kind: 'count', mark: 'line', total: 'roas', needs: ['revenue', 'spend'],
    value: d => (d.spend > 0 ? d.revenue / d.spend : null) }
];

const money = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const count = (v: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(v);

function format(kind: Kind, v: number): string {
  if (kind === 'money') return money(v);
  if (kind === 'percent') return `${v.toFixed(2)}%`;
  return count(v);
}

const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

interface PanelProps {
  def: MetricDef;
  daily: DailyMetricItem[];
  totalText: string;
  themeKey: string;
}

const Panel: React.FC<PanelProps> = ({ def, daily, totalText, themeKey }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    ChartJS.getChart(canvasRef.current)?.destroy();

    const series = cssVar('--accent-blue', '#2563EB');
    const muted = cssVar('--muted', '#64748B');
    const grid = cssVar('--border', '#E2E8F0');
    const surface = cssVar('--surface', '#FFFFFF');
    const values = daily.map(d => safe(d, def.needs, () => def.value(d)));

    const chart = new ChartJS(canvasRef.current, {
      type: def.mark,
      data: {
        labels: daily.map(d => shortDate(d.date)),
        datasets: [
          def.mark === 'bar'
            ? { data: values, backgroundColor: series, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 18 }
            : {
                data: values,
                borderColor: series,
                backgroundColor: series,
                borderWidth: 2,
                tension: 0.25,
                spanGaps: false,
                pointRadius: daily.length > 20 ? 0 : 3,
                pointHoverRadius: 5,
                pointBorderColor: surface,
                pointBorderWidth: 2
              }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              label: ctx => (ctx.parsed.y === null ? 'sem base no dia' : format(def.kind, ctx.parsed.y))
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: grid },
            ticks: { color: muted, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }
          },
          y: {
            beginAtZero: true,
            grid: { color: grid },
            border: { display: false },
            ticks: {
              color: muted,
              font: { size: 10 },
              maxTicksLimit: 4,
              callback: v => {
                const n = Number(v);
                if (def.kind === 'percent') return `${n}%`;
                if (def.kind === 'money') return n >= 1000 ? `R$${(n / 1000).toFixed(1)}k` : `R$${n}`;
                return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
              }
            }
          }
        }
      }
    });
    return () => chart.destroy();
  }, [def, daily, themeKey]);

  return (
    <div className="card" style={{ padding: '12px 12px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {def.label}
        </span>
        <span className="tabular-nums" style={{ fontSize: '14px', fontWeight: 800, color: 'var(--ink)' }}>{totalText}</span>
      </div>
      <div style={{ height: '120px', position: 'relative' }}>
        <canvas ref={canvasRef} role="img" aria-label={`${def.label} por dia`} />
      </div>
    </div>
  );
};

interface CampaignMetricsGridProps {
  daily: DailyMetricItem[] | undefined;
  totals: NormalizedMetrics;
}

export const CampaignMetricsGrid: React.FC<CampaignMetricsGridProps> = ({ daily, totals }) => {
  const { theme } = useTheme();
  const [showTable, setShowTable] = useState(false);
  const rows = useMemo(() => [...(daily || [])].sort((a, b) => a.date.localeCompare(b.date)), [daily]);

  // Só entra painel de métrica que a origem mede em pelo menos um dia. Uma
  // conta de formulário não tem conversão; um painel vazio só faria ruído.
  const available = useMemo(
    () => METRICS.filter(m => rows.some(d => safe(d, m.needs, () => m.value(d)) !== null)),
    [rows]
  );

  if (rows.length === 0) {
    return (
      <div className="card" style={{ padding: '18px', textAlign: 'center', color: 'var(--muted)', fontSize: '12.5px' }}>
        Esta campanha não tem série diária no período selecionado.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', fontWeight: 700 }}>
          Evolução diária · {available.length} métricas
        </h3>
        <button type="button" className="btn btn-sm" onClick={() => setShowTable(v => !v)}>
          {showTable ? 'Ver gráficos' : 'Ver tabela'}
        </button>
      </div>

      {showTable ? (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--muted)', position: 'sticky', left: 0, background: 'var(--surface)' }}>Dia</th>
                {available.map(m => (
                  <th key={m.key} style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(d => (
                <tr key={d.date} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 10px', position: 'sticky', left: 0, background: 'var(--surface)' }}>{shortDate(d.date)}</td>
                  {available.map(m => {
                    const v = safe(d, m.needs, () => m.value(d));
                    return (
                      <td key={m.key} className="tabular-nums" style={{ textAlign: 'right', padding: '6px 10px', whiteSpace: 'nowrap', color: v === null ? 'var(--muted)' : 'var(--ink)' }}>
                        {v === null ? '—' : format(m.kind, v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' }}>
          {available.map(m => (
            <Panel
              key={m.key}
              def={m}
              daily={rows}
              themeKey={theme}
              totalText={metricText(totals, m.total, totals[m.total as keyof NormalizedMetrics] as number, v => format(m.kind, v))}
            />
          ))}
        </div>
      )}

      <p style={{ fontSize: '11px', color: 'var(--muted)' }}>
        O número no canto de cada painel é o total do período. Nas linhas de custo, dia sem lead/clique/conversão fica em branco — não há custo por resultado sem resultado.
      </p>
    </div>
  );
};
