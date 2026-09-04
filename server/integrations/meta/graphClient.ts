import { META_API_VERSION, META_GRAPH_URL, MAX_PAGES } from './config.js';

/**
 * Cliente da Meta Graph API.
 *
 * Duas responsabilidades que antes faltavam no provider: seguir a paginação até
 * o fim, e traduzir erro da Meta em mensagem acionável sem jamais expor o
 * token.
 */

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code: number | null,
    public readonly subcode: number | null,
    public readonly kind: MetaErrorKind
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

export type MetaErrorKind =
  | 'token_invalido'
  | 'token_expirado'
  | 'permissao_insuficiente'
  | 'conta_inexistente'
  | 'rate_limit'
  | 'timeout'
  | 'resposta_inesperada'
  | 'erro_api';

/** Normaliza o id para `act_<id>`, sem duplicar o prefixo. */
export function toActId(externalAccountId: string): string {
  const clean = externalAccountId.trim();
  return clean.startsWith('act_') ? clean : `act_${clean}`;
}

/**
 * Remove o token de qualquer texto antes de logar ou propagar.
 * Nenhuma mensagem de erro pode carregar credencial.
 */
export function redact(text: string): string {
  return text
    .replace(/access_token=[^&\s"]+/gi, 'access_token=[REDACTED]')
    .replace(/EAA[A-Za-z0-9]{20,}/g, '[REDACTED]');
}

function classify(code: number | null, subcode: number | null, message: string): MetaErrorKind {
  if (code === 190) {
    // 463 e 467 são as subcategorias de token vencido/invalidado.
    return subcode === 463 || subcode === 467 ? 'token_expirado' : 'token_invalido';
  }
  if (code === 200 || code === 10 || code === 299) return 'permissao_insuficiente';
  if (code === 803 || /does not exist|Unsupported get request/i.test(message)) return 'conta_inexistente';
  if (code === 4 || code === 17 || code === 32 || code === 613) return 'rate_limit';
  return 'erro_api';
}

function friendly(kind: MetaErrorKind, raw: string): string {
  switch (kind) {
    case 'token_invalido':
      return 'O token da Meta foi recusado. Gere um novo no Business Manager e atualize a variável de ambiente.';
    case 'token_expirado':
      return 'O token da Meta expirou. Gere um novo token de longa duração e atualize a variável de ambiente.';
    case 'permissao_insuficiente':
      return 'O token não tem permissão para esta conta. Confirme ads_read e o acesso do usuário do sistema à conta.';
    case 'conta_inexistente':
      return 'Conta de anúncio inexistente ou fora do alcance deste token.';
    case 'rate_limit':
      return 'Limite de chamadas da Meta atingido. A sincronização tentará novamente mais tarde.';
    case 'timeout':
      return 'A Meta não respondeu a tempo.';
    default:
      return `A Meta recusou a requisição: ${raw}`;
  }
}

interface GraphResponse<T> {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

const TIMEOUT_MS = 60_000;

async function requestJson<T>(url: string, accessToken: string): Promise<GraphResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // O token vai no header, não na query — evita que apareça em log de proxy.
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    let json: GraphResponse<T>;
    try {
      json = (await res.json()) as GraphResponse<T>;
    } catch {
      throw new MetaApiError(
        `Resposta ilegível da Meta (status ${res.status}).`,
        null,
        null,
        'resposta_inesperada'
      );
    }

    if (!res.ok || json.error) {
      const raw = redact(json.error?.message || `status ${res.status}`);
      const code = json.error?.code ?? null;
      const subcode = json.error?.error_subcode ?? null;
      const kind = classify(code, subcode, raw);
      throw new MetaApiError(friendly(kind, raw), code, subcode, kind);
    }

    return json;
  } catch (err) {
    if (err instanceof MetaApiError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MetaApiError(friendly('timeout', ''), null, null, 'timeout');
    }
    const message = err instanceof Error ? redact(err.message) : 'falha de rede';
    throw new MetaApiError(`Não foi possível falar com a Meta: ${message}`, null, null, 'erro_api');
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(endpoint: string, params: Record<string, string>): string {
  const url = new URL(`${META_GRAPH_URL}/${META_API_VERSION}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.append(key, value);
  }
  return url.toString();
}

/** Uma página apenas — para endpoints que devolvem objeto, não lista. */
export async function graphGet<T = Record<string, unknown>>(
  endpoint: string,
  accessToken: string,
  params: Record<string, string> = {}
): Promise<T> {
  return (await requestJson<unknown>(buildUrl(endpoint, params), accessToken)) as unknown as T;
}

/**
 * Percorre todas as páginas e devolve a lista completa.
 *
 * A Meta pagina em 25 itens por padrão; sem isso uma conta com 40 campanhas
 * mostrava só as 25 primeiras, e o total do painel ficava menor que o do
 * Ads Manager sem nenhum sinal de erro.
 */
export async function graphGetAll<T = Record<string, unknown>>(
  endpoint: string,
  accessToken: string,
  params: Record<string, string> = {}
): Promise<{ rows: T[]; pages: number }> {
  const rows: T[] = [];
  let url: string | undefined = buildUrl(endpoint, { limit: '100', ...params });
  let pages = 0;

  while (url && pages < MAX_PAGES) {
    const json: GraphResponse<T> = await requestJson<T>(url, accessToken);
    if (Array.isArray(json.data)) rows.push(...json.data);
    pages++;
    url = json.paging?.next;
  }

  if (url && pages >= MAX_PAGES) {
    console.warn(`[Meta] Paginação interrompida em ${MAX_PAGES} páginas para ${endpoint}`);
  }

  return { rows, pages };
}
