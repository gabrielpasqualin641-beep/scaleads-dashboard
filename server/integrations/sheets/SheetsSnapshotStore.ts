import fs from 'fs';
import { SheetsSnapshot, SheetsAccountSnapshot, SheetsDailyRow, EMPTY_SHEETS_SNAPSHOT } from './types.js';
import { dataFile, ensureDataDir } from '../../config/paths.js';

const SNAPSHOT_FILE = dataFile('sheets-snapshot.json');

class SheetsSnapshotStore {
  private snapshot: SheetsSnapshot;

  constructor() {
    this.snapshot = this.load();
  }

  private load(): SheetsSnapshot {
    try {
      if (fs.existsSync(SNAPSHOT_FILE)) {
        const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf-8');
        return JSON.parse(raw) as SheetsSnapshot;
      }
    } catch (e) {
      console.error('[Sheets] Falha ao ler sheets-snapshot.json:', e);
    }
    return { ...EMPTY_SHEETS_SNAPSHOT };
  }

  public save(snapshot: SheetsSnapshot): void {
    ensureDataDir();
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf-8');
    this.snapshot = snapshot;
  }

  /** Grava/atualiza uma única conta, preservando as demais já coletadas. */
  public upsertAccount(account: SheetsAccountSnapshot): void {
    const next: SheetsSnapshot = {
      version: 1,
      generatedAt: new Date().toISOString(),
      accounts: { ...this.snapshot.accounts, [account.accountId]: account }
    };
    this.save(next);
  }

  public getAccount(externalAccountId: string): SheetsAccountSnapshot | undefined {
    return this.snapshot.accounts[externalAccountId];
  }

  public isKnownAccount(externalAccountId: string): boolean {
    return !!this.snapshot.accounts[externalAccountId];
  }

  public getDailyRange(externalAccountId: string, since: string, until: string): SheetsDailyRow[] {
    const acc = this.getAccount(externalAccountId);
    if (!acc) return [];
    return acc.daily.filter(d => d.date >= since && d.date <= until).sort((a, b) => a.date.localeCompare(b.date));
  }

  public getCoverage(externalAccountId: string): { since: string; until: string; fetchedAt: string } | null {
    const acc = this.getAccount(externalAccountId);
    if (!acc) return null;
    return { since: acc.range.since, until: acc.range.until, fetchedAt: acc.fetchedAt };
  }
}

export const sheetsSnapshotStore = new SheetsSnapshotStore();
