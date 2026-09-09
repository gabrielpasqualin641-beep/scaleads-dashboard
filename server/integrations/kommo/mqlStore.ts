import fs from 'fs';
import { dataFile, ensureDataDir } from '../../config/paths.js';

/**
 * Contagem diária de MQL por conta, vinda do CRM.
 *
 * Fica em disco pelo mesmo motivo das métricas da Meta: o painel nunca deve
 * chamar o Kommo durante uma requisição de usuário. A sincronização escreve,
 * o painel lê.
 *
 * `indefinidos` são leads cujo faturamento não foi respondido ou não deu para
 * interpretar. Ficam contados à parte de propósito: somá-los aos "não MQL"
 * afirmaria que não qualificam, quando a verdade é que não se sabe.
 */

export interface DailyMql {
  /** Leads criados no dia. */
  leads: number;
  /** Quantos deles têm faturamento acima do limite. */
  mqls: number;
  /** Leads sem faturamento informado ou ilegível. */
  indefinidos: number;
}

export interface AccountMql {
  accountId: string;
  daily: Record<string, DailyMql>;
  lastSyncAt: string;
  lastError?: string;
}

interface MqlSnapshot {
  version: 1;
  accounts: Record<string, AccountMql>;
}

const EMPTY: MqlSnapshot = { version: 1, accounts: {} };

class MqlStore {
  private file = dataFile('kommo-mql.json');
  private data: MqlSnapshot = EMPTY;

  constructor() {
    ensureDataDir();
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.file)) {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as MqlSnapshot;
        if (!this.data.accounts) this.data.accounts = {};
      }
    } catch (e) {
      console.error('[Kommo] Erro ao ler kommo-mql.json, começando vazio:', (e as Error).message);
      this.data = { version: 1, accounts: {} };
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[Kommo] Erro ao salvar kommo-mql.json:', (e as Error).message);
    }
  }

  public has(accountId: string): boolean {
    return !!this.data.accounts[accountId];
  }

  /**
   * Grava o resultado de uma coleta.
   *
   * Faz merge por data em vez de substituir: uma coleta de 30 dias não pode
   * apagar o histórico anterior a ela.
   */
  public saveSync(accountId: string, daily: Record<string, DailyMql>): void {
    const current = this.data.accounts[accountId];
    this.data.accounts[accountId] = {
      accountId,
      daily: { ...(current?.daily || {}), ...daily },
      lastSyncAt: new Date().toISOString()
    };
    this.save();
  }

  /** Registra falha sem destruir o que já havia sido coletado. */
  public saveError(accountId: string, message: string): void {
    const current = this.data.accounts[accountId];
    this.data.accounts[accountId] = {
      accountId,
      daily: current?.daily || {},
      lastSyncAt: current?.lastSyncAt || new Date().toISOString(),
      lastError: message
    };
    this.save();
  }

  /**
   * Total do período. Devolve `null` quando não há coleta para a conta —
   * ausência de dado, que o painel mostra como N/D, e não zero MQL.
   */
  public totals(accountId: string, since: string, until: string): DailyMql | null {
    const acc = this.data.accounts[accountId];
    if (!acc) return null;
    const dates = Object.keys(acc.daily).filter(d => d >= since && d <= until);
    if (dates.length === 0) return { leads: 0, mqls: 0, indefinidos: 0 };
    return dates.reduce<DailyMql>(
      (sum, d) => ({
        leads: sum.leads + acc.daily[d].leads,
        mqls: sum.mqls + acc.daily[d].mqls,
        indefinidos: sum.indefinidos + acc.daily[d].indefinidos
      }),
      { leads: 0, mqls: 0, indefinidos: 0 }
    );
  }

  /** MQL de um único dia, ou `null` se a conta não é coletada. */
  public forDate(accountId: string, date: string): DailyMql | null {
    const acc = this.data.accounts[accountId];
    if (!acc) return null;
    return acc.daily[date] || { leads: 0, mqls: 0, indefinidos: 0 };
  }

  public summary(): Array<{ accountId: string; dias: number; lastSyncAt: string; lastError?: string }> {
    return Object.values(this.data.accounts).map(a => ({
      accountId: a.accountId,
      dias: Object.keys(a.daily).length,
      lastSyncAt: a.lastSyncAt,
      lastError: a.lastError
    }));
  }
}

export const kommoMqlStore = new MqlStore();
