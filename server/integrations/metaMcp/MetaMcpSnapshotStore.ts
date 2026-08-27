import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MetaMcpSnapshot, McpAccountSnapshot, McpDailyRow, EMPTY_SNAPSHOT } from './types.js';
import { dataFile, ensureDataDir } from '../../config/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SNAPSHOT_FILE = dataFile('meta-mcp-snapshot.json');

/** Aceita tanto o id numérico quanto o formato `act_<id>` usado pelo Graph. */
export function normalizeAccountId(externalAccountId: string): string {
  return externalAccountId.replace(/^act_/, '');
}

class MetaMcpSnapshotStore {
  private snapshot: MetaMcpSnapshot;

  constructor() {
    this.snapshot = this.load();
  }

  private load(): MetaMcpSnapshot {
    try {
      if (fs.existsSync(SNAPSHOT_FILE)) {
        const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf-8');
        return JSON.parse(raw) as MetaMcpSnapshot;
      }
    } catch (e) {
      console.error('[MetaMCP] Falha ao ler meta-mcp-snapshot.json:', e);
    }
    return { ...EMPTY_SNAPSHOT };
  }

  public save(snapshot: MetaMcpSnapshot): void {
    ensureDataDir();
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf-8');
    this.snapshot = snapshot;
  }

  public reload(): void {
    this.snapshot = this.load();
  }

  public getSnapshot(): MetaMcpSnapshot {
    return this.snapshot;
  }

  public getCatalog() {
    return this.snapshot.catalog;
  }

  public getAccount(externalAccountId: string): McpAccountSnapshot | undefined {
    return this.snapshot.accounts[normalizeAccountId(externalAccountId)];
  }

  public hasRealDataFor(externalAccountId: string): boolean {
    const acc = this.getAccount(externalAccountId);
    return !!acc && acc.daily.length > 0;
  }

  /** A conta existe no catálogo real da Meta, mesmo que ainda sem dados coletados. */
  public isKnownAccount(externalAccountId: string): boolean {
    const id = normalizeAccountId(externalAccountId);
    return !!this.snapshot.accounts[id] || this.snapshot.catalog.some(c => c.adAccountId === id);
  }

  /**
   * Recorta as linhas diárias do snapshot pelo período pedido.
   * Retorna só os dias efetivamente coletados — dias fora da janela do snapshot
   * ficam ausentes em vez de virarem zero.
   */
  public getDailyRange(externalAccountId: string, since: string, until: string): McpDailyRow[] {
    const acc = this.getAccount(externalAccountId);
    if (!acc) return [];
    return acc.daily
      .filter(d => d.date >= since && d.date <= until)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Cobertura do snapshot, para a interface avisar quando o período pedido excede o coletado. */
  public getCoverage(externalAccountId: string): { since: string; until: string; fetchedAt: string } | null {
    const acc = this.getAccount(externalAccountId);
    if (!acc) return null;
    return { since: acc.range.since, until: acc.range.until, fetchedAt: acc.fetchedAt };
  }
}

export const metaMcpSnapshotStore = new MetaMcpSnapshotStore();
