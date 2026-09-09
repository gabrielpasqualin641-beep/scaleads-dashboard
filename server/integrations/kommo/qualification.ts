/**
 * Decide se um lead do CRM é MQL.
 *
 * O formulário da Meta entrega faixas de faturamento como texto — "De R$
 * 200.000,00 a R$ 500.000,00" — e não um número. Comparar texto com um limite
 * exigiria uma lista fixa de faixas conhecidas, que quebra em silêncio no dia
 * em que alguém editar o formulário: uma faixa nova cairia no `else` e viraria
 * "não é MQL" sem aviso.
 *
 * Em vez disso, extraímos o piso da faixa e comparamos com o limite. Faixa
 * nova continua sendo classificada corretamente, e texto que não dá para
 * interpretar vira `null` — indefinido, não "não" — para não inflar nem
 * deflacionar a contagem.
 */

/** Faturamento anual a partir do qual o lead conta como MQL. */
export const MQL_THRESHOLD = Number(process.env.KOMMO_MQL_THRESHOLD) || 200_000;

/** Converte "R$ 200.000,00" no número 200000. */
function parseBrCurrency(raw: string): number | null {
  const digits = raw.replace(/[^\d.,]/g, '');
  if (!digits) return null;
  // Formato brasileiro: ponto separa milhar, vírgula separa decimal.
  const normalized = digits.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Piso da faixa declarada.
 *
 * - "Até R$ 200.000,00"                    → 0      (o teto é 200k, o piso é zero)
 * - "De R$ 200.000,00 a R$ 500.000,00"     → 200000
 * - "Acima de R$ 500.000,00"               → 500000
 * - "350000"                               → 350000 (valor solto, se o campo virar aberto)
 */
export function floorOfRange(label: string): number | null {
  // Acento sai antes de comparar palavra. Em JS, a fronteira de palavra nao
  // enxerga letra acentuada como caractere de palavra, entao "Ate R$ 200.000,00"
  // escapava da regra do teto e o lead virava MQL - o oposto da verdade.
  const text = (label || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (!text) return null;

  const numbers = (text.match(/[\d.,]*\d/g) || [])
    .map(parseBrCurrency)
    .filter((n): n is number => n !== null);
  if (numbers.length === 0) return null;

  // "até X" / "menos de X" descrevem um teto: quem respondeu isso fatura
  // qualquer coisa abaixo de X, então o piso é zero.
  if (/^(at[eé]|menos de|abaixo de|up to)\b/.test(text)) return 0;

  // "de X a Y" e "entre X e Y" têm piso no menor dos dois.
  if (numbers.length >= 2) return Math.min(...numbers);

  // "acima de X", "mais de X", ou um número solto.
  return numbers[0];
}

export type Qualification = 'mql' | 'nao_mql' | 'indefinido';

export function qualify(label: string | null | undefined, threshold = MQL_THRESHOLD): Qualification {
  if (label === null || label === undefined || label.trim() === '') return 'indefinido';
  const floor = floorOfRange(label);
  if (floor === null) return 'indefinido';
  // A faixa que começa exatamente no limite conta: ela é a primeira acima da
  // faixa "até o limite", que é onde o cliente traçou a linha.
  return floor >= threshold ? 'mql' : 'nao_mql';
}
