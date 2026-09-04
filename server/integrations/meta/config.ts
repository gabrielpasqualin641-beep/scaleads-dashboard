/**
 * Configuração única da Meta Marketing API.
 *
 * Versão e host ficam aqui e em nenhum outro lugar — antes a versão estava
 * embutida no provider, e qualquer atualização exigiria caçar literais.
 */

/** Sobrescreva com META_API_VERSION quando precisar fixar outra versão. */
export const META_API_VERSION = process.env.META_API_VERSION?.trim() || 'v21.0';

export const META_GRAPH_URL = 'https://graph.facebook.com';

/** Teto de páginas por consulta — evita laço infinito num cursor defeituoso. */
export const MAX_PAGES = 50;

/** Espera entre contas na sincronização, para não estourar o rate limit. */
export const SYNC_DELAY_MS = Number(process.env.META_SYNC_DELAY_MS) || 1200;

/**
 * Campos de insights pedidos à API.
 *
 * A Meta rejeita a requisição inteira quando um campo não existe na versão em
 * uso, então a lista fica conservadora: só campos estáveis. Métricas de vídeo e
 * landing page vêm em `actions`, não como campo próprio.
 */
export const INSIGHT_FIELDS = [
  'date_start',
  'date_stop',
  'spend',
  'impressions',
  'reach',
  'frequency',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'unique_clicks',
  'unique_ctr',
  'actions',
  'action_values',
  'cost_per_action_type'
].join(',');

/**
 * Conversão que alimenta o CPA do painel.
 *
 * A Meta devolve dezenas de `action_type`; não existe "a" conversão. Aqui a
 * decisão é explícita: compra é a conversão principal, porque é o que tem valor
 * monetário e alimenta o ROAS. Contas que otimizam para outro evento precisam
 * ajustar esta constante.
 */
export const PRIMARY_CONVERSION = 'purchase' as const;
