/**
 * Formato do snapshot construído a partir de uma planilha do Google Sheets
 * (hoje, a exportação do Adveronix).
 *
 * Cada cliente exporta um conjunto de colunas diferente: uma conta de
 * e-commerce traz "Checkouts Initiated" e "Landing Page Views", uma de
 * geração de leads traz "Leads" e "Reach". Por isso toda métrica além de
 * investimento/impressões/cliques é `number | null`, onde `null` significa
 * "esta planilha não reporta esse dado" e vira N/D no painel — nunca zero.
 */

/** Métricas que dependem de a planilha ter a coluna correspondente. */
export interface SheetsMetricSet {
  spend: number;
  impressions: number;
  clicks: number;
  landingPageViews: number | null;
  /** Ex.: "Checkouts Initiated". */
  conversions: number | null;
  leads: number | null;
  /**
   * Pessoas únicas alcançadas. Não é somável: a mesma pessoa alcançada por
   * dois anúncios (ou em dois dias) apareceria duas vezes. Só é preenchido
   * quando o grupo corresponde a uma única linha da planilha; em qualquer
   * agregação vira `null`.
   */
  reach: number | null;
}

export interface SheetsDailyRow extends SheetsMetricSet {
  date: string; // YYYY-MM-DD
}

export interface SheetsEntityRow extends SheetsMetricSet {
  id: string;
  name: string;
  campaignId?: string;
  adSetId?: string;
}

export interface SheetsAccountSnapshot {
  accountId: string; // externalAccountId da conta no painel
  sourceUrl: string;
  fetchedAt: string;
  range: { since: string; until: string };
  /** Colunas de métrica que esta planilha realmente traz preenchidas. */
  availableMetrics: string[];
  daily: SheetsDailyRow[];
  campaigns: SheetsEntityRow[];
  adSets: SheetsEntityRow[];
  ads: SheetsEntityRow[];
  dailyByEntity: {
    campaigns: Record<string, SheetsDailyRow[]>;
    adSets: Record<string, SheetsDailyRow[]>;
    ads: Record<string, SheetsDailyRow[]>;
  };
}

export interface SheetsSnapshot {
  version: 1;
  generatedAt: string;
  accounts: Record<string, SheetsAccountSnapshot>;
}

export const EMPTY_SHEETS_SNAPSHOT: SheetsSnapshot = {
  version: 1,
  generatedAt: new Date(0).toISOString(),
  accounts: {}
};
