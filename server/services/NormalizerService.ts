import { NormalizedMetrics, MetricName } from '../models/types.js';

export const META_TAX_FACTOR = 1.13806; // 13.806% de impostos sobre veiculação no Brasil

/**
 * Entrada bruta do normalizador. `null` significa "a origem não forneceu esse dado"
 * e é propagado como N/D — nunca substituído por estimativa.
 */
export interface RawMetricInput {
  spend: number | null;
  impressions: number | null;
  reach?: number | null;
  frequency?: number | null;
  clicks: number | null;
  leads?: number | null;
  mqls?: number | null;
  appointments?: number | null;
  conversions?: number | null;
  revenue?: number | null;
}

export class NormalizerService {
  /**
   * Calcula métricas normalizadas a partir dos números absolutos
   * com proteção completa contra divisão por zero e arredondamentos limpos.
   * Toda métrica sem base real é reportada em `unavailable` em vez de estimada.
   */
  public static calculateMetrics(raw: RawMetricInput, applyTax: boolean = true): NormalizedMetrics {
    const unavailable: MetricName[] = [];
    const na = (name: MetricName) => {
      if (!unavailable.includes(name)) unavailable.push(name);
      return 0;
    };

    const has = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

    const rawSpend = has(raw.spend) ? raw.spend : null;
    const spend = rawSpend === null ? na('spend') : (applyTax ? rawSpend * META_TAX_FACTOR : rawSpend);
    const impressions = has(raw.impressions) ? raw.impressions : na('impressions');
    const reach = has(raw.reach) ? raw.reach : na('reach');
    const clicks = has(raw.clicks) ? raw.clicks : na('clicks');
    const leads = has(raw.leads) ? raw.leads : na('leads');
    const mqls = has(raw.mqls) ? raw.mqls : na('mqls');
    const appointments = has(raw.appointments) ? raw.appointments : na('appointments');
    const conversions = has(raw.conversions) ? raw.conversions : na('conversions');
    const revenue = has(raw.revenue) ? raw.revenue : na('revenue');

    const hasSpend = rawSpend !== null;
    const hasImpr = has(raw.impressions);
    const hasReach = has(raw.reach);
    const hasClicks = has(raw.clicks);

    // Uma razão só existe se ambos os operandos forem reais e o denominador for > 0.
    const ratio = (num: number, den: number, ok: boolean, name: MetricName, digits = 2) =>
      ok && den > 0 ? Number((num / den).toFixed(digits)) : na(name);

    const frequency = has(raw.frequency)
      ? Number(raw.frequency.toFixed(2))
      : ratio(impressions, reach, hasImpr && hasReach, 'frequency');
    const ctr = hasImpr && impressions > 0 && hasClicks
      ? Number(((clicks / impressions) * 100).toFixed(2))
      : na('ctr');
    const cpc = ratio(spend, clicks, hasSpend && hasClicks, 'cpc');
    const cpm = hasSpend && hasImpr && impressions > 0
      ? Number(((spend / impressions) * 1000).toFixed(2))
      : na('cpm');
    const cpl = ratio(spend, leads, hasSpend && has(raw.leads), 'cpl');
    const cpmql = ratio(spend, mqls, hasSpend && has(raw.mqls), 'cpmql');
    const cpagd = ratio(spend, appointments, hasSpend && has(raw.appointments), 'cpagd');
    const cpa = ratio(spend, conversions, hasSpend && has(raw.conversions), 'cpa');
    const roas = ratio(revenue, spend, hasSpend && has(raw.revenue), 'roas');
    const ticketMedio = ratio(revenue, conversions, has(raw.revenue) && has(raw.conversions), 'ticketMedio');

    return {
      spend: Number(spend.toFixed(2)),
      impressions,
      reach,
      frequency,
      clicks,
      ctr,
      cpc,
      cpm,
      leads,
      mqls,
      cpl,
      cpmql,
      appointments,
      cpagd,
      conversions,
      cpa,
      revenue: Number(revenue.toFixed(2)),
      roas,
      ticketMedio: Number(ticketMedio.toFixed(2)),
      unavailable
    };
  }

  /**
   * Calcula a variação percentual entre o valor atual e o anterior
   * Fórmula: ((atual - anterior) / anterior) * 100
   * Retorna null quando o valor anterior for 0 ou indefinido.
   */
  public static calculateDeltaPercentage(current: number, previous?: number | null): number | null {
    if (previous === undefined || previous === null || previous === 0) {
      if (current > 0) return 100;
      if (current === 0) return 0;
      return null;
    }
    const diff = current - previous;
    return Number(((diff / previous) * 100).toFixed(1));
  }

  /**
   * Formata valores monetários respeitando a moeda e locale
   */
  public static formatCurrency(value: number, currency: string = 'BRL'): string {
    const locale = currency === 'BRL' ? 'pt-BR' : currency === 'EUR' ? 'pt-PT' : 'en-US';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency
    }).format(value || 0);
  }

  /**
   * Formata números com separadores de milhar
   */
  public static formatNumber(value: number): string {
    return new Intl.NumberFormat('pt-BR').format(value || 0);
  }

  /**
   * Formata percentuais com sufixo %
   */
  public static formatPercent(value: number): string {
    return `${(value || 0).toFixed(1)}%`;
  }
}
