import fs from 'fs';
import { dataFile, ensureDataDir } from '../config/paths.js';

/**
 * Cópia durável, fora da hospedagem, dos arquivos que o painel escreve.
 *
 * O disco do Render no plano free é efêmero: quando o serviço hiberna por
 * inatividade (e isso acontece toda noite) ou recebe um deploy, a máquina sobe
 * zerada. Tudo que só existia em `server/data/` some — foi assim que o usuário
 * criado para um cliente parava de funcionar "quando virava o dia".
 *
 * A solução é guardar esses arquivos num Redis gerenciado (Upstash, que tem
 * plano gratuito e API REST — não precisa de driver). No boot, o que está lá é
 * baixado para o disco antes de qualquer leitura; a cada escrita, o arquivo é
 * reenviado. O disco local vira cache; a verdade fica no Redis.
 *
 * Só entram arquivos escritos pelas pessoas. Snapshots de planilha, MCP e
 * leads são regenerados pela sincronização a cada boot e não precisam disso.
 *
 * Sem as variáveis de ambiente (desenvolvimento local), tudo aqui é no-op.
 */

const PERSISTED_FILES = ['store.json', 'briefs.json', 'research.json'] as const;
export type PersistedFile = (typeof PERSISTED_FILES)[number];

const URL_ = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/$/, '');
const TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
const KEY_PREFIX = 'scaleads:file:';
const DEBOUNCE_MS = 1500;

export function remoteStateConfigured(): boolean {
  return !!URL_ && !!TOKEN;
}

async function redis(command: string[]): Promise<unknown> {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
  return body.result;
}

/** Baixa do Redis para o disco. O Redis vence: é a cópia que sobrevive. */
async function restore(): Promise<void> {
  if (!remoteStateConfigured()) return;
  ensureDataDir();
  for (const file of PERSISTED_FILES) {
    try {
      const value = await redis(['GET', KEY_PREFIX + file]);
      if (typeof value === 'string' && value.trim()) {
        JSON.parse(value); // não grava por cima do disco algo que não é JSON
        fs.writeFileSync(dataFile(file), value, 'utf-8');
        console.log(`[Persistência] ${file} restaurado do Redis.`);
      } else if (fs.existsSync(dataFile(file))) {
        // Primeira vez: o Redis está vazio. Sobe o que existe para começar.
        await redis(['SET', KEY_PREFIX + file, fs.readFileSync(dataFile(file), 'utf-8')]);
        console.log(`[Persistência] ${file} enviado ao Redis pela primeira vez.`);
      }
    } catch (err) {
      console.error(`[Persistência] Falha ao restaurar ${file}:`, err instanceof Error ? err.message : err);
    }
  }
}

const pending = new Map<PersistedFile, ReturnType<typeof setTimeout>>();

async function upload(file: PersistedFile): Promise<void> {
  pending.delete(file);
  try {
    const path = dataFile(file);
    if (!fs.existsSync(path)) return;
    await redis(['SET', KEY_PREFIX + file, fs.readFileSync(path, 'utf-8')]);
  } catch (err) {
    console.error(`[Persistência] Falha ao salvar ${file} no Redis:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Agenda o envio do arquivo ao Redis. Várias escritas seguidas (um login que
 * grava `lastLoginAt`, por exemplo) viram um envio só.
 */
export function persist(file: PersistedFile): void {
  if (!remoteStateConfigured()) return;
  const current = pending.get(file);
  if (current) clearTimeout(current);
  pending.set(file, setTimeout(() => void upload(file), DEBOUNCE_MS));
}

/** Envia na hora o que estiver agendado — usado quando a máquina vai desligar. */
export async function flushPending(): Promise<void> {
  const files = Array.from(pending.keys());
  for (const file of files) clearTimeout(pending.get(file)!);
  await Promise.all(files.map(upload));
}

if (remoteStateConfigured()) {
  // O Render manda SIGTERM antes de hibernar ou trocar a versão: não deixa uma
  // escrita dos últimos segundos se perder na janela do debounce.
  process.once('SIGTERM', () => {
    void flushPending().finally(() => process.exit(0));
  });
} else if (process.env.NODE_ENV === 'production') {
  console.warn(
    '⚠️  [Persistência] UPSTASH_REDIS_REST_URL/TOKEN ausentes: usuários, clientes e briefings ' +
    'criados pelo painel somem quando o servidor reinicia.'
  );
}

/**
 * Top-level await: quem importa este módulo (o banco, os briefings) só executa
 * depois que o disco já tem a cópia do Redis. Sem isso o banco leria o
 * `store.json` zerado do boot e o regravaria por cima.
 */
await restore();
