import { AdAccount, DataSource } from '../models/types.js';
import { AdvertisingProvider } from '../providers/AdvertisingProvider.js';
import { McpMetaAdsProvider } from '../providers/McpMetaAdsProvider.js';
import { MetaAdsProvider } from '../providers/MetaAdsProvider.js';
import { MockMetaProvider } from '../providers/MockMetaProvider.js';
import { SheetsAdsProvider } from '../providers/SheetsAdsProvider.js';
import { metaMcpSnapshotStore } from '../integrations/metaMcp/MetaMcpSnapshotStore.js';
import { sheetsSnapshotStore } from '../integrations/sheets/SheetsSnapshotStore.js';

const mcpProvider = new McpMetaAdsProvider();
const graphProvider = new MetaAdsProvider();
const mockProvider = new MockMetaProvider();
const sheetsProvider = new SheetsAdsProvider();

/**
 * Uma conta é real quando carrega identidade da Meta: `businessId` só é
 * preenchido a partir do catálogo verdadeiro, nunca em conta de demonstração.
 *
 * Isso é propriedade da conta, não do snapshot. Antes a verificação dependia de
 * o snapshot estar carregado — e num ambiente recém-implantado, sem coleta
 * ainda, toda conta real virava "desconhecida" e caía no mock, exibindo números
 * inventados sob o nome de um cliente de verdade.
 */
function isRealMetaAccount(account: Pick<AdAccount, 'externalAccountId' | 'platform' | 'businessId'>): boolean {
  return account.platform === 'meta_ads' && !!account.businessId;
}

/**
 * Precedência: planilha configurada explicitamente > MCP > Graph API com token > mock.
 *
 * Uma conta com planilha (`sheetsUrl`) foi apontada manualmente para essa
 * origem — é uma escolha explícita, então vence qualquer detecção automática.
 * Conta real sem planilha sempre usa o provider do MCP, mesmo sem dados
 * coletados: aí ela reporta N/D, que é a verdade. O mock existe apenas para
 * contas de demonstração — as que não têm identidade da Meta.
 */
export function resolveDataSource(
  account: Pick<AdAccount, 'externalAccountId' | 'accessTokenRef' | 'platform' | 'businessId'>
): DataSource {
  if (sheetsSnapshotStore.isKnownAccount(account.externalAccountId)) return 'sheets';
  if (metaMcpSnapshotStore.isKnownAccount(account.externalAccountId)) return 'meta_mcp';
  if (account.accessTokenRef && process.env[account.accessTokenRef]) return 'meta_graph';
  if (isRealMetaAccount(account)) return 'meta_mcp';
  return 'mock';
}

export function providerFor(source: DataSource): AdvertisingProvider {
  if (source === 'sheets') return sheetsProvider;
  if (source === 'meta_mcp') return mcpProvider;
  if (source === 'meta_graph') return graphProvider;
  return mockProvider;
}

export function resolveProvider(
  account: Pick<AdAccount, 'externalAccountId' | 'accessTokenRef' | 'platform' | 'businessId'>
): { provider: AdvertisingProvider; source: DataSource } {
  const source = resolveDataSource(account);
  return { provider: providerFor(source), source };
}

/** Origem efetiva do conjunto: se qualquer conta ainda depende de mock, o conjunto é mock. */
export function combineDataSources(sources: DataSource[]): DataSource {
  if (sources.length === 0) return 'mock';
  if (sources.includes('mock')) return 'mock';
  if (sources.includes('sheets')) return 'sheets';
  return sources.includes('meta_mcp') ? 'meta_mcp' : 'meta_graph';
}

export { mockProvider };
