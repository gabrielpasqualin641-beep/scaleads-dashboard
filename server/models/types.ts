export type AccountPlatform = 'meta_ads' | 'google_ads' | 'tiktok_ads' | 'linkedin_ads';
export type AccountStatus = 'active' | 'paused' | 'archived' | 'error' | 'token_expired';
export type EntityStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'IN_PROCESS' | 'WITH_ISSUES' | 'UNKNOWN';

/** Origem efetiva dos números exibidos. `mock` obriga o aviso de demonstração na interface. */
export type DataSource = 'meta_mcp' | 'meta_graph' | 'sheets' | 'mock';

export type MetricName =
  | 'spend' | 'impressions' | 'reach' | 'frequency' | 'clicks' | 'ctr' | 'cpc' | 'cpm'
  | 'leads' | 'mqls' | 'cpl' | 'cpmql' | 'appointments' | 'cpagd'
  | 'conversions' | 'cpa' | 'revenue' | 'roas' | 'ticketMedio';

/**
 * Camadas de acesso ao painel.
 * - `viewer`: só leitura dos dashboards dos clientes atribuídos.
 * - `editor`: leitura + sincronizar dados e manter clientes/contas.
 * - `admin`: tudo, incluindo gerenciar usuários. Enxerga todos os clientes.
 */
export type UserRole = 'admin' | 'editor' | 'viewer';
export type UserStatus = 'active' | 'suspended';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  /** Clientes que o usuário enxerga. Ignorado para `admin`, que vê todos. */
  clientIds: string[];
  /** Hash scrypt no formato `salt:hash`. Nunca sai da API. */
  passwordHash: string;
  /** Senha provisória definida por um admin: exige troca no primeiro acesso. */
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

/** Projeção segura de `User` — é isso que trafega para o frontend. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  clientIds: string[];
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

/**
 * Descrição do projeto do cliente, preenchida pela agência.
 *
 * Serve para dois fins: dar contexto a quem lê o painel e fornecer as metas
 * que a análise usa como referência. Sem metas, a análise compara contra a
 * média da própria conta.
 */
export interface ProjectBrief {
  clientId: string;
  /** O que o cliente vende, para quem, e qual o diferencial. */
  description: string;
  offer: string;
  audience: string;
  /** Meta de custo por lead, em reais. `null` = usar a média da conta. */
  targetCpl: number | null;
  /** Meta de custo por venda (CAC), em reais. */
  targetCpa: number | null;
  targetRoas: number | null;
  /** Meta de custo por lead qualificado, em reais. */
  targetCpmql: number | null;
  /** Meta de CPM, em reais. Varia muito por público: aberto custa menos que nichado. */
  targetCpm: number | null;
  /** Ticket médio informado pela agência — a Meta não reporta isso. */
  averageTicket: number | null;
  monthlyBudget: number | null;
  /** Restrições e observações que afetam a estratégia. */
  constraints: string;
  updatedAt: string;
  updatedBy: string;
}

/** Classificação de uma entidade pela análise de performance. */
export type AnalysisVerdict = 'escalar' | 'otimizar' | 'cortar' | 'observar' | 'sem_dados';

export interface AnalysisSignal {
  /** Métrica que disparou o sinal. */
  metric: MetricName | 'volume';
  label: string;
  /** Valor observado e a referência usada, para o usuário conferir a conta. */
  value: number | null;
  reference: number | null;
  direction: 'good' | 'bad' | 'neutral';
}

export interface AnalysisItem {
  level: 'campaign' | 'adset' | 'ad';
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  status: EntityStatus;
  verdict: AnalysisVerdict;
  /** Frase curta explicando o veredito, montada a partir dos sinais. */
  rationale: string;
  signals: AnalysisSignal[];
  metrics: NormalizedMetrics;
  /** Parcela do investimento do período que passou por esta entidade. */
  spendShare: number;
  /** Onde o CPL se quebra. `null` quando falta métrica para decompor. */
  diagnosis: CplBreakdown | null;
  /** O que os dados desta entidade sustentam, e o que fica fora do alcance. */
  evidence: { supports: string[]; limits: string[] };
  /** O que fazer, em ordem de impacto. Vazio quando não há ação defensável. */
  actions: AnalysisAction[];
}

export interface AnalysisBenchmark {
  /** De onde veio a referência de CPL: meta do briefing ou média da conta. */
  cplSource: 'meta_do_briefing' | 'media_da_conta' | 'indisponivel';
  cpl: number | null;
  ctr: number | null;
  frequency: number | null;
  /** Referência de CPM: meta do briefing, ou a média ponderada da conta. */
  cpm: number | null;
  cpmSource: 'meta_do_briefing' | 'media_da_conta' | 'indisponivel';
  /** Média da conta para a conversão de clique em lead, em %. */
  clickToLead: number | null;
}

/**
 * Decomposição do CPL nas três alavancas que o formam.
 *
 * CPL = CPM ÷ (1000 × CTR × conversão do clique). A identidade é aritmética,
 * não estimativa: serve para apontar qual perna está quebrada em vez de dizer
 * apenas "o CPL está alto". Quem lê "melhore o CPL" não sabe onde mexer; quem
 * lê "o CPM está 67% acima da meta e sozinho responde por 40% do custo" sabe.
 */
export interface CplBreakdown {
  cpl: number;
  cpm: number | null;
  ctr: number | null;
  /** Cliques que viraram lead, em %. */
  clickToLead: number | null;
  /** A perna com maior ganho potencial se voltar à referência. */
  bottleneck: 'cpm' | 'ctr' | 'conversao' | null;
  /** CPL que resultaria se só o gargalo voltasse à referência. */
  cplSeCorrigido: number | null;
  /** Redução percentual correspondente. */
  ganhoPercentual: number | null;
}

/** Uma recomendação concreta, com o número que a justifica. */
export interface AnalysisAction {
  title: string;
  /** Por que agir, citando o dado observado. */
  why: string;
  /** O que fazer, na ordem. */
  steps: string[];
  /** Efeito esperado no CPL, quando dá para calcular. */
  expectedImpact?: string;
}

export interface AnalysisResponse {
  clientId: string;
  period: { startDate: string; endDate: string; label: string };
  benchmark: AnalysisBenchmark;
  items: AnalysisItem[];
  summary: {
    escalar: number;
    otimizar: number;
    cortar: number;
    observar: number;
    semDados: number;
    /** Investimento no período que está em entidades marcadas para corte. */
    spendEmCorte: number;
  };
  /** Métricas que a Meta não reporta e que limitam a análise. */
  limitacoes: string[];
}

export interface Client {
  id: string;
  organizationId: string;
  name: string;
  companyName: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface AdAccount {
  id: string;
  clientId: string;
  externalAccountId: string; // e.g. act_123456789
  name: string;
  platform: AccountPlatform;
  currency: string; // 'BRL', 'USD', 'EUR', etc.
  timezone: string; // e.g. 'America/Sao_Paulo'
  status: AccountStatus;
  accessTokenRef?: string;
  tokenExpiresAt?: string;
  lastSyncAt: string;
  createdAt: string;
  updatedAt: string;
  businessId?: string;
  businessName?: string;
  /** Preenchido a partir do catálogo real do MCP Meta Ads. */
  mcpEnabled?: boolean;
  mcpQueryable?: boolean;
  mcpUnavailableReason?: string;
  /**
   * Link da planilha do Google Sheets (Adveronix ou similar) que alimenta esta
   * conta. Quando presente, a origem `sheets` tem precedência sobre o MCP —
   * é uma escolha explícita de qual coleta é a fonte de verdade para a conta.
   */
  sheetsUrl?: string;
  /**
   * Campanhas que não entram nos totais da conta, casadas por trecho do nome.
   *
   * Existe porque campanhas com objetivos diferentes não somam: uma de
   * WhatsApp entrega conversas, uma de formulário entrega leads. Jogar o gasto
   * das duas contra os leads de uma só infla todo custo por resultado — o CPL
   * e o CPMQL passam a cobrar por algo que aquela verba não comprou.
   *
   * O gasto excluído não some: aparece à parte, para ninguém achar que a conta
   * investiu menos do que investiu.
   */
  excludedCampaigns?: string[];
}

export interface NormalizedMetrics {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  ctr: number; // in percentage
  cpc: number;
  cpm: number;
  leads: number;
  mqls: number;
  cpl: number;
  cpmql: number;
  appointments: number;
  cpagd: number;
  conversions: number; // Vendas / Compras
  cpa: number; // CAC
  revenue: number; // Receita / Faturamento
  roas: number;
  ticketMedio: number;
  /**
   * Métricas sem dado real na origem. O valor numérico correspondente é 0 apenas
   * como placeholder — a interface deve renderizar "N/D" para tudo que estiver aqui.
   */
  unavailable: MetricName[];
}

export interface CampaignData {
  id: string;
  adAccountId: string;
  externalCampaignId: string;
  name: string;
  status: EntityStatus;
  objective?: string;
  metrics: NormalizedMetrics;
  dailyMetrics?: DailyMetricItem[];
}

export interface AdSetData {
  id: string;
  adAccountId: string;
  campaignId: string;
  campaignName: string;
  externalAdSetId: string;
  name: string;
  status: EntityStatus;
  metrics: NormalizedMetrics;
  dailyMetrics?: DailyMetricItem[];
}

export interface AdData {
  id: string;
  adAccountId: string;
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  externalAdId: string;
  name: string;
  status: EntityStatus;
  previewUrl?: string;
  permalinkUrl?: string;
  format?: 'image' | 'video' | 'carousel';
  metrics: NormalizedMetrics;
  dailyMetrics?: DailyMetricItem[];
  /**
   * Dias do período cobertos pelo export manual de leads, de onde sai o MQL do
   * criativo. Fora dessa janela o MQL dele não é conhecido; `null` quando
   * nenhum export cobre o criativo.
   */
  mqlCoverage?: { since: string; until: string } | null;
}

export interface DailyMetricItem {
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  mqls: number;
  appointments: number;
  conversions: number;
  revenue: number;
  cpl: number;
  cpmql: number;
  cpagd: number;
  cpa: number;
  roas: number;
  unavailable: MetricName[];
}

export interface RankedItem {
  label: string;
  count: number;
  percentage: number;
}

export interface FunnelSegmentItem {
  id: string;
  name: string;
  spend: number;
  leads: number;
  mqls: number;
  appointments: number;
  conversions: number;
  revenue: number;
  cpl: number;
  cpmql: number;
  roas: number;
}

export interface QualifiedLeadItem {
  id: string;
  date: string;
  name: string;
  emailMasked: string;
  phoneMasked: string;
  campaign: string;
  adSet: string;
  ad: string;
  funnel: string;
  funil?: string;
  score: 'A' | 'B' | 'C' | 'D';
  cityState: string;
  country: string;
  moment: string;
  appointmentBooked: boolean;
}

export interface PeriodSelection {
  preset: string; // 'today' | 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d' | 'this_month' | 'last_month' | 'custom';
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  compare: boolean;
  compareStartDate?: string;
  compareEndDate?: string;
  includeMetaTax?: boolean; // 13.806% tax factor
}

/**
 * Metas de custo do cliente, usadas para colorir os indicadores.
 *
 * Vêm do briefing preenchido pela agência — nunca de benchmark de mercado.
 * Pintar de verde ou vermelho é afirmar "isto está bom" ou "isto está ruim",
 * e só quem conhece a operação do cliente pode traçar essa linha. Meta ausente
 * significa indicador sem cor, e não indicador aprovado.
 */
export interface MetricTargets {
  cpl: number | null;
  cpmql: number | null;
  cpa: number | null;
  cpm: number | null;
  roas: number | null;
}

/** Campanha deixada fora dos totais, com o gasto que ela teve mesmo assim. */
export interface ExcludedCampaign {
  name: string;
  spend: number;
}

export interface DashboardOverviewResponse {
  client: Client;
  accounts: AdAccount[];
  /** Metas para colorir os KPIs. Vazio quando o cliente não definiu nenhuma. */
  targets: MetricTargets;
  /** Campanhas fora do cálculo, para o gasto excluído não sumir sem explicação. */
  excludedCampaigns: ExcludedCampaign[];
  /**
   * Incoerências detectadas entre as origens, em texto para o usuário.
   *
   * Existe porque MQL vem do CRM e leads vêm da planilha: as duas podem
   * divergir, e já divergiram por bug de classificação. Um número impossível
   * não pode aparecer calado — quando aparece, quem lê precisa saber antes de
   * decidir alguma coisa com ele.
   */
  dataWarnings: string[];
  selectedAccountId: string | 'all';
  period: {
    startDate: string;
    endDate: string;
    label: string;
    compareStartDate?: string;
    compareEndDate?: string;
    compareLabel?: string;
    includeMetaTax: boolean;
  };
  currentMetrics: NormalizedMetrics;
  previousMetrics: NormalizedMetrics | null;
  deltas: { [K in keyof NormalizedMetrics]?: number | null };
  funnel: {
    spend: number;
    leads: number;
    mqls: number;
    appointments: number;
    sales: number;
    revenue: number;
    rates: {
      leadToMql: number;
      mqlToAgd: number;
      agdToSale: number;
      overallConv: number;
    };
  };
  dailyTrends: DailyMetricItem[];
  demographics: {
    countries: RankedItem[];
    states: RankedItem[];
    moments: RankedItem[];
    experiences: RankedItem[];
    results: RankedItem[];
    invest: RankedItem[];
    returns: RankedItem[];
  };
  funnelSegments: FunnelSegmentItem[];
  qualifiedLeads: QualifiedLeadItem[];
  lastSyncAt: string;
  dataSource: DataSource;
  /** Origem por conta agregada, para o caso `accountId=all` misturar reais e mock. */
  dataSourceByAccount: Record<string, DataSource>;
  /** Idade do snapshot do MCP, para a interface avisar quando o dado envelhecer. */
  snapshotFreshness: SnapshotFreshness | null;
}

export interface SnapshotFreshness {
  /** Quando a coleta pelo MCP foi feita. */
  collectedAt: string;
  ageInDays: number;
  /** Janela de datas realmente coberta pela coleta. */
  coverage: { since: string; until: string } | null;
  /** Verdadeiro quando o período pedido vai além do que foi coletado. */
  periodExceedsCoverage: boolean;
  stale: boolean;
}
