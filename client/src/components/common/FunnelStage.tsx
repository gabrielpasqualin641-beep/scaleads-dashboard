import React from 'react';
import { NormalizedMetrics } from '../../types';
import { metricText, isUnavailable, NA } from '../../utils/metrics';

interface FunnelStageProps {
  metrics: NormalizedMetrics;
  currency?: string;
}

export const FunnelStage: React.FC<FunnelStageProps> = ({ metrics, currency = 'BRL' }) => {
  const formatMoney = (v: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(v || 0);
  };
  const formatNum = (v: number) => new Intl.NumberFormat('pt-BR').format(v || 0);

  // Uma taxa de conversão só existe se as duas etapas tiverem dado real.
  const rate = (from: 'leads' | 'mqls' | 'appointments', to: 'mqls' | 'appointments' | 'conversions') => {
    if (isUnavailable(metrics, from) || isUnavailable(metrics, to) || metrics[from] <= 0) return NA;
    return `${((metrics[to] / metrics[from]) * 100).toFixed(1)}%`;
  };

  const leadToMqlRate = rate('leads', 'mqls');
  const mqlToAgdRate = rate('mqls', 'appointments');
  const agdToSaleRate = rate('appointments', 'conversions');

  return (
    <div className="funnel-container">
      {/* 1. Investimento */}
      <div className="funnel-step hl-gasto">
        <div>
          <div className="step-label">Investimento Total</div>
          <div className="step-val tabular-nums" style={{ color: 'var(--bad)' }}>
            {metricText(metrics, 'spend', metrics.spend, formatMoney)}
          </div>
        </div>
        <div className="step-metrics">
          <div className="step-submetric">
            <span className="submetric-lbl">CPM</span>
            <span className="submetric-val tabular-nums">{metricText(metrics, 'cpm', metrics.cpm, formatMoney)}</span>
          </div>
          <div className="step-submetric">
            <span className="submetric-lbl">CPC</span>
            <span className="submetric-val tabular-nums">{metricText(metrics, 'cpc', metrics.cpc, formatMoney)}</span>
          </div>
        </div>
      </div>

      {/* 2. Leads */}
      <div className="funnel-step">
        <div>
          <div className="step-label">Leads Cadastrados</div>
          <div className="step-val tabular-nums">{metricText(metrics, 'leads', metrics.leads, formatNum)}</div>
        </div>
        <div className="step-metrics">
          <div className="step-submetric">
            <span className="submetric-lbl">CPL Médio</span>
            <span className="submetric-val tabular-nums">{metricText(metrics, 'cpl', metrics.cpl, formatMoney)}</span>
          </div>
          <div className="step-submetric">
            <span className="submetric-lbl">CTR</span>
            <span className="submetric-val tabular-nums">{metricText(metrics, 'ctr', metrics.ctr, v => v.toFixed(2) + '%')}</span>
          </div>
        </div>
      </div>

      {/* 3. MQLs */}
      <div className="funnel-step hl-mql">
        <div>
          <div className="step-label">MQLs (Qualificados)</div>
          <div className="step-val tabular-nums" style={{ color: 'var(--accent-blue)' }}>
            {metricText(metrics, 'mqls', metrics.mqls, formatNum)}
          </div>
        </div>
        <div className="step-metrics">
          <div className="step-submetric">
            <span className="submetric-lbl">Tx. Qualificação</span>
            <span className="submetric-val tabular-nums" style={{ color: 'var(--good)' }}>{leadToMqlRate}</span>
          </div>
          <div className="step-submetric">
            <span className="submetric-lbl">CPMQL</span>
            <span className="submetric-val tabular-nums">{metricText(metrics, 'cpmql', metrics.cpmql, formatMoney)}</span>
          </div>
        </div>
      </div>

      {/* 4. Agendamentos */}
      <div className="funnel-step">
        <div>
          <div className="step-label">Agendamentos</div>
          <div className="step-val tabular-nums">{metricText(metrics, 'appointments', metrics.appointments, formatNum)}</div>
        </div>
        <div className="step-metrics">
          <div className="step-submetric">
            <span className="submetric-lbl">Tx. Agendamento</span>
            <span className="submetric-val tabular-nums">{mqlToAgdRate}</span>
          </div>
          <div className="step-submetric">
            <span className="submetric-lbl">CPAGD</span>
            <span className="submetric-val tabular-nums">{metricText(metrics, 'cpagd', metrics.cpagd, formatMoney)}</span>
          </div>
        </div>
      </div>

      {/* 5. Vendas & Faturamento */}
      <div className="funnel-step hl-fat">
        <div>
          <div className="step-label">Vendas & Faturamento</div>
          <div className="step-val tabular-nums">
            {metricText(metrics, 'revenue', metrics.revenue, formatMoney)}
          </div>
        </div>
        <div className="step-metrics">
          <div className="step-submetric">
            <span className="submetric-lbl">Vendas (Qtd)</span>
            <span className="submetric-val tabular-nums">{metricText(metrics, 'conversions', metrics.conversions, formatNum)}</span>
          </div>
          <div className="step-submetric">
            <span className="submetric-lbl">CAC (CPA)</span>
            <span className="submetric-val tabular-nums">{metricText(metrics, 'cpa', metrics.cpa, formatMoney)}</span>
          </div>
          <div className="step-submetric">
            <span className="submetric-lbl">ROAS</span>
            <span className="submetric-val tabular-nums" style={{ color: 'var(--good)', fontWeight: 800 }}>
              {metricText(metrics, 'roas', metrics.roas, v => v.toFixed(2) + 'x')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
