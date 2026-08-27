import { db } from '../db/database.js';
import { AdAccount, AccountPlatform, DataSource } from '../models/types.js';
import { resolveProvider, resolveDataSource } from './ProviderResolver.js';

export class AdAccountService {
  public static getByClientId(clientId: string): AdAccount[] {
    return db.getAccountsByClient(clientId);
  }

  public static getById(id: string): AdAccount | undefined {
    return db.getAccountById(id);
  }

  public static create(data: {
    clientId: string;
    externalAccountId: string;
    name: string;
    platform: AccountPlatform;
    currency?: string;
    timezone?: string;
    accessToken?: string;
  }): AdAccount {
    return db.createAccount({
      clientId: data.clientId,
      externalAccountId: data.externalAccountId,
      name: data.name,
      platform: data.platform || 'meta_ads',
      currency: data.currency || 'BRL',
      timezone: data.timezone || 'America/Sao_Paulo',
      status: 'active',
      accessTokenRef: data.accessToken ? `TOKEN_${Date.now()}` : undefined,
      lastSyncAt: new Date().toISOString()
    });
  }

  public static update(id: string, updates: Partial<AdAccount>): AdAccount | null {
    return db.updateAccount(id, updates);
  }

  public static getDataSource(accountId: string): DataSource | null {
    const acc = db.getAccountById(accountId);
    return acc ? resolveDataSource(acc) : null;
  }

  public static async testConnection(
    accountId: string
  ): Promise<{ success: boolean; message: string; dataSource?: DataSource }> {
    const acc = db.getAccountById(accountId);
    if (!acc) {
      return { success: false, message: 'Conta de anúncios não encontrada.' };
    }

    const { provider, source } = resolveProvider(acc);
    const token = source === 'meta_graph' ? process.env[acc.accessTokenRef!]! : '';
    const result = await provider.testConnection(token, acc.externalAccountId);
    return { ...result, dataSource: source };
  }
}
