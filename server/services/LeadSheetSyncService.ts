import { db } from '../db/database.js';
import { sheetsSnapshotStore } from '../integrations/sheets/SheetsSnapshotStore.js';
import { toCsvExportUrl } from '../integrations/sheets/fetchAndAggregate.js';
import {
  parseLeadExport,
  mergeExports,
  readLiveFile,
  writeLiveFile,
  ImportedFile
} from '../integrations/metaLeads/leadExports.js';

/**
 * Sincroniza a planilha de backup de leads.
 *
 * A planilha recebe todos os leads das campanhas com o mesmo formato do export
 * do Gerenciador — anúncio, campanha e resposta de faturamento por lead. Ela
 * se atualiza sozinha, então o servidor a puxa a cada ciclo e reduz a
 * contagens por criativo, exatamente como o import manual faz com o CSV. Só
 * que automático, e sem depender do Kommo nem de alguém rodar o import.
 *
 * Nada pessoal é guardado: nome, e-mail e telefone das colunas da planilha são
 * lidos e descartados; ao disco vai só leads e MQL por criativo por dia.
 *
 * Grava no arquivo ao vivo (runtime), separado do seed commitado. O store lê os
 * dois e junta — o seed carrega o histórico dos exports manuais, a planilha
 * cobre o período novo.
 */
export class LeadSheetSyncService {
  private static accounts() {
    return db.getAllAccounts().filter(a => !!a.leadSheetUrl);
  }

  public static configured(): boolean {
    return this.accounts().length > 0;
  }

  /** Resolve a conta pelo criativo, casando com o anúncio de mesmo nome na planilha do Adveronix. */
  private static resolver() {
    const planilhas = this.accountsWithSnapshot();
    return (adKey: string): string | null => {
      const donas = planilhas.filter(acc => acc.ads.some(ad => ad.id === adKey));
      return donas.length === 1 ? donas[0].accountId : null;
    };
  }

  private static accountsWithSnapshot() {
    return db.getAllAccounts()
      .map(acc => sheetsSnapshotStore.getAccount(acc.externalAccountId))
      .filter((acc): acc is NonNullable<typeof acc> => !!acc);
  }

  public static async syncAll(): Promise<void> {
    const contas = this.accounts();
    if (contas.length === 0) return;

    const files: ImportedFile[] = [];
    for (const conta of contas) {
      try {
        const res = await fetch(toCsvExportUrl(conta.leadSheetUrl!));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (/^\s*<(!doctype|html)/i.test(text)) {
          throw new Error('planilha não pública (o Google devolveu login)');
        }
        // A planilha não carrega janela no nome; parseLeadExport tira a janela
        // das datas que os leads têm.
        const leads = parseLeadExport(Buffer.from(text, 'utf-8'));
        files.push({ fileName: `leadsheet_${conta.externalAccountId}.csv`, leads });
      } catch (err) {
        console.error(`[Lead sheet] Falha ao ler a planilha de ${conta.name}:`, err instanceof Error ? err.message : err);
      }
    }

    if (files.length === 0) return;

    const { snapshot, report, unmatched } = mergeExports(readLiveFile(), files, this.resolver());
    writeLiveFile(snapshot);

    for (const r of report) {
      console.log(
        `[Lead sheet] ${r.adName}: ${r.coverage.since} a ${r.coverage.until} · ` +
        `${r.leads} leads, ${r.mqls} MQL, ${r.indefinidos} sem faturamento.`
      );
    }
    if (unmatched.length > 0) {
      console.warn(`[Lead sheet] Criativos sem correspondente na planilha do Adveronix (ignorados): ${unmatched.join('; ')}`);
    }
  }
}
