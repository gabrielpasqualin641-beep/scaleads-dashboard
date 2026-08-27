import {
  Client,
  AdAccount,
  AuthUser,
  UserRole,
  AssignableClient,
  ProjectBrief,
  AnalysisResponse,
  ResearchStudy,
  DashboardOverviewResponse,
  CampaignData,
  AdSetData,
  AdData,
  PeriodPreset
} from '../types';

const TOKEN_KEY = 'scale_ads_token';

let unauthorizedHandler: (() => void) | null = null;

/** Registra o callback disparado quando o servidor recusa a sessão (401). */
export function onUnauthorized(handler: () => void): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage indisponível (aba privada): a sessão vive só nesta página */
  }
}

/**
 * Wrapper único de fetch: anexa o token, trata 401 derrubando a sessão e
 * normaliza o formato `{ success, data, error }` da API.
 */
async function request<T>(path: string, init: RequestInit = {}, fallbackError = 'Erro na requisição'): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });

  if (res.status === 401) {
    setAuthToken(null);
    unauthorizedHandler?.();
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const json = await res.json().catch(() => null);
  if (!json?.success) {
    throw new Error(json?.error || fallbackError);
  }
  return json.data as T;
}

export interface PeriodParams {
  preset?: PeriodPreset;
  startDate?: string;
  endDate?: string;
  compare?: boolean;
  includeMetaTax?: boolean;
}

function buildQuery(params: Record<string, any>): string {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      query.append(k, String(v));
    }
  }
  const qStr = query.toString();
  return qStr ? `?${qStr}` : '';
}

export const api = {
  // Auth
  async login(email: string, password: string): Promise<{ user: AuthUser; token: string; expiresAt: string }> {
    // Não passa pelo `request`: o 401 aqui é credencial errada, não sessão expirada.
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const json = await res.json().catch(() => null);
    if (!json?.success) throw new Error(json?.error || 'Não foi possível entrar.');
    return json.data;
  },

  async me(): Promise<AuthUser> {
    const data = await request<{ user: AuthUser }>('/api/auth/me', {}, 'Sessão inválida');
    return data.user;
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<AuthUser> {
    const data = await request<{ user: AuthUser }>(
      '/api/auth/change-password',
      { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) },
      'Erro ao trocar a senha'
    );
    return data.user;
  },

  // Usuários (somente administradores)
  listUsers: () => request<AuthUser[]>('/api/users', {}, 'Erro ao carregar usuários'),

  assignableClients: () =>
    request<AssignableClient[]>('/api/users/assignable-clients', {}, 'Erro ao carregar clientes'),

  createUser: (data: { name: string; email: string; role: UserRole; clientIds: string[] }) =>
    request<{ user: AuthUser; temporaryPassword: string | null; notice: string }>(
      '/api/users',
      { method: 'POST', body: JSON.stringify(data) },
      'Erro ao criar usuário'
    ),

  updateUser: (
    id: string,
    updates: { name?: string; role?: UserRole; clientIds?: string[]; status?: 'active' | 'suspended' }
  ) => request<AuthUser>(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(updates) }, 'Erro ao atualizar usuário'),

  resetUserPassword: (id: string) =>
    request<{ temporaryPassword: string; notice: string }>(
      `/api/users/${id}/reset-password`,
      { method: 'POST' },
      'Erro ao redefinir a senha'
    ),

  async deleteUser(id: string): Promise<void> {
    await request<unknown>(`/api/users/${id}`, { method: 'DELETE' }, 'Erro ao excluir usuário');
  },

  // Projeto & Análise
  getBrief: (clientId: string) =>
    request<ProjectBrief | null>(`/api/analysis/brief${buildQuery({ clientId })}`, {}, 'Erro ao carregar o briefing'),

  saveBrief: (clientId: string, brief: Partial<ProjectBrief>) =>
    request<ProjectBrief>(
      `/api/analysis/brief${buildQuery({ clientId })}`,
      { method: 'PUT', body: JSON.stringify(brief) },
      'Erro ao salvar o briefing'
    ),

  getAnalysis: (clientId: string, accountId: string = 'all', period: PeriodParams = {}) =>
    request<AnalysisResponse>(
      `/api/analysis${buildQuery({ clientId, accountId, ...period })}`,
      {},
      'Erro ao gerar a análise'
    ),

  getResearch: (clientId: string) =>
    request<{ configured: boolean; study: ResearchStudy | null }>(
      `/api/analysis/research${buildQuery({ clientId })}`,
      {},
      'Erro ao carregar o estudo'
    ),

  generateResearch: (clientId: string, accountId: string = 'all', period: PeriodParams = {}) =>
    request<ResearchStudy>(
      `/api/analysis/research${buildQuery({ clientId, accountId, ...period })}`,
      { method: 'POST' },
      'Erro ao gerar o estudo'
    ),

  // Clients
  getClients: () => request<Client[]>('/api/clients', {}, 'Erro ao carregar clientes'),

  getClientById: (id: string) => request<Client>(`/api/clients/${id}`, {}, 'Erro ao carregar cliente'),

  createClient: (client: Partial<Client>) =>
    request<Client>('/api/clients', { method: 'POST', body: JSON.stringify(client) }, 'Erro ao criar cliente'),

  updateClient: (id: string, updates: Partial<Client>) =>
    request<Client>(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(updates) }, 'Erro ao atualizar cliente'),

  async deleteClient(id: string): Promise<void> {
    await request<unknown>(`/api/clients/${id}`, { method: 'DELETE' }, 'Erro ao excluir cliente');
  },

  // Accounts
  getClientAccounts: (clientId: string) =>
    request<AdAccount[]>(`/api/clients/${clientId}/accounts`, {}, 'Erro ao carregar contas'),

  createAccount: (data: {
    clientId: string;
    externalAccountId: string;
    name: string;
    platform?: string;
    currency?: string;
    timezone?: string;
    accessToken?: string;
  }) => request<AdAccount>('/api/accounts', { method: 'POST', body: JSON.stringify(data) }, 'Erro ao criar conta'),

  // Dashboard
  getDashboardOverview: (clientId: string, accountId: string = 'all', period: PeriodParams = {}) =>
    request<DashboardOverviewResponse>(
      `/api/dashboard/overview${buildQuery({ clientId, accountId, ...period })}`,
      {},
      'Erro ao carregar dashboard'
    ),

  getCampaigns: (clientId: string, accountId: string = 'all', period: PeriodParams = {}) =>
    request<CampaignData[]>(
      `/api/dashboard/campaigns${buildQuery({ clientId, accountId, ...period })}`,
      {},
      'Erro ao carregar campanhas'
    ),

  getAdSets: (clientId: string, accountId: string = 'all', campaignId?: string, period: PeriodParams = {}) =>
    request<AdSetData[]>(
      `/api/dashboard/adsets${buildQuery({ clientId, accountId, campaignId, ...period })}`,
      {},
      'Erro ao carregar conjuntos'
    ),

  getAds: (clientId: string, accountId: string = 'all', adSetId?: string, period: PeriodParams = {}) =>
    request<AdData[]>(
      `/api/dashboard/ads${buildQuery({ clientId, accountId, adSetId, ...period })}`,
      {},
      'Erro ao carregar anúncios'
    ),

  syncAccount: (accountId: string) =>
    request<{ success: boolean; lastSyncAt: string }>(
      '/api/dashboard/sync',
      { method: 'POST', body: JSON.stringify({ accountId }) },
      'Erro ao sincronizar'
    )
};
