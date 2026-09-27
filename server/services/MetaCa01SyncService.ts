import { db } from '../db/database.js';
import { sheetsSnapshotStore } from '../integrations/sheets/SheetsSnapshotStore.js';
import { buildSnapshot, isConfigured } from '../integrations/metaMarketing/ca01Insights.js';

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

// 63 dias cobrem a visão padrão ("últimos 30 dias") e a comparação com o
// período anterior. Puxar mais no boot deixaria a CA 01 em N/D por minutos a
// cada reinício do Render; janelas maiores ficam sob demanda pela rota.
const DEFAULT_WINDOW_DAYS = 63;

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

  public static async sync(range = defaultRange()): Promise<{ ok: boolean; message?: string }> {
    const accountId = ca01AccountId();
    if (!accountId) return { ok: false, message: 'Conta CA 01 não encontrada no painel.' };
    if (!isConfigured()) return { ok: false, message: 'Meta não configurada.' };

    try {
      const snapshot = await buildSnapshot(accountId, range.since, range.until);
      // Sem linha nenhuma: não regrava, para não apagar a planilha de leads que
      // já está no snapshot (fallback).
      if (snapshot.campaigns.length === 0) {
        return { ok: false, message: 'Meta não retornou linhas; mantida a planilha de leads.' };
      }
      sheetsSnapshotStore.upsertAccount(snapshot);
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
