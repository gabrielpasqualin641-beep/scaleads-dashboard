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
