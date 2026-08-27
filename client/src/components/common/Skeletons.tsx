import React from 'react';

export const KpiSkeletonGrid: React.FC = () => {
  return (
    <div className="kpi-grid">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card" style={{ height: '110px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div className="skeleton" style={{ width: '40%', height: '12px' }} />
          <div className="skeleton" style={{ width: '70%', height: '28px' }} />
          <div className="skeleton" style={{ width: '50%', height: '14px' }} />
        </div>
      ))}
    </div>
  );
};

export const ChartSkeleton: React.FC<{ height?: string }> = ({ height = '260px' }) => {
  return (
    <div className="card" style={{ height, display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="skeleton" style={{ width: '25%', height: '14px' }} />
      <div className="skeleton" style={{ width: '100%', flex: 1 }} />
    </div>
  );
};

export const TableSkeleton: React.FC = () => {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div className="skeleton" style={{ width: '30%', height: '16px' }} />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="skeleton" style={{ width: '100%', height: '32px' }} />
      ))}
    </div>
  );
};
