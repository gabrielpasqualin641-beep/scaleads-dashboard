import fs from 'fs';
import os from 'os';
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

const PREFERRED = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), 'server/data');

/** Verifica se dá para criar e escrever no caminho, sem deixar sujeira. */
function isWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Um DATA_DIR apontando para disco não montado (plano sem volume, por exemplo)
 * derrubaria o processo no boot. Em vez de morrer, cai para um caminho que
 * funciona e avisa alto — o painel sobe, mas os dados não sobrevivem a
 * reinícios.
 */
function resolveDataDir(): { dir: string; ephemeral: boolean; warning?: string } {
  if (isWritable(PREFERRED)) {
    return { dir: PREFERRED, ephemeral: false };
  }

  const fallbacks = [path.join(process.cwd(), 'server/data'), path.join(os.tmpdir(), 'scaleads-data')];

  for (const candidate of fallbacks) {
    if (candidate !== PREFERRED && isWritable(candidate)) {
      return {
        dir: candidate,
        ephemeral: true,
        warning:
          `DATA_DIR aponta para "${PREFERRED}", que não pôde ser criado ou gravado. ` +
          `Usando "${candidate}". Os dados NÃO sobrevivem a reinícios — monte um disco ` +
          `nesse caminho, ou remova a variável DATA_DIR.`
      };
    }
  }

  throw new Error(
    `Nenhum diretório de dados gravável. Tentados: ${[PREFERRED, ...fallbacks].join(', ')}.`
  );
}

const resolved = resolveDataDir();

export const DATA_DIR = resolved.dir;

/** Verdadeiro quando estamos num caminho de emergência, sem persistência. */
export const DATA_DIR_IS_EPHEMERAL = resolved.ephemeral;
export const DATA_DIR_WARNING = resolved.warning;

/** Cria o diretório na primeira escrita. Idempotente. */
export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function dataFile(name: string): string {
  return path.join(DATA_DIR, name);
}
