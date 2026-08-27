import fs from 'fs';
import path from 'path';

/**
 * Onde ficam os arquivos que a aplicação escreve.
 *
 * Local, é `server/data/` dentro do projeto. Hospedado, aponta para o disco
 * persistente da plataforma via `DATA_DIR` — sem isso os dados sumiriam a cada
 * reinício do contêiner.
 *
 * Railway: monte um volume e defina DATA_DIR=/data
 * Render:  monte um disco e defina DATA_DIR=/var/data
 */
export const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.join(process.cwd(), 'server/data')
);

/** Cria o diretório na primeira escrita. Idempotente. */
export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function dataFile(name: string): string {
  return path.join(DATA_DIR, name);
}
