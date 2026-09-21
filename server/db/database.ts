import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client, AdAccount, User, LeadQualifier } from '../models/types.js';
import { dataFile, ensureDataDir } from '../config/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = dataFile('store.json');

export interface SyncLog {
  id: string;
  clientId: string;
  adAccountId: string;
  timestamp: string;
  status: 'SUCCESS' | 'ERROR' | 'WARNING';
  message: string;
  recordsSynced?: number;
}

export interface DatabaseSchema {
  organization: {
    id: string;
    name: string;
    ownerEmail: string;
  };
  clients: Client[];
  accounts: AdAccount[];
  users: User[];
  syncLogs: SyncLog[];
  cache: Record<string, { data: unknown; expiresAt: number }>;
}

/**
 * Clientes reais da agência, cada um mapeado ao seu Business Manager da Meta.
 * Contato fica vazio: não há dado real dessas informações no MCP, e inventar
 * e-mail ou telefone seria fabricar dado de cliente.
 */
const SEED_CLIENTS: Client[] = [
  {
    id: 'client_alberto_pompeu',
    organizationId: 'org_scale_01',
    name: 'Alberto Pompeu',
    companyName: 'Alberto Neto',
    email: '',
    phone: '',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'client_bruno_corano',
    organizationId: 'org_scale_01',
    name: 'Bruno Corano',
    companyName: 'Bruno Corano',
    email: '',
    phone: '',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'client_manhattan',
    organizationId: 'org_scale_01',
    name: 'Manhattan Connection',
    companyName: 'Manhattan Connection',
    email: '',
    phone: '',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'client_marcio_giacobelli',
    organizationId: 'org_scale_01',
    name: 'Márcio Giacobelli',
    companyName: 'Giacobelli',
    email: '',
    phone: '',
    status: 'active',
    createdAt: '2026-09-09T00:00:00Z',
    updatedAt: '2026-09-09T00:00:00Z'
  }
];

/**
 * Contas de anúncio reais, com o ID verdadeiro da Meta. `mcpQueryable: false`
 * marca as contas que a própria Meta bloqueou — elas aparecem no painel com o
 * motivo real, sem números.
 */
type SeedAccount = Omit<AdAccount, 'createdAt' | 'updatedAt'>;

const META_ACCOUNTS: Array<{
  id: string;
  clientId: string;
  externalAccountId: string;
  name: string;
  currency?: string;
  status?: AdAccount['status'];
  businessId: string;
  businessName: string;
  mcpEnabled?: boolean;
  mcpQueryable?: boolean;
  mcpUnavailableReason?: string;
  excludedCampaigns?: string[];
  leadSheetUrl?: string;
  leadQualifier?: LeadQualifier;
  /**
   * Planilha do Adveronix que alimenta a conta. Fica no seed, e não só no
   * store.json, porque o disco da hospedagem é efêmero no plano atual: um
   * link gravado apenas em runtime desaparece no próximo deploy e a conta
   * volta a ficar sem origem de dados.
   */
  sheetsUrl?: string;
}> = [
  // --- Alberto Pompeu · Business "Alberto Neto" ---
  { id: 'acc_ap_ca01', clientId: 'client_alberto_pompeu', externalAccountId: '423474724397288', name: 'CA01 - Alberto Pompeu', status: 'paused', businessId: '150972766074654', businessName: 'Alberto Neto', mcpQueryable: false, mcpUnavailableReason: 'Conta sinalizada pela Meta por atividade incomum; anúncios pausados.' },
  { id: 'acc_ap_ca02', clientId: 'client_alberto_pompeu', externalAccountId: '1610921712941910', name: 'CA02 - Alberto Pompeu', businessId: '150972766074654', businessName: 'Alberto Neto' },
  { id: 'acc_ap_ca03', clientId: 'client_alberto_pompeu', externalAccountId: '1250482763638278', name: 'CA03 - Alberto Pompeu', status: 'paused', businessId: '150972766074654', businessName: 'Alberto Neto', mcpEnabled: false, mcpQueryable: false, mcpUnavailableReason: 'Conta sinalizada pela Meta por atividade incomum; Ads MCP indisponível.' },
  { id: 'acc_ap_ca04', clientId: 'client_alberto_pompeu', externalAccountId: '2113422056113465', name: 'CA04 - Alberto Pompeu', businessId: '150972766074654', businessName: 'Alberto Neto', sheetsUrl: 'https://docs.google.com/spreadsheets/d/1gLQgO7caRH0wxf3Kh1K3emi_ed4aE-ghOLA-f229DTs/edit?gid=0#gid=0' },
  { id: 'acc_ap_ca05', clientId: 'client_alberto_pompeu', externalAccountId: '764177629712794', name: 'CA05 - Alberto Pompeu', businessId: '150972766074654', businessName: 'Alberto Neto' },
  { id: 'acc_ap_ca06', clientId: 'client_alberto_pompeu', externalAccountId: '785647550668297', name: 'CA06 - Alberto Pompeu', businessId: '150972766074654', businessName: 'Alberto Neto' },
  { id: 'acc_ap_ca07', clientId: 'client_alberto_pompeu', externalAccountId: '942897441749845', name: 'CA07 - Alberto Pompeu', businessId: '150972766074654', businessName: 'Alberto Neto' },
  { id: 'acc_ap_ca08', clientId: 'client_alberto_pompeu', externalAccountId: '4030157060609456', name: 'CA08 - Alberto Pompeu', businessId: '150972766074654', businessName: 'Alberto Neto', mcpEnabled: false, mcpUnavailableReason: 'Ads MCP ainda não liberado para esta conta pela Meta.' },

  // --- Bruno Corano ---
  { id: 'acc_bc_main', clientId: 'client_bruno_corano', externalAccountId: '225816930470910', name: 'Bruno Corano', businessId: '214306439156169', businessName: 'Bruno Corano' },
  { id: 'acc_bc_lancamento', clientId: 'client_bruno_corano', externalAccountId: '1149174529505177', name: 'Bruno Corano - Lançamento', businessId: '214306439156169', businessName: 'Bruno Corano' },

  // --- Manhattan Connection ---
  { id: 'acc_mc_main', clientId: 'client_manhattan', externalAccountId: '1905447260119652', name: 'CA - Manhattan Connection', businessId: '103683241464431', businessName: 'Manhattan Connection', mcpEnabled: false, mcpUnavailableReason: 'Ads MCP ainda não liberado para esta conta pela Meta.' },
  { id: 'acc_mc_farnel', clientId: 'client_manhattan', externalAccountId: '860328721500659', name: 'FARNEL', businessId: '103683241464431', businessName: 'Manhattan Connection' },
  { id: 'acc_mc_readonly', clientId: 'client_manhattan', externalAccountId: '1721067538928881', name: 'Manhattan Connection (Read-Only)', currency: 'USD', businessId: '103683241464431', businessName: 'Manhattan Connection' },

  // --- Márcio Giacobelli · Business "Giacobelli" ---
  { id: 'acc_mg_cc02', clientId: 'client_marcio_giacobelli', externalAccountId: '2103876490513769', name: 'CC02 - Márcio Giacobelli', businessId: '837672811168332', businessName: 'Giacobelli', sheetsUrl: 'https://docs.google.com/spreadsheets/d/1P8Qyzt29HuDaawfSl36Lu8HIb-QkPJ9FkvnU-Yr3JeM/edit?gid=0#gid=0',
    // A campanha de WhatsApp está pausada e entrega conversas, não leads. O
    // Adveronix não exporta conversas, então o resultado dela é invisível aqui:
    // somar o gasto dela inflaria CPL e CPMQL do formulário.
    excludedCampaigns: ['WPP'],
    // Planilha de backup que recebe todos os leads das campanhas, com o
    // faturamento — alimenta o MQL por criativo automaticamente.
    leadSheetUrl: 'https://docs.google.com/spreadsheets/d/1J80qVrBXa36OjiMGedOi3ObUVFxY8NJfIIVCvhKlGbM/edit?gid=0#gid=0' },
  // A CA01 é da campanha "SDC | ... | FORM7". A origem é só a planilha de leads
  // (sem Adveronix): ela monta a árvore de campanha/conjunto/anúncio com a
  // contagem de leads, e gasto/CPL/CPM ficam N/D até o Adveronix desta conta
  // entrar. O externalAccountId é sintético e estável — os dados vêm todos da
  // planilha, não do MCP; por isso a conta fica fora do MCP.
  { id: 'acc_mg_ca01', clientId: 'client_marcio_giacobelli', externalAccountId: 'ca01_giacobelli', name: 'CA01 - Giacobelli', businessId: '837672811168332', businessName: 'Giacobelli', mcpEnabled: false, mcpQueryable: false, mcpUnavailableReason: 'Conta alimentada pela planilha de leads; sem coleta via MCP.',
    leadSheetUrl: 'https://docs.google.com/spreadsheets/d/1a-bUrbN8fuJWPBSEIc24Kp-h--xHeQLTFOLljS50NkQ/edit?gid=0#gid=0',
    // O MQL aqui não é faturamento: é a posição do lead sobre o investimento de
    // R$17.500. MQL = quem respondeu que tem o valor e está pronto para
    // investir; as outras duas opções são reconhecidas e ficam fora do MQL.
    leadQualifier: {
      kind: 'answer',
      columnIncludes: 'investimento',
      mqlIncludes: ['pronto para investir'],
      naoMqlIncludes: ['nao tenho condicoes', 'preciso entender melhor']
    } }
];

const SEED_ACCOUNTS: AdAccount[] = META_ACCOUNTS.map(a => {
  const account: SeedAccount = {
    id: a.id,
    clientId: a.clientId,
    externalAccountId: a.externalAccountId,
    name: a.name,
    platform: 'meta_ads',
    currency: a.currency || 'BRL',
    timezone: 'America/Sao_Paulo',
    status: a.status || 'active',
    lastSyncAt: new Date().toISOString(),
    businessId: a.businessId,
    businessName: a.businessName,
    mcpEnabled: a.mcpEnabled ?? true,
    mcpQueryable: a.mcpQueryable ?? true,
    mcpUnavailableReason: a.mcpUnavailableReason,
    sheetsUrl: a.sheetsUrl,
    excludedCampaigns: a.excludedCampaigns,
    leadSheetUrl: a.leadSheetUrl,
    leadQualifier: a.leadQualifier
  };
  return { ...account, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
});

const INITIAL_DATA: DatabaseSchema = {
  organization: {
    id: 'org_scale_01',
    name: 'Scale Performance Agência',
    ownerEmail: 'gestao@scaleads.com'
  },
  clients: SEED_CLIENTS,
  accounts: SEED_ACCOUNTS,
  users: [],
  syncLogs: [],
  cache: {}
};

class Database {
  private data: DatabaseSchema;

  constructor() {
    this.ensureDataDir();
    this.data = this.loadData();
  }

  private ensureDataDir() {
    ensureDataDir();
  }

  /**
   * Traz para um store.json já existente os clientes e contas que passaram a
   * existir no seed depois que ele foi gravado.
   *
   * Sem isto, cadastrar um cliente novo exigiria apagar o arquivo — e junto
   * iriam usuários e qualquer ajuste feito pelo painel. Só acrescenta o que
   * falta: nada existente é sobrescrito. A exceção é `sheetsUrl`, que o seed
   * preenche quando a conta ainda não tem nenhuma planilha apontada.
   */
  private reconcileWithSeed(parsed: DatabaseSchema): boolean {
    let changed = false;

    for (const client of SEED_CLIENTS) {
      if (!parsed.clients.some(c => c.id === client.id)) {
        parsed.clients.push(client);
        console.log(`[DB] Cliente novo do seed adicionado: ${client.name}`);
        changed = true;
      }
    }

    for (const account of SEED_ACCOUNTS) {
      const existing = parsed.accounts.find(a => a.id === account.id);
      if (!existing) {
        parsed.accounts.push(account);
        console.log(`[DB] Conta nova do seed adicionada: ${account.name}`);
        changed = true;
      } else {
        if (!existing.sheetsUrl && account.sheetsUrl) {
          existing.sheetsUrl = account.sheetsUrl;
          console.log(`[DB] Planilha do seed aplicada a ${existing.name}.`);
          changed = true;
        }
        if (!existing.excludedCampaigns && account.excludedCampaigns) {
          existing.excludedCampaigns = account.excludedCampaigns;
          console.log(`[DB] Exclusão de campanha do seed aplicada a ${existing.name}.`);
          changed = true;
        }
        if (!existing.leadSheetUrl && account.leadSheetUrl) {
          existing.leadSheetUrl = account.leadSheetUrl;
          console.log(`[DB] Planilha de leads do seed aplicada a ${existing.name}.`);
          changed = true;
        }
        if (!existing.leadQualifier && account.leadQualifier) {
          existing.leadQualifier = account.leadQualifier;
          console.log(`[DB] Regra de MQL do seed aplicada a ${existing.name}.`);
          changed = true;
        }
      }
    }

    return changed;
  }

  private loadData(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as DatabaseSchema;
        // Bancos gravados antes da introdução de usuários não têm a coleção.
        if (!Array.isArray(parsed.users)) parsed.users = [];
        if (!Array.isArray(parsed.clients)) parsed.clients = [];
        if (!Array.isArray(parsed.accounts)) parsed.accounts = [];
        if (this.reconcileWithSeed(parsed)) this.saveData(parsed);
        return parsed;
      }
    } catch (e) {
      console.error('[DB] Erro ao ler store.json, recriando com dados iniciais:', e);
    }
    this.saveData(INITIAL_DATA);
    return INITIAL_DATA;
  }

  private saveData(data: DatabaseSchema) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[DB] Erro ao salvar store.json:', e);
    }
  }

  // --- Clients ---
  public getClients(): Client[] {
    return this.data.clients;
  }

  public getClientById(id: string): Client | undefined {
    return this.data.clients.find(c => c.id === id);
  }

  public createClient(client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Client {
    const newClient: Client = {
      ...client,
      id: `client_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.data.clients.push(newClient);
    this.saveData(this.data);
    return newClient;
  }

  public updateClient(id: string, updates: Partial<Client>): Client | null {
    const idx = this.data.clients.findIndex(c => c.id === id);
    if (idx === -1) return null;
    this.data.clients[idx] = {
      ...this.data.clients[idx],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.saveData(this.data);
    return this.data.clients[idx];
  }

  public deleteClient(id: string): boolean {
    const before = this.data.clients.length;
    this.data.clients = this.data.clients.filter(c => c.id !== id);
    this.data.accounts = this.data.accounts.filter(a => a.clientId !== id);
    this.saveData(this.data);
    return this.data.clients.length < before;
  }

  // --- Accounts ---
  public getAllAccounts(): AdAccount[] {
    return this.data.accounts;
  }

  public getAccountsByClient(clientId: string): AdAccount[] {
    return this.data.accounts.filter(a => a.clientId === clientId);
  }

  public getAccountById(id: string): AdAccount | undefined {
    return this.data.accounts.find(a => a.id === id);
  }

  public getAccountByExternalId(externalAccountId: string): AdAccount | undefined {
    return this.data.accounts.find(a => a.externalAccountId === externalAccountId);
  }

  public createAccount(account: Omit<AdAccount, 'id' | 'createdAt' | 'updatedAt'>): AdAccount {
    const newAccount: AdAccount = {
      ...account,
      id: `acc_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.data.accounts.push(newAccount);
    this.saveData(this.data);
    return newAccount;
  }

  public updateAccount(id: string, updates: Partial<AdAccount>): AdAccount | null {
    const idx = this.data.accounts.findIndex(a => a.id === id);
    if (idx === -1) return null;
    this.data.accounts[idx] = {
      ...this.data.accounts[idx],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.saveData(this.data);
    return this.data.accounts[idx];
  }

  // --- Users ---
  public getUsers(): User[] {
    return this.data.users;
  }

  public getUserById(id: string): User | undefined {
    return this.data.users.find(u => u.id === id);
  }

  public getUserByEmail(email: string): User | undefined {
    const normalized = email.trim().toLowerCase();
    return this.data.users.find(u => u.email.toLowerCase() === normalized);
  }

  public createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): User {
    const newUser: User = {
      ...user,
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.data.users.push(newUser);
    this.saveData(this.data);
    return newUser;
  }

  public updateUser(id: string, updates: Partial<User>): User | null {
    const idx = this.data.users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    this.data.users[idx] = {
      ...this.data.users[idx],
      ...updates,
      id: this.data.users[idx].id,
      updatedAt: new Date().toISOString()
    };
    this.saveData(this.data);
    return this.data.users[idx];
  }

  public deleteUser(id: string): boolean {
    const before = this.data.users.length;
    this.data.users = this.data.users.filter(u => u.id !== id);
    if (this.data.users.length === before) return false;
    this.saveData(this.data);
    return true;
  }

  // --- Cache ---
  public getCache<T>(key: string): T | null {
    const entry = this.data.cache[key];
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      delete this.data.cache[key];
      return null;
    }
    return entry.data as T;
  }

  public setCache(key: string, data: unknown, ttlSeconds: number = 900) {
    this.data.cache[key] = {
      data,
      expiresAt: Date.now() + (ttlSeconds * 1000)
    };
    this.saveData(this.data);
  }

  public clearCache(prefix?: string) {
    if (!prefix) {
      this.data.cache = {};
    } else {
      for (const k of Object.keys(this.data.cache)) {
        if (k.startsWith(prefix)) {
          delete this.data.cache[k];
        }
      }
    }
    this.saveData(this.data);
  }

  // --- Logs ---
  public addLog(log: Omit<SyncLog, 'id' | 'timestamp'>) {
    const newLog: SyncLog = {
      ...log,
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString()
    };
    this.data.syncLogs.unshift(newLog);
    if (this.data.syncLogs.length > 100) {
      this.data.syncLogs = this.data.syncLogs.slice(0, 100);
    }
    this.saveData(this.data);
    return newLog;
  }

  public getLogs(clientId?: string): SyncLog[] {
    if (clientId) {
      return this.data.syncLogs.filter(l => l.clientId === clientId);
    }
    return this.data.syncLogs;
  }
}

export const db = new Database();
