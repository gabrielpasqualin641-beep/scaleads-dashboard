import React, { useEffect, useRef } from 'react';
import { Chart as ChartJS, registerables } from 'chart.js';
import { useTheme } from '../../context/ThemeContext';

ChartJS.register(...registerables);

interface HierarchyItem {
  id: string;
  name: string;
  color: string;
  dailyValues: { date: string; value: number }[];
  totalValue: number;
}

interface HierarchyPairChartProps {
  title: string;
  metricLabel: string;
  items: HierarchyItem[];
  selectedId?: string;
  onSelectItem?: (id: string) => void;
  currency?: string;
  isCurrency?: boolean;
}

export const HierarchyPairChart: React.FC<HierarchyPairChartProps> = ({
  title,
  metricLabel,
  items,
  selectedId,
  onSelectItem,
  currency = 'BRL',
  isCurrency = true
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<ChartJS | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!canvasRef.current || items.length === 0) return;

    const existingChart = ChartJS.getChart(canvasRef.current);
    if (existingChart) {
      existingChart.destroy();
    }
    if (chartInstance.current) {
      chartInstance.current.destroy();
      chartInstance.current = null;
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Coleta todas as datas únicas ordenadas
    const allDates = Array.from(
      new Set(items.flatMap(item => item.dailyValues.map(d => d.date)))
    ).sort();

    const labels = allDates.map(d => {
      const parts = d.split('-');
      return `${parts[2]}/${parts[1]}`;
    });

    const isDark = theme === 'dark';
    const gridColor = isDark ? '#1F293D' : '#F1F5F9';
    const textColor = isDark ? '#94A3B8' : '#64748B';

    const datasets = items.map(item => {
      const dateMap = new Map(item.dailyValues.map(d => [d.date, d.value]));
      const data = allDates.map(d => dateMap.get(d) ?? 0);
      const isSelected = selectedId === item.id;
      const isAnySelected = Boolean(selectedId);

      return {
        label: item.name,
        data,
        borderColor: item.color,
        backgroundColor: item.color,
        borderWidth: isSelected ? 3 : isAnySelected ? 1 : 2,
        pointRadius: isSelected ? 4 : isAnySelected ? 1 : 2.5,
        tension: 0.25,
        borderDash: isAnySelected && !isSelected ? [4, 4] : undefined
      };
    });

    chartInstance.current = new ChartJS(ctx, {
      type: 'line',
      data: {
        labels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#111722' : '#FFFFFF',
            titleColor: isDark ? '#F8FAFC' : '#0F172A',
            bodyColor: isDark ? '#94A3B8' : '#475569',
            borderColor: isDark ? '#1F293D' : '#E2E8F0',
            borderWidth: 1,
            padding: 8,
            callbacks: {
              label: (ctx: any) => {
                const val = ctx.raw;
                const formatted = isCurrency
                  ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(val)
                  : new Intl.NumberFormat('pt-BR').format(val);
                return ` ${ctx.dataset.label}: ${formatted}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 10 } }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: 'Plus Jakarta Sans', size: 10 },
              callback: (val: any) => {
                if (isCurrency) {
                  return `R$ ${Number(val).toFixed(0)}`;
                }
                return val;
              }
            }
          }
        }
      }
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [items, selectedId, theme, currency, isCurrency]);

  return (
    <div className="card" style={{ marginTop: '12px', padding: '14px 16px' }}>
      <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', fontWeight: 700, marginBottom: '8px' }}>
        {title} · <span style={{ color: 'var(--accent-blue)' }}>{metricLabel}</span>
      </div>

      <div style={{ height: '160px', position: 'relative' }}>
        <canvas ref={canvasRef} />
      </div>

      {/* Legenda Customizada Interativa */}
      <div
        style={{
          marginTop: '10px',
          paddingTop: '8px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          maxHeight: '110px',
          overflowY: 'auto'
        }}
      >
        {items.map(item => {
          const isSelected = selectedId === item.id;
          return (
            <div
              key={item.id}
              onClick={() => onSelectItem && onSelectItem(isSelected ? '' : item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '3px 8px',
                borderRadius: '6px',
                cursor: 'pointer',
                backgroundColor: isSelected ? 'var(--selected)' : 'transparent',
                fontSize: '11.5px',
                transition: 'background-color 0.1s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: item.color, flexShrink: 0 }} />
                <span style={{ color: 'var(--ink)', fontWeight: isSelected ? 700 : 500 }}>{item.name}</span>
              </div>
              <span className="tabular-nums" style={{ color: 'var(--muted)', fontWeight: 600, flexShrink: 0 }}>
                {isCurrency
                  ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(item.totalValue)
                  : new Intl.NumberFormat('pt-BR').format(item.totalValue)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
