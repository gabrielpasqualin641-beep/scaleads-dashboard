import React from 'react';
import { RankedItem } from '../../types';

interface DemographicsChartProps {
  title: string;
  subtitle?: string;
  items: RankedItem[];
  maxCount?: number;
}

export const DemographicsChart: React.FC<DemographicsChartProps> = ({
  title,
  subtitle,
  items,
  maxCount = 5
}) => {
  const displayItems = items.slice(0, maxCount);
  const highestCount = Math.max(...displayItems.map(i => i.count), 1);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div>
        <h4 style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--ink)' }}>{title}</h4>
        {subtitle && <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{subtitle}</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
        {displayItems.map((item, idx) => {
          const barWidth = Math.max(8, Math.round((item.count / highestCount) * 100));
          return (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px' }}>
                <span style={{ color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }} title={item.label}>
                  {item.label}
                </span>
                <span className="tabular-nums" style={{ color: 'var(--muted)', fontWeight: 600 }}>
                  {item.percentage.toFixed(1)}% <span style={{ fontSize: '10px', opacity: 0.8 }}>({item.count})</span>
                </span>
              </div>

              <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${barWidth}%`,
                    height: '100%',
                    backgroundColor: idx === 0 ? 'var(--accent-blue)' : 'var(--muted)',
                    borderRadius: '999px',
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
