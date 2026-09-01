import { db } from '../../db/database.js';
import { fetchAdveronixCsv, aggregateSnapshot } from './fetchAndAggregate.js';
import { sheetsSnapshotStore } from './SheetsSnapshotStore.js';

export class SheetsIngestionService {
  public static async syncAccount(externalAccountId: string, sheetsUrl: string): Promise<void> {
    const csv = await fetchAdveronixCsv(sheetsUrl);
    const snapshot = aggregateSnapshot(csv, externalAccountId, sheetsUrl);
    sheetsSnapshotStore.upsertAccount(snapshot);
    console.log(
      `[Sheets] ${externalAccountId}: ${snapshot.daily.length} dias, ${snapshot.campaigns.length} campanhas, ` +
      `${snapshot.ads.length} anúncios (${snapshot.range.since} a ${snapshot.range.until}).`
    );
  }

  /** Roda a coleta para todas as contas que têm uma planilha configurada. */
  public static async syncAll(): Promise<void> {
    const accounts = db.getAllAccounts().filter(a => !!a.sheetsUrl);
    for (const account of accounts) {
      try {
        await this.syncAccount(account.externalAccountId, account.sheetsUrl!);
      } catch (e: any) {
        console.error(`[Sheets] Falha ao sincronizar ${account.name} (${account.externalAccountId}):`, e?.message || e);
      }
    }
  }
}
