import React, { useEffect, useRef, useState } from 'react';
import { Chart as ChartJS, registerables } from 'chart.js';
import { DailyMetricItem } from '../../types';
import { useTheme } from '../../context/ThemeContext';

ChartJS.register(...registerables);

interface ComboEvolutionChartProps {
  dailyData: DailyMetricItem[];
  currency?: string;
}

export const ComboEvolutionChart: React.FC<ComboEvolutionChartProps> = ({
  dailyData,
  currency = 'BRL'
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<ChartJS | null>(null);
  const { theme } = useTheme();
  const [activeMetric, setActiveMetric] = useState<'leads' | 'sales' | 'cpl' | 'roas'>('leads');

  useEffect(() => {
    if (!canvasRef.current || dailyData.length === 0) return;

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

    const labels = dailyData.map(d => {
      const parts = d.date.split('-');
      return `${parts[2]}/${parts[1]}`;
    });

    const isDark = theme === 'dark';
    const gridColor = isDark ? '#1F293D' : '#F1F5F9';
    const textColor = isDark ? '#94A3B8' : '#64748B';

    let datasets: any[] = [];

    if (activeMetric === 'leads') {
      datasets = [
        {
          type: 'bar' as const,
          label: 'Leads Totais',
          data: dailyData.map(d => d.leads),
          backgroundColor: isDark ? 'rgba(59, 130, 246, 0.65)' : 'rgba(37, 99, 235, 0.75)',
          borderRadius: 4,
          yAxisID: 'y'
        },
        {
          type: 'bar' as const,
          label: 'MQLs (Qualificados)',
          data: dailyData.map(d => d.mqls),
          backgroundColor: isDark ? 'rgba(34, 197, 94, 0.75)' : 'rgba(22, 163, 74, 0.85)',
          borderRadius: 4,
          yAxisID: 'y'
        },
        {
          type: 'line' as const,
          label: 'Investimento (R$)',
          data: dailyData.map(d => d.spend),
          borderColor: '#EF4444',
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.25,
          fill: true,
          yAxisID: 'y1'
        }
      ];
    } else if (activeMetric === 'cpl') {
      datasets = [
        {
          type: 'line' as const,
          label: 'Custo por Lead (CPL)',
          data: dailyData.map(d => d.cpl),
          borderColor: '#2563EB',
          borderWidth: 2.5,
          pointRadius: 3,
          tension: 0.3,
          yAxisID: 'y'
        },
        {
          type: 'line' as const,
          label: 'Custo por MQL (CPMQL)',
          data: dailyData.map(d => d.cpmql),
          borderColor: '#D97706',
          borderWidth: 2.5,
          pointRadius: 3,
          tension: 0.3,
          yAxisID: 'y'
        }
      ];
    } else if (activeMetric === 'sales') {
      datasets = [
        {
          type: 'bar' as const,
          label: 'Vendas (Qtd)',
          data: dailyData.map(d => d.conversions),
          backgroundColor: 'rgba(37, 99, 235, 0.75)',
          borderRadius: 4,
          yAxisID: 'y'
        },
        {
          type: 'line' as const,
          label: 'Faturamento (R$)',
          data: dailyData.map(d => d.revenue),
          borderColor: '#16A34A',
          backgroundColor: 'rgba(22, 163, 74, 0.1)',
          borderWidth: 2.5,
          pointRadius: 3,
          fill: true,
          tension: 0.2,
          yAxisID: 'y1'
        }
      ];
    } else {
      datasets = [
        {
          type: 'line' as const,
          label: 'ROAS (x)',
          data: dailyData.map(d => d.roas),
          borderColor: '#16A34A',
          borderWidth: 3,
          pointRadius: 4,
          pointBackgroundColor: '#16A34A',
          tension: 0.3,
          yAxisID: 'y'
        }
      ];
    }

    chartInstance.current = new ChartJS(ctx, {
      data: {
        labels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              boxWidth: 12,
              boxHeight: 12,
              font: { family: 'Plus Jakarta Sans', size: 11.5 },
              color: textColor
            }
          },
          tooltip: {
            backgroundColor: isDark ? '#111722' : '#FFFFFF',
            titleColor: isDark ? '#F8FAFC' : '#0F172A',
            bodyColor: isDark ? '#94A3B8' : '#475569',
            borderColor: isDark ? '#1F293D' : '#E2E8F0',
            borderWidth: 1,
            padding: 10,
            boxPadding: 4,
            usePointStyle: true,
            callbacks: {
              label: (item: any) => {
                const label = item.dataset.label || '';
                const val = item.raw;
                if (label.includes('(R$)') || label.includes('CPL') || label.includes('CPMQL') || label.includes('Faturamento')) {
                  return ` ${label}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(val)}`;
                }
                if (label.includes('ROAS')) {
                  return ` ${label}: ${Number(val).toFixed(2)}x`;
                }
                return ` ${label}: ${new Intl.NumberFormat('pt-BR').format(val)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 10.5 } }
          },
          y: {
            position: 'left',
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 10.5 } }
          },
          y1: datasets.some(d => d.yAxisID === 'y1')
            ? {
                position: 'right',
                grid: { drawOnChartArea: false },
                ticks: {
                  color: textColor,
                  font: { family: 'Plus Jakarta Sans', size: 10.5 },
                  callback: (val: any) => {
                    return `R$ ${Number(val) >= 1000 ? `${(Number(val) / 1000).toFixed(1)}k` : val}`;
                  }
                }
              }
            : undefined
        }
      }
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [dailyData, activeMetric, theme, currency]);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: 700 }}>Evolução Temporal Diária</h3>
          <p style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
            Cruzamento diário de volume de captação, eficiência de custo e conversões.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '4px', background: 'var(--bg)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <button
            type="button"
            className={`btn btn-sm ${activeMetric === 'leads' ? 'btn-active' : ''}`}
            onClick={() => setActiveMetric('leads')}
            style={{ border: 'none' }}
          >
            Leads & Gasto
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeMetric === 'cpl' ? 'btn-active' : ''}`}
            onClick={() => setActiveMetric('cpl')}
            style={{ border: 'none' }}
          >
            CPL & CPMQL
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeMetric === 'sales' ? 'btn-active' : ''}`}
            onClick={() => setActiveMetric('sales')}
            style={{ border: 'none' }}
          >
            Vendas & Receita
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeMetric === 'roas' ? 'btn-active' : ''}`}
            onClick={() => setActiveMetric('roas')}
            style={{ border: 'none' }}
          >
            ROAS
          </button>
        </div>
      </div>

      <div style={{ height: '280px', position: 'relative' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};
