import { AdAccount, DataSource } from '../models/types.js';
import { AdvertisingProvider } from '../providers/AdvertisingProvider.js';
import { McpMetaAdsProvider } from '../providers/McpMetaAdsProvider.js';
import { MetaAdsProvider } from '../providers/MetaAdsProvider.js';
import { MockMetaProvider } from '../providers/MockMetaProvider.js';
import { metaMcpSnapshotStore } from '../integrations/metaMcp/MetaMcpSnapshotStore.js';

const mcpProvider = new McpMetaAdsProvider();
const graphProvider = new MetaAdsProvider();
const mockProvider = new MockMetaProvider();

/**
 * Precedência: MCP > Graph API com token > mock.
 *
 * Uma conta que existe no catálogo real do MCP sempre usa o provider do MCP,
 * mesmo sem dados coletados no período: nesse caso ela reporta N/D, que é a
 * verdade. Cair no mock aqui produziria números inventados para uma conta real.
 */
export function resolveDataSource(account: Pick<AdAccount, 'externalAccountId' | 'accessTokenRef'>): DataSource {
  if (metaMcpSnapshotStore.isKnownAccount(account.externalAccountId)) return 'meta_mcp';
  if (account.accessTokenRef && process.env[account.accessTokenRef]) return 'meta_graph';
  return 'mock';
}

export function providerFor(source: DataSource): AdvertisingProvider {
  if (source === 'meta_mcp') return mcpProvider;
  if (source === 'meta_graph') return graphProvider;
  return mockProvider;
}

export function resolveProvider(
  account: Pick<AdAccount, 'externalAccountId' | 'accessTokenRef'>
): { provider: AdvertisingProvider; source: DataSource } {
  const source = resolveDataSource(account);
  return { provider: providerFor(source), source };
}

/** Origem efetiva do conjunto: se qualquer conta ainda depende de mock, o conjunto é mock. */
export function combineDataSources(sources: DataSource[]): DataSource {
  if (sources.length === 0) return 'mock';
  if (sources.includes('mock')) return 'mock';
  return sources.includes('meta_mcp') ? 'meta_mcp' : 'meta_graph';
}

export { mockProvider };
