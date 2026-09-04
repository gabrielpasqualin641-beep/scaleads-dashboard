/**
 * Interpretação de `actions` da Meta — ponto único da aplicação.
 *
 * A Meta devolve dezenas de tipos dentro de `actions`, e vários se sobrepõem:
 * `purchase`, `omni_purchase` e `offsite_conversion.fb_pixel_purchase` podem
 * representar a mesma compra contada por caminhos diferentes. Somar tudo
 * infla a métrica.
 *
 * Antes cada método do provider tinha a sua própria regra — o nível de conta
 * contava `lead|contact|submit_application`, o de conjunto contava só `lead`.
 * Isso fazia o total do painel divergir do detalhamento. Toda leitura de
 * conversão passa por aqui.
 */

export interface MetaAction {
  action_type: string;
  value: string | number;
}

export interface ParsedActions {
  /** Leads atribuídos pela Meta. `null` quando a conta não reporta lead. */
  leads: number | null;
  /** Conversão principal (ver PRIMARY_CONVERSION). `null` se não houver. */
  conversions: number | null;
  /** Valor monetário da conversão principal. */
  conversionValue: number | null;
  /** Cliques no link, quando reportados. */
  linkClicks: number | null;
  /** Visualizações da página de destino. */
  landingPageViews: number | null;
  /** ThruPlays de vídeo. */
  thruPlays: number | null;
}

/**
 * Famílias de `action_type` por métrica, em ordem de preferência.
 *
 * Dentro de uma família pegamos **o primeiro tipo presente**, nunca a soma:
 * são formas alternativas de contar o mesmo evento. Entre famílias diferentes
 * (lead x compra) não há sobreposição.
 */
const LEAD_TYPES = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'onsite_web_lead',
  'leadgen_grouped'
];

const PURCHASE_TYPES = [
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_web_purchase'
];

const LINK_CLICK_TYPES = ['link_click'];
const LANDING_PAGE_TYPES = ['landing_page_view', 'omni_landing_page_view'];
const THRUPLAY_TYPES = ['video_view', 'thruplay'];

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Primeiro tipo da família que existir na resposta.
 *
 * Devolve `null` — não zero — quando nenhum aparece: a conta não reporta esse
 * evento, o que é diferente de reportar zero ocorrências.
 */
function pickFirst(actions: MetaAction[], types: string[]): number | null {
  for (const type of types) {
    const match = actions.find(a => a.action_type === type);
    if (match) {
      const value = toNumber(match.value);
      if (value !== null) return value;
    }
  }
  return null;
}

export function parseMetaActions(
  actions: unknown,
  actionValues: unknown,
  primaryConversion: string
): ParsedActions {
  const list: MetaAction[] = Array.isArray(actions) ? (actions as MetaAction[]) : [];
  const values: MetaAction[] = Array.isArray(actionValues) ? (actionValues as MetaAction[]) : [];

  // A conversão principal define qual família de compra usar; se for um tipo
  // fora da lista conhecida, procuramos por ele diretamente.
  const purchaseTypes = PURCHASE_TYPES.includes(primaryConversion)
    ? PURCHASE_TYPES
    : [primaryConversion, ...PURCHASE_TYPES];

  return {
    leads: pickFirst(list, LEAD_TYPES),
    conversions: pickFirst(list, purchaseTypes),
    conversionValue: pickFirst(values, purchaseTypes),
    linkClicks: pickFirst(list, LINK_CLICK_TYPES),
    landingPageViews: pickFirst(list, LANDING_PAGE_TYPES),
    thruPlays: pickFirst(list, THRUPLAY_TYPES)
  };
}

/** Lista os `action_type` presentes — útil para diagnosticar uma conta. */
export function listActionTypes(actions: unknown): string[] {
  if (!Array.isArray(actions)) return [];
  return (actions as MetaAction[]).map(a => a.action_type).filter(Boolean);
}
