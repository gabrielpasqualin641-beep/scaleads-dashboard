/**
 * Cliente da API do Kommo (CRM).
 *
 * Só leitura: o painel consulta leads para contar MQL e nunca escreve no CRM.
 * O token vive apenas em `process.env` — não vai ao banco, à resposta da API,
 * ao frontend nem ao log.
 */

const API_VERSION = 'v4';
const PAGE_LIMIT = 250;
const MAX_PAGES = 40;
const TIMEOUT_MS = 30_000;

export interface KommoLead {
  id: number;
  name: string;
  status_id: number;
  pipeline_id: number;
  created_at: number;
  custom_fields_values?: Array<{
    field_id: number;
    field_name?: string;
    values?: Array<{ value?: unknown }>;
  }> | null;
}

export interface KommoCustomField {
  id: number;
  name: string;
  type: string;
}

export class KommoError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'KommoError';
  }
}

/** Remove qualquer token de um texto antes de ele virar log ou mensagem de erro. */
export function redact(text: string): string {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '[REDACTED]');
}

export function subdomain(): string | null {
  return process.env.KOMMO_SUBDOMAIN?.trim() || null;
}

export function accessToken(): string | null {
  return process.env.KOMMO_ACCESS_TOKEN?.trim() || null;
}

export function isConfigured(): boolean {
  return !!subdomain() && !!accessToken();
}

async function request<T>(path: string): Promise<T | null> {
  const sub = subdomain();
  const token = accessToken();
  if (!sub || !token) throw new KommoError('Kommo não configurado (KOMMO_SUBDOMAIN / KOMMO_ACCESS_TOKEN).');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://${sub}.kommo.com/api/${API_VERSION}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal
    });

    // 204 é a resposta do Kommo para coleção vazia — não é erro.
    if (res.status === 204) return null;
    if (res.status === 401) throw new KommoError('Token do Kommo inválido ou revogado.', 401);
    if (res.status === 403) throw new KommoError('Token do Kommo sem permissão para ler leads.', 403);
    if (res.status === 429) throw new KommoError('Kommo recusou por excesso de requisições.', 429);
    if (!res.ok) throw new KommoError(`Kommo respondeu ${res.status}.`, res.status);

    const text = await res.text();
    return text.trim() ? (JSON.parse(text) as T) : null;
  } catch (err) {
    if (err instanceof KommoError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new KommoError('Kommo não respondeu dentro do tempo limite.');
    }
    throw new KommoError(redact(err instanceof Error ? err.message : String(err)));
  } finally {
    clearTimeout(timer);
  }
}

/** Campos personalizados de lead, usado para localizar o de faturamento pelo nome. */
export async function listLeadFields(): Promise<KommoCustomField[]> {
  const data = await request<any>('/leads/custom_fields?limit=250');
  return data?._embedded?.custom_fields ?? [];
}

/**
 * Todos os leads criados no intervalo, seguindo a paginação até o fim.
 *
 * `since`/`until` são datas locais (YYYY-MM-DD); o filtro do Kommo trabalha em
 * epoch, e `until` inclui o dia inteiro.
 */
export async function fetchLeads(since: string, until: string): Promise<KommoLead[]> {
  const from = Math.floor(new Date(`${since}T00:00:00`).getTime() / 1000);
  const to = Math.floor(new Date(`${until}T23:59:59`).getTime() / 1000);

  const leads: KommoLead[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const path = `/leads?limit=${PAGE_LIMIT}&page=${page}` +
      `&filter[created_at][from]=${from}&filter[created_at][to]=${to}`;
    const data = await request<any>(path);
    const batch: KommoLead[] = data?._embedded?.leads ?? [];
    leads.push(...batch);
    if (!data?._links?.next || batch.length === 0) break;
  }
  return leads;
}
