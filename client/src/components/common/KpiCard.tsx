import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus, Info } from 'lucide-react';

export type KpiStatus = 'good' | 'warn' | 'bad';

interface KpiCardProps {
  title: string;
  value: string;
  delta?: number | null;
  deltaType?: 'positive_is_good' | 'negative_is_good';
  hero?: boolean;
  hint?: string;
  subValue?: string;
  /**
   * Situação em relação à meta do cliente. Ausente = sem meta cadastrada, e o
   * card fica neutro — não colorido de verde, que afirmaria uma aprovação que
   * ninguém deu.
   */
  status?: KpiStatus | null;
  /** Texto da meta, ex.: "meta R$ 100". Mostrado junto do sinal de cor. */
  targetLabel?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  delta,
  deltaType = 'positive_is_good',
  hero = false,
  hint,
  subValue,
  status = null,
  targetLabel
}) => {
  const isUp = delta !== undefined && delta !== null && delta > 0;
  const isDown = delta !== undefined && delta !== null && delta < 0;
  const isNeutral = delta === 0 || delta === null || delta === undefined;

  let isGood = false;
  if (deltaType === 'positive_is_good') {
    isGood = isUp;
  } else {
    // Para métricas de custo (CPL, CAC, CPC), queda é bom!
    isGood = isDown;
  }

  const badgeClass = isNeutral
    ? 'neutral'
    : isGood
    ? 'up'
    : 'down';

  return (
    <div className={`kpi-card ${hero ? 'hero' : ''} ${status ? `status-${status}` : ''}`}>
      <div className="kpi-header">
        <span className="kpi-label">{title}</span>
        {hint && (
          <span title={hint} style={{ cursor: 'help', color: 'var(--muted)', display: 'inline-flex' }}>
            <Info size={13} />
          </span>
        )}
      </div>

      <div className="kpi-val tabular-nums">{value}</div>

      <div className="kpi-comparison">
        {delta !== undefined && delta !== null ? (
          <span className={`delta-badge ${badgeClass} tabular-nums`}>
            {isUp && <ArrowUpRight size={12} />}
            {isDown && <ArrowDownRight size={12} />}
            {isNeutral && <Minus size={12} />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        ) : (
          <span className="delta-badge neutral">N/D</span>
        )}
        {status && targetLabel ? (
          <span className={`kpi-target status-${status}`}>{targetLabel}</span>
        ) : (
          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
            {subValue || 'vs. anterior'}
          </span>
        )}
      </div>
    </div>
  );
};
