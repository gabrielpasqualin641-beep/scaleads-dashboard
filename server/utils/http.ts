import { Request } from 'express';

/**
 * Os tipos do Express 5 declaram params e query como `string | string[]`.
 * Estas funções normalizam para um único valor, que é o que as rotas esperam.
 */
export function pathParam(req: Request, key: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[key];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function queryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}
