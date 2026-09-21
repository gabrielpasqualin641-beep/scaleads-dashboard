import { db } from '../db/database.js';
import { toCsvExportUrl } from '../integrations/sheets/fetchAndAggregate.js';
import {
  parseLeadExport,
  mergeExports,
  readLiveFile,
  writeLiveFile,
  LeadExportSnapshot
} from '../integrations/metaLeads/leadExports.js';
import { snapshotFromLeads } from '../integrations/metaLeads/leadSnapshot.js';
import { sheetsSnapshotStore } from '../integrations/sheets/SheetsSnapshotStore.js';
import { qualifierFn, qualifierColumn } from '../integrations/kommo/qualification.js';

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

  public static async syncAll(): Promise<void> {
    const contas = this.accounts();
    if (contas.length === 0) return;

    let live: LeadExportSnapshot = readLiveFile();

    for (const conta of contas) {
      try {
        const res = await fetch(toCsvExportUrl(conta.leadSheetUrl!));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (/^\s*<(!doctype|html)/i.test(text)) {
          throw new Error('planilha não pública (o Google devolveu login)');
        }
        // A regra de MQL é da conta: a maioria qualifica por faturamento; a
        // CA01 qualifica pela resposta sobre o investimento. A regra diz tanto
        // qual coluna carrega a resposta quanto como classificá-la.
        const classify = qualifierFn(conta.leadQualifier);
        const matchColumn = qualifierColumn(conta.leadQualifier);

        // A planilha não carrega janela no nome; parseLeadExport tira a janela
        // das datas que os leads têm.
        const leads = parseLeadExport(Buffer.from(text, 'utf-8'), matchColumn);

        // A planilha é configurada nesta conta, então todo lead dela é desta
        // conta — não precisa consultar o snapshot do Adveronix para descobrir
        // a conta (o que criava uma corrida no boot, quando o snapshot ainda
        // não tinha carregado). O criativo cujo nome não existir no Adveronix
        // fica guardado mas não é exibido; nenhum lead é perdido por timing.
        const { snapshot, report } = mergeExports(
          live,
          [{ fileName: `leadsheet_${conta.externalAccountId}.csv`, leads }],
          () => conta.externalAccountId,
          classify
        );
        live = snapshot;

        // Conta sem Adveronix: a planilha de leads é a única origem, então ela
        // também monta a árvore de campanha/conjunto/anúncio (só com contagem de
        // leads; mídia fica N/D). Conta com Adveronix não é tocada aqui — seu
        // snapshot de mídia vem da ingestão própria e o MQL entra por cima.
        if (!conta.sheetsUrl && leads.length > 0) {
          sheetsSnapshotStore.upsertAccount(
            snapshotFromLeads(leads, conta.externalAccountId, conta.leadSheetUrl!)
          );
        }

        for (const r of report) {
          console.log(
            `[Lead sheet] ${conta.name} · ${r.adName}: ${r.coverage.since} a ${r.coverage.until} · ` +
            `${r.leads} leads, ${r.mqls} MQL, ${r.indefinidos} sem resposta.`
          );
        }
      } catch (err) {
        console.error(`[Lead sheet] Falha ao ler a planilha de ${conta.name}:`, err instanceof Error ? err.message : err);
      }
    }

    writeLiveFile(live);
  }
}
