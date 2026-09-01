/**
 * Formato do snapshot construído a partir de uma planilha do Google Sheets
 * (hoje, a exportação do Adveronix). A planilha reporta impressões, cliques,
 * visualizações de landing page, checkouts iniciados e valor gasto — por dia,
 * por campanha/conjunto/anúncio. Não há leads, MQLs, agendamentos nem receita:
 * campos que a origem não tem ficam de fora do tipo, em vez de sempre `null`.
 */

export interface SheetsDailyRow {
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  landingPageViews: number;
  /** Checkouts Initiated — tratado como o evento de conversão da conta. */
  conversions: number;
}

export interface SheetsEntityRow {
  id: string;
  name: string;
  campaignId?: string;
  adSetId?: string;
  spend: number;
  impressions: number;
  clicks: number;
  landingPageViews: number;
  conversions: number;
}

export interface SheetsAccountSnapshot {
  accountId: string; // externalAccountId da conta no painel
  sourceUrl: string;
  fetchedAt: string;
  range: { since: string; until: string };
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
