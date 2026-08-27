import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  message = 'Não foi possível carregar os dados desta visualização.',
  onRetry
}) => {
  return (
    <div
      className="card"
      style={{
        padding: '36px 24px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        backgroundColor: 'var(--bad-bg)',
        borderColor: 'var(--bad)'
      }}
    >
      <div
        style={{
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          backgroundColor: 'rgba(220, 38, 38, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--bad)'
        }}
      >
        <AlertTriangle size={22} />
      </div>

      <div style={{ maxWidth: '420px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--bad)', marginBottom: '4px' }}>
          Erro ao processar dados
        </h3>
        <p style={{ fontSize: '12.5px', color: 'var(--ink)' }}>{message}</p>
      </div>

      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry} style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
          <RefreshCw size={12} /> Tentar Novamente
        </button>
      )}
    </div>
  );
};
