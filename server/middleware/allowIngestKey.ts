import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * Autenticação alternativa só para a ingestão automática do snapshot.
 *
 * A coleta roda sem ninguém logado, e guardar a senha de um administrador num
 * script seria pior. Esta chave autoriza exclusivamente `POST /snapshot` — não
 * dá acesso a nenhum dado de cliente e não cria sessão.
 */
export function ingestKeyConfigured(): boolean {
  return !!(process.env.MCP_INGEST_KEY || '').trim();
}

function providedKey(req: Request): string {
  const header = req.headers['x-ingest-key'];
  if (Array.isArray(header)) return header[0] ?? '';
  return typeof header === 'string' ? header : '';
}

export function hasValidIngestKey(req: Request): boolean {
  const expected = (process.env.MCP_INGEST_KEY || '').trim();
  const provided = providedKey(req).trim();
  if (!expected || !provided) return false;

  const a = Buffer.from(expected, 'utf-8');
  const b = Buffer.from(provided, 'utf-8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Libera a chave de ingestão apenas nas rotas informadas; qualquer outra
 * continua exigindo sessão. Sem esse recorte a chave viraria um acesso geral
 * à integração.
 *
 * `GET /status` entra na lista porque é metadado da coleta — nomes de conta e
 * contagem de linhas — e é o que permite diagnosticar um ambiente hospedado
 * sem precisar da senha de ninguém. Nenhuma métrica de cliente passa por ela.
 */
export function allowIngestKeyOn(
  routes: Array<{ method: string; path: string }>,
  fallback: (req: Request, res: Response, next: NextFunction) => void
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const permitida = routes.some(r => req.method === r.method && req.path === r.path);
    if (permitida && hasValidIngestKey(req)) return next();
    return fallback(req, res, next);
  };
}
