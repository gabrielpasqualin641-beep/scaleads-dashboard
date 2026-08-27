/**
 * Formato do snapshot produzido pelo MCP Meta Ads.
 *
 * O servidor Express NÃO fala MCP: o servidor Meta Ads MCP é um conector remoto
 * autenticado dentro do cliente Claude, sem transporte nem credencial acessível
 * a partir deste runtime. Quem chama as ferramentas MCP é o cliente (Claude Code),
 * que entrega o resultado real aqui via POST /api/meta-mcp/snapshot.
 *
 * Todos os números já chegam parseados. `null` = a Meta não retornou o dado
 * para aquela entidade/período, e deve virar N/D — nunca uma estimativa.
 */

export interface McpAccountCatalogItem {
  adAccountId: string;
  adAccountName: string;
  businessId: string;
  businessName: string;
  currency: string;
  accountStatus: string;
  isAdsMcpEnabled: boolean;
  isQueryable: boolean;
  notQueryableReason?: string | null;
}

export interface McpDailyRow {
  date: string; // YYYY-MM-DD
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicks: number | null;
  leads: number | null;
  conversions: number | null;
  revenue: number | null;
}

export interface McpEntityRow {
  id: string;
  name: string;
  status: string;
  objective?: string;
  campaignId?: string;
  adSetId?: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicks: number | null;
  leads: number | null;
  conversions: number | null;
  revenue: number | null;
  /** Resultado da otimização da entidade, conforme `results` do MCP. */
  results?: number | null;
  resultIndicator?: string | null;
  /** Criativo do anúncio (apenas no nível `ad`). */
  creativeId?: string | null;
  thumbnailUrl?: string | null;
  creativeFormat?: 'image' | 'video' | 'carousel' | null;
}

/**
 * Imagem do criativo vinda de `ads_get_creatives`.
 *
 * As URLs do CDN da Meta são assinadas e expiram (parâmetro `oe`), então a
 * interface precisa tolerar uma imagem que não carrega mais — uma nova ingestão
 * do snapshot renova os links.
 */
export interface McpCreative {
  id: string;
  thumbnailUrl: string | null;
  objectType: string | null;
  videoId: string | null;
}

export interface McpAccountSnapshot {
  accountId: string;
  name: string;
  currency: string;
  accountStatus: string;
  businessId?: string;
  businessName?: string;
  fetchedAt: string;
  range: { since: string; until: string };
  daily: McpDailyRow[];
  campaigns: McpEntityRow[];
  adSets: McpEntityRow[];
  ads: McpEntityRow[];
  /** Criativos indexados por id, referenciados por `McpEntityRow.creativeId`. */
  creatives: Record<string, McpCreative>;
  /**
   * Série diária real por entidade (`time_increment=1` em cada nível), usada
   * nos gráficos de evolução. Dias sem veiculação simplesmente não aparecem.
   */
  dailyByEntity: {
    campaigns: Record<string, McpDailyRow[]>;
    adSets: Record<string, McpDailyRow[]>;
    ads: Record<string, McpDailyRow[]>;
  };
}

export interface MetaMcpSnapshot {
  version: 1;
  generatedAt: string;
  /** Ferramentas MCP efetivamente usadas para produzir este snapshot. */
  toolsUsed: string[];
  catalog: McpAccountCatalogItem[];
  accounts: Record<string, McpAccountSnapshot>;
}

export const EMPTY_SNAPSHOT: MetaMcpSnapshot = {
  version: 1,
  generatedAt: new Date(0).toISOString(),
  toolsUsed: [],
  catalog: [],
  accounts: {}
};
