import { MetricName, DataSource } from '../types';

export const NA = 'N/D';

interface WithAvailability {
  unavailable: MetricName[];
}

export function isUnavailable(metrics: WithAvailability | undefined, key: MetricName): boolean {
  return !!metrics?.unavailable?.includes(key);
}

/**
 * Formata uma métrica respeitando a ausência de dado real na origem.
 * Métrica sem base real vira N/D em vez de 0 — nunca inventar número.
 */
export function metricText(
  metrics: WithAvailability | undefined,
  key: MetricName,
  value: number,
  format: (v: number) => string
): string {
  return isUnavailable(metrics, key) ? NA : format(value);
}

export function isDemoData(source: DataSource | undefined): boolean {
  return source === 'mock';
}

export const DATA_SOURCE_LABEL: Record<DataSource, string> = {
  sheets: 'Dados reais — Planilha (Adveronix)',
  meta_mcp: 'Dados reais — MCP Meta Ads',
  meta_graph: 'Dados reais — Meta Graph API',
  mock: 'Modo demonstração — dados simulados'
};

/**
 * Remove da tabela as colunas de métrica que estão N/D em todas as linhas.
 *
 * Uma coluna vazia inteira não informa nada por linha — informa uma coisa só,
 * "esta origem não mede isso", e repetir N/D vinte vezes só empurra as colunas
 * úteis para fora da tela. Na conta do Giacobelli isso somava sete colunas de
 * scroll horizontal sem um único número.
 *
 * O que foi escondido volta como texto abaixo da tabela: sumir com a métrica
 * sem dizer nada deixaria o leitor achando que ela não existe, quando o caso é
 * que a origem não reporta.
 */
export function dropEmptyMetricColumns<C extends { id: string }, R>(
  columns: C[],
  rows: R[],
  metricsOf: (row: R) => WithAvailability | undefined
): { columns: C[]; hidden: C[] } {
  // Sem linha nenhuma não há o que concluir: mantém tudo.
  if (rows.length === 0) return { columns, hidden: [] };

  const hidden: C[] = [];
  const kept = columns.filter(col => {
    const vazia = rows.every(row => isUnavailable(metricsOf(row), col.id as MetricName));
    if (vazia) hidden.push(col);
    return !vazia;
  });

  return { columns: kept, hidden };
}
