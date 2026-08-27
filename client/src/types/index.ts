export type AccountPlatform = 'meta_ads' | 'google_ads' | 'tiktok_ads' | 'linkedin_ads';
export type AccountStatus = 'active' | 'paused' | 'archived' | 'error' | 'token_expired';
export type EntityStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'IN_PROCESS' | 'WITH_ISSUES' | 'UNKNOWN';

export type DataSource = 'meta_mcp' | 'meta_graph' | 'mock';

export type UserRole = 'admin' | 'editor' | 'viewer';
export type UserStatus = 'active' | 'suspended';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  /** Clientes visíveis. Vazio para admin, que enxerga todos. */
  clientIds: string[];
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface SnapshotFreshness {
  collectedAt: string;
  ageInDays: number;
  coverage: { since: string; until: string } | null;
  periodExceedsCoverage: boolean;
  stale: boolean;
}

export interface ProjectBrief {
  clientId: string;
  description: string;
  offer: string;
  audience: string;
  targetCpl: number | null;
  targetCpa: number | null;
  targetRoas: number | null;
  averageTicket: number | null;
  monthlyBudget: number | null;
  constraints: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ResearchSource {
  title: string;
  url: string;
}

export interface ResearchStudy {
  clientId: string;
  content: string;
  sources: ResearchSource[];
  generatedAt: string;
  generatedBy: string;
  model: string;
  context: {
    periodLabel: string;
    spend: number | null;
    leads: number | null;
    cpl: number | null;
    briefSummary: string;
  };
  usage: { inputTokens: number; outputTokens: number; webSearches: number };
}

export type AnalysisVerdict = 'escalar' | 'otimizar' | 'cortar' | 'observar' | 'sem_dados';

export interface AnalysisSignal {
  metric: MetricName | 'volume';
  label: string;
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
  rationale: string;
  signals: AnalysisSignal[];
  metrics: NormalizedMetrics;
  spendShare: number;
}

export interface AnalysisResponse {
  clientId: string;
  period: { startDate: string; endDate: string; label: string };
  benchmark: {
    cplSource: 'meta_do_briefing' | 'media_da_conta' | 'indisponivel';
    cpl: number | null;
    ctr: number | null;
    frequency: number | null;
  };
  items: AnalysisItem[];
  summary: {
    escalar: number;
    otimizar: number;
    cortar: number;
    observar: number;
    semDados: number;
    spendEmCorte: number;
  };
  limitacoes: string[];
}

export interface AssignableClient {
  id: string;
  name: string;
  companyName: string;
}

export type MetricName =
  | 'spend' | 'impressions' | 'reach' | 'frequency' | 'clicks' | 'ctr' | 'cpc' | 'cpm'
  | 'leads' | 'mqls' | 'cpl' | 'cpmql' | 'appointments' | 'cpagd'
  | 'conversions' | 'cpa' | 'revenue' | 'roas' | 'ticketMedio';

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
  externalAccountId: string;
  name: string;
  platform: AccountPlatform;
  currency: string;
  timezone: string;
  status: AccountStatus;
  lastSyncAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedMetrics {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  leads: number;
  mqls: number;
  cpl: number;
  cpmql: number;
  appointments: number;
  cpagd: number;
  conversions: number;
  cpa: number;
  revenue: number;
  roas: number;
  ticketMedio: number;
  /** Métricas sem dado real na origem — devem ser exibidas como N/D. */
  unavailable: MetricName[];
}

export interface DailyMetricItem {
  date: string;
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
}

export interface DashboardOverviewResponse {
  client: Client;
  accounts: AdAccount[];
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
  dataSourceByAccount: Record<string, DataSource>;
  snapshotFreshness: SnapshotFreshness | null;
}

export type PeriodPreset =
  | 'today'
  | 'yesterday'
  | 'last_7d'
  | 'last_14d'
  | 'last_30d'
  | 'this_month'
  | 'last_month'
  | 'custom';

export type AppPage = 'geral' | 'campanhas' | 'conjuntos' | 'anuncios' | 'clientes' | 'contas' | 'relatorio' | 'usuarios' | 'projeto' | 'analise';
