import { AdAccount } from '../../models/types.js';
import { graphGet, MetaApiError, toActId } from './graphClient.js';

/**
 * Credenciais da Meta por conta de anúncio.
 *
 * Reutiliza o mecanismo que o projeto já tinha: `AdAccount.accessTokenRef`
 * guarda o **nome** de uma variável de ambiente, nunca o token. O valor só
 * existe no processo do servidor — não vai ao banco, à API, ao frontend nem
 * ao log.
 *
 * `META_ACCESS_TOKEN` funciona como token padrão da agência, usado quando a
 * conta não define um próprio. É o caso comum: um usuário do sistema com acesso
 * a todas as contas do Business Manager.
 */

const DEFAULT_TOKEN_REF = 'META_ACCESS_TOKEN';

/** Dias antes do vencimento em que passamos a alertar. */
const EXPIRY_WARNING_DAYS = 7;

export interface TokenStatus {
  present: boolean;
  /** Qual variável de ambiente forneceu o token. */
  source: string | null;
  expiresAt: string | null;
  daysToExpiry: number | null;
  expired: boolean;
  expiringSoon: boolean;
}

/** Nunca retorna o token — só de onde ele viria. */
export function tokenRefFor(account: Pick<AdAccount, 'accessTokenRef'>): string {
  return account.accessTokenRef?.trim() || DEFAULT_TOKEN_REF;
}

/**
 * Token da conta, ou `null` se não houver.
 *
 * Só o provider e o job de sincronização chamam isto. O valor jamais sobe para
 * camada de rota ou resposta.
 */
export function getAccessToken(account: Pick<AdAccount, 'accessTokenRef'>): string | null {
  const value = process.env[tokenRefFor(account)];
  return value && value.trim() ? value.trim() : null;
}

export function hasAccessToken(account: Pick<AdAccount, 'accessTokenRef'>): boolean {
  return getAccessToken(account) !== null;
}

/** Situação da credencial, segura para exibir na interface. */
export function tokenStatus(account: Pick<AdAccount, 'accessTokenRef' | 'tokenExpiresAt'>): TokenStatus {
  const ref = tokenRefFor(account);
  const present = hasAccessToken(account);
  const expiresAt = account.tokenExpiresAt || null;

  if (!expiresAt) {
    return { present, source: present ? ref : null, expiresAt: null, daysToExpiry: null, expired: false, expiringSoon: false };
  }

  const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
  return {
    present,
    source: present ? ref : null,
    expiresAt,
    daysToExpiry: Number(days.toFixed(1)),
    expired: days <= 0,
    expiringSoon: days > 0 && days <= EXPIRY_WARNING_DAYS
  };
}

export interface TokenValidation {
  valid: boolean;
  message: string;
  /** Vencimento informado pela Meta, quando ela souber. */
  expiresAt: string | null;
  scopes: string[];
}

/**
 * Valida o token contra a própria Meta e devolve validade e escopos.
 *
 * Usa `/debug_token`, que é o endpoint feito para isso — assim a expiração vem
 * da fonte, em vez de depender do que foi anotado à mão no cadastro.
 */
export async function validateToken(token: string): Promise<TokenValidation> {
  try {
    const res = await graphGet<{
      data?: {
        is_valid?: boolean;
        expires_at?: number;
        data_access_expires_at?: number;
        scopes?: string[];
        error?: { message?: string };
      };
    }>('debug_token', token, { input_token: token });

    const info = res.data;
    if (!info?.is_valid) {
      return {
        valid: false,
        message: info?.error?.message || 'A Meta informou que este token não é válido.',
        expiresAt: null,
        scopes: []
      };
    }

    // expires_at = 0 significa token sem expiração (usuário do sistema).
    const expiresAt =
      info.expires_at && info.expires_at > 0 ? new Date(info.expires_at * 1000).toISOString() : null;

    return {
      valid: true,
      message: expiresAt ? `Token válido até ${expiresAt.slice(0, 10)}.` : 'Token válido, sem data de expiração.',
      expiresAt,
      scopes: info.scopes || []
    };
  } catch (err) {
    const message = err instanceof MetaApiError ? err.message : 'Não foi possível validar o token.';
    return { valid: false, message, expiresAt: null, scopes: [] };
  }
}

/** Confirma que o token enxerga a conta, sem trazer métricas. */
export async function checkAccountAccess(
  token: string,
  externalAccountId: string
): Promise<{ ok: boolean; message: string; name?: string; currency?: string; timezone?: string }> {
  try {
    const res = await graphGet<{ id: string; name: string; currency: string; timezone_name: string; account_status: number }>(
      toActId(externalAccountId),
      token,
      { fields: 'id,name,account_status,currency,timezone_name' }
    );
    return {
      ok: true,
      message: `Conta ${res.name} acessível.`,
      name: res.name,
      currency: res.currency,
      timezone: res.timezone_name
    };
  } catch (err) {
    return { ok: false, message: err instanceof MetaApiError ? err.message : 'Falha ao acessar a conta.' };
  }
}
