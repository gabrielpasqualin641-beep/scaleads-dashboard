/**
 * Converte os valores que o MCP Meta Ads devolve para números.
 *
 * O MCP mistura dois formatos: valores monetários e percentuais vêm formatados em
 * pt-BR ("R$1.465,32 BRL", "5,32%") enquanto floats crus vêm com ponto decimal
 * ("1.309707"). Tratar os dois com a mesma regra corrompe a escala em 1000x.
 */

const NOT_AVAILABLE = 'not available';

/** "R$1.465,32 BRL" | "5,32%" | "1.309707" | "46317" | null -> number | null */
export function parseMcpNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const raw = value.replace(/ /g, ' ').trim();
  if (!raw || raw.toLowerCase().includes(NOT_AVAILABLE)) return null;

  const isLocalized = /[R$€%]|\bBRL\b|\bUSD\b|\bEUR\b/.test(raw);
  const digits = raw.replace(/[^0-9.,-]/g, '');
  if (!digits) return null;

  const normalized = isLocalized
    ? digits.replace(/\./g, '').replace(',', '.')
    : digits.replace(/,/g, '');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * O campo `results` chega como objeto: ou com `values[].value`, ou com
 * `value: "Not available"` quando o objetivo não produz resultado contável.
 */
export function parseMcpResults(value: unknown): { value: number | null; indicator: string | null } {
  if (!value || typeof value !== 'object') {
    return { value: parseMcpNumber(value), indicator: null };
  }

  const obj = value as { indicator?: string; value?: unknown; values?: Array<{ value?: unknown }> };
  const indicator = typeof obj.indicator === 'string' ? obj.indicator : null;

  if (Array.isArray(obj.values) && obj.values.length > 0) {
    return { value: parseMcpNumber(obj.values[0]?.value), indicator };
  }
  return { value: parseMcpNumber(obj.value), indicator };
}

/** `ads_get_ad_entities` devolve `ad_entities` como string JSON ou array já decodificado. */
export function parseMcpEntities(adEntities: unknown): Record<string, unknown>[] {
  if (Array.isArray(adEntities)) return adEntities as Record<string, unknown>[];
  if (typeof adEntities === 'string') {
    try {
      const parsed = JSON.parse(adEntities);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
