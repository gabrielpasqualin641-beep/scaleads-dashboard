import React from 'react';
import { CheckCircle, PauseCircle, HelpCircle } from 'lucide-react';

/**
 * Status de veiculação, com três estados.
 *
 * Existia uma cópia desta lógica em cada tela, e as cópias divergiram: a de
 * campanhas mostrava "Pausado" para status desconhecido, e a de conjuntos
 * escrevia "Ativo" fixo, ignorando o valor — todo conjunto aparecia ativo,
 * inclusive os que a Meta havia parado.
 *
 * Os dois erros afirmavam algo sobre a veiculação que ninguém tinha verificado.
 * Nem toda origem informa status: a planilha do Adveronix não exporta esse
 * campo, e a entidade chega como 'UNKNOWN'. Isso é N/D, não "pausado" nem
 * "ativo".
 */

export type EntityStatus = string | null | undefined;

const PAUSED = new Set(['PAUSED', 'ARCHIVED', 'DELETED', 'DISABLED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED']);

interface StatusBadgeProps {
  status: EntityStatus;
  size?: number;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 12 }) => {
  const value = (status || '').toUpperCase();
  const ativo = value === 'ACTIVE';
  const pausado = PAUSED.has(value);

  const label = ativo ? 'Ativo' : pausado ? 'Pausado' : 'N/D';
  const hint = ativo || pausado
    ? undefined
    : 'Esta origem de dados não informa o status de veiculação. Confira no Gerenciador de Anúncios.';

  return (
    <span
      title={hint}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: size >= 13 ? '11.5px' : '11px',
        fontWeight: 700,
        color: ativo ? 'var(--good)' : 'var(--muted)',
        cursor: hint ? 'help' : undefined
      }}
    >
      {ativo ? <CheckCircle size={size} /> : pausado ? <PauseCircle size={size} /> : <HelpCircle size={size} />}
      {label}
    </span>
  );
};
