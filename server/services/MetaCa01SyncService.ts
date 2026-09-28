import fs from 'fs';
import { db } from '../db/database.js';
import { dataFile } from '../config/paths.js';
import { persist } from '../persistence/remoteState.js';
import { sheetsSnapshotStore } from '../integrations/sheets/SheetsSnapshotStore.js';
import { SheetsAccountSnapshot } from '../integrations/sheets/types.js';
import { buildSnapshot, isConfigured } from '../integrations/metaMarketing/ca01Insights.js';

// Última mídia coletada da Meta, guardada à parte e espelhada no Upstash. No
// Render free o disco zera a cada reinício; sem isto, a CA 01 ficaria em N/D
// pelos ~30s que a nova coleta leva. Com isto, o snapshot volta na hora.
const CACHE_FILE = dataFile('meta-ca01-snapshot.json');

/**
 * Alimenta a conta CA 01 com a mídia vinda da Meta Marketing API.
 *
 * A CA 01 é servida pelo SheetsAdsProvider a partir do snapshot em
 * `sheetsSnapshotStore`. A sincronização da planilha de leads já grava ali um
 * snapshot só com a contagem de leads (sem gasto). Este serviço roda logo
 * depois e regrava o mesmo snapshot com a mídia de verdade da Meta — gasto,
 * impressões, cliques e leads por campanha/conjunto/anúncio.
 *
 * É a única troca: nada mais no painel muda, e o MQL continua vindo do export
 * de leads (o adKey é o mesmo). Se a Meta falhar, não regrava nada — o snapshot
 * da planilha de leads permanece, então a tela cai para ela sozinha (fallback).
 *
 * Sem `META_ACCESS_TOKEN`/`META_CA01_ACCOUNT_ID`, o serviço é inerte.
 */

// 30 dias: a visão padrão do painel. Popula rápido e é o que importa no Render
// free, onde cada reinício ressincroniza. Janelas maiores ficam sob demanda
// pela rota.
const DEFAULT_WINDOW_DAYS = 30;

function ca01AccountId(): string | null {
  // A conta do painel cujo nome é a CA 01. O id externo dela é sintético
  // ('ca01_giacobelli'); o id da Meta (act_...) fica só na variável de ambiente.
  const acc = db.getAllAccounts().find(a => /ca\s*0?1\b/i.test(a.name) && /giacobelli/i.test(a.name));
  return acc?.externalAccountId || null;
}

function defaultRange(days = DEFAULT_WINDOW_DAYS): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { since: iso(since), until: iso(until) };
}

export class MetaCa01SyncService {
  public static configured(): boolean {
    return isConfigured() && !!ca01AccountId();
  }

  /** O que falta para a CA 01 sincronizar — para o log dizer a causa exata. */
  public static configStatus(): { configured: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!process.env.META_ACCESS_TOKEN?.trim()) missing.push('META_ACCESS_TOKEN');
    if (!process.env.META_CA01_ACCOUNT_ID?.trim()) missing.push('META_CA01_ACCOUNT_ID');
    if (!ca01AccountId()) missing.push('conta CA 01 no painel');
    return { configured: missing.length === 0, missing };
  }

  /**
   * Sobe a última mídia coletada (restaurada do Upstash pelo disco) para o
   * store, antes da nova coleta. Assim a CA 01 já aparece com gasto no instante
   * em que a instância acorda, sem esperar os ~30s da nova sincronização.
   */
  public static restoreCached(): boolean {
    try {
      if (!fs.existsSync(CACHE_FILE)) return false;
      const snapshot = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as SheetsAccountSnapshot;
      if (!snapshot.accountId || !Array.isArray(snapshot.campaigns)) return false;
      sheetsSnapshotStore.upsertAccount(snapshot);
      console.log(`[Meta CA01] Snapshot restaurado do cache (${snapshot.campaigns.length} campanhas), aguardando coleta nova.`);
      return true;
    } catch (e) {
      console.error('[Meta CA01] Cache ilegível, ignorado:', e instanceof Error ? e.message : e);
      return false;
    }
  }

  public static async sync(range = defaultRange()): Promise<{ ok: boolean; message?: string }> {
    const accountId = ca01AccountId();
    if (!accountId) return { ok: false, message: 'Conta CA 01 não encontrada no painel.' };
    if (!isConfigured()) return { ok: false, message: 'Meta não configurada.' };

    try {
      console.log(`[Meta CA01] Sincronizando ${range.since} a ${range.until} (conta ${accountId})...`);
      const snapshot = await buildSnapshot(accountId, range.since, range.until);
      // Sem linha nenhuma: não regrava, para não apagar a planilha de leads que
      // já está no snapshot (fallback).
      if (snapshot.campaigns.length === 0) {
        return { ok: false, message: 'Meta não retornou linhas; mantida a planilha de leads.' };
      }
      sheetsSnapshotStore.upsertAccount(snapshot);
      // Guarda para o próximo boot já subir com a mídia, sem a janela de N/D.
      try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(snapshot), 'utf-8');
        persist('meta-ca01-snapshot.json');
      } catch (e) {
        console.error('[Meta CA01] Não consegui guardar o snapshot em cache:', e instanceof Error ? e.message : e);
      }
      console.log(
        `[Meta CA01] ${accountId}: ${snapshot.campaigns.length} campanhas, ` +
        `${snapshot.ads.length} anúncios, ${snapshot.range.since} a ${snapshot.range.until}.`
      );
      return { ok: true };
    } catch (err) {
      // Falha da Meta não derruba a conta: o snapshot da planilha permanece.
      console.error('[Meta CA01] Falha ao sincronizar; mantida a planilha de leads:', err instanceof Error ? err.message : err);
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
