import fs from 'fs';
import { db } from '../db/database.js';
import { dataFile } from '../config/paths.js';
import { persist } from '../persistence/remoteState.js';
import { sheetsSnapshotStore } from '../integrations/sheets/SheetsSnapshotStore.js';
import { SheetsAccountSnapshot } from '../integrations/sheets/types.js';
import { buildSnapshot, apiVersion } from '../integrations/metaMarketing/ca01Insights.js';
import { AdAccount } from '../models/types.js';

/** Token da conta: a variável que ela apontar, ou o compartilhado. */
function tokenFor(account: AdAccount): string | null {
  return process.env[account.metaTokenEnv || 'META_ACCESS_TOKEN']?.trim() || null;
}

/**
 * Alimenta pela Meta Marketing API toda conta que tem `metaAccountId`.
 *
 * Um token só (META_ACCESS_TOKEN, do System User) cobre todas as contas. Cada
 * conta vira um snapshot no `sheetsSnapshotStore`, servido pelo provider comum;
 * a Visão Geral dela ganha o painel no padrão do relatório.
 *
 * (Não confundir com MetaSyncService, que é a coleta via MCP.)
 *
 * Os snapshots ficam num arquivo único (`meta-snapshots.json`), espelhado no
 * Upstash — no Render free o disco zera a cada reinício, e sem isto a mídia
 * ficaria N/D pelos segundos da nova coleta. No boot ele é restaurado antes.
 */

const CACHE_FILE = dataFile('meta-snapshots.json');
// 30 dias: a visão padrão do painel; popula rápido e recupera logo no boot.
const DEFAULT_WINDOW_DAYS = 30;

type Cache = Record<string, SheetsAccountSnapshot>;

function readCache(): Cache {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as Cache;
  } catch (e) {
    console.error('[Meta API] Cache ilegível, ignorado:', e instanceof Error ? e.message : e);
  }
  return {};
}

function writeCache(cache: Cache): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf-8');
    persist('meta-snapshots.json');
  } catch (e) {
    console.error('[Meta API] Falha ao guardar o cache:', e instanceof Error ? e.message : e);
  }
}

function defaultRange(days = DEFAULT_WINDOW_DAYS): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { since: iso(since), until: iso(until) };
}

export class MetaApiSyncService {
  private static accounts(): AdAccount[] {
    return db.getAllAccounts().filter(a => !!a.metaAccountId);
  }

  public static configured(): boolean {
    return this.accounts().some(a => !!tokenFor(a));
  }

  public static configStatus(): { configured: boolean; missing: string[]; accounts: number } {
    const contas = this.accounts();
    const semToken = contas.filter(a => !tokenFor(a)).map(a => `${a.name} (${a.metaTokenEnv || 'META_ACCESS_TOKEN'})`);
    const missing: string[] = [];
    if (contas.length === 0) missing.push('nenhuma conta com metaAccountId');
    if (semToken.length > 0) missing.push(`sem token: ${semToken.join(', ')}`);
    return { configured: contas.some(a => !!tokenFor(a)), missing, accounts: contas.length };
  }

  /** Sobe os snapshots guardados para o store, antes da coleta nova. */
  public static restoreCached(): number {
    const cache = readCache();
    let n = 0;
    for (const snap of Object.values(cache)) {
      if (snap?.accountId && Array.isArray(snap.campaigns)) { sheetsSnapshotStore.upsertAccount(snap); n++; }
    }
    if (n > 0) console.log(`[Meta API] ${n} snapshot(s) restaurado(s) do cache, aguardando coleta nova.`);
    return n;
  }

  private static async syncOne(account: AdAccount, range: { since: string; until: string }, cache: Cache): Promise<{ ok: boolean; retry: boolean }> {
    const token = tokenFor(account);
    if (!token) {
      console.warn(`[Meta API] ${account.name}: sem token (${account.metaTokenEnv || 'META_ACCESS_TOKEN'}); pulada.`);
      return { ok: false, retry: false };
    }
    try {
      const snapshot = await buildSnapshot(account.externalAccountId, account.metaAccountId!, token, apiVersion(), range.since, range.until);
      if (snapshot.campaigns.length === 0) {
        console.warn(`[Meta API] ${account.name}: a Meta não retornou linhas; snapshot anterior mantido.`);
        return { ok: false, retry: false };
      }
      sheetsSnapshotStore.upsertAccount(snapshot);
      cache[account.externalAccountId] = snapshot;
      console.log(`[Meta API] ${account.name}: ${snapshot.campaigns.length} campanhas, ${snapshot.ads.length} anúncios, ${snapshot.range.since} a ${snapshot.range.until}.`);
      return { ok: true, retry: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Token inválido/expirado, permissão, conta inexistente: não retenta (a
      // retentativa não conserta). Só limite transitório da Meta vale retentar.
      const auth = /access token|session has expired|expired|oauth|\(#190\)|\(#102\)|\(#200\)|permission|does not exist|unsupported get/i.test(msg);
      const retry = !auth && /temporarily unavailable|timeout|aborted|\b429\b|HTTP 5\d\d|network|fetch failed/i.test(msg);
      console.error(`[Meta API] Falha ao sincronizar ${account.name}: ${msg}${retry ? '' : ' (não retenta)'}`);
      return { ok: false, retry };
    }
  }

  public static async syncAll(range = defaultRange()): Promise<void> {
    const contas = this.accounts().filter(a => !!tokenFor(a));
    if (contas.length === 0) return;

    const cache = readCache();
    for (const conta of contas) {
      // Retenta só por limite transitório; erro de token/permissão falha na hora
      // e não segura as outras contas.
      for (let attempt = 1; attempt <= 3; attempt++) {
        const r = await this.syncOne(conta, range, cache);
        if (r.ok || !r.retry || attempt === 3) break;
        await new Promise(res => setTimeout(res, 30_000));
      }
    }
    writeCache(cache);
  }
}
