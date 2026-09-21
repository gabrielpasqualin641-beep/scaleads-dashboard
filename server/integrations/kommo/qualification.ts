/**
 * Decide se um lead do CRM é MQL.
 *
 * O campo de faturamento tem um punhado de respostas possíveis, mas chega como
 * texto e em mais de um formato: "Até R$ 200.000,00" quando alguém digita no
 * CRM, "ate_r$_200.000,00" quando o conector do Facebook grava o valor cru do
 * formulário. Isso já produziu dois defeitos — um com acento, outro com
 * underscore — e nos dois casos o erro foi o mesmo: o texto não casou com o
 * padrão esperado e o código **adivinhou** um veredito, em vez de admitir que
 * não sabia. Um lead que declarou faturar até 200 mil foi contado como MQL.
 *
 * A defesa não é um regex melhor, é o sentido da falha. Aqui, forma que não
 * for reconhecida com certeza devolve `null` e o lead vira `indefinido`:
 * aparece separado no painel, alguém percebe e corrige. Palpite errado não
 * aparece — só contamina o número.
 */

/** Faturamento anual a partir do qual o lead conta como MQL. */
export const MQL_THRESHOLD = Number(process.env.KOMMO_MQL_THRESHOLD) || 200_000;

/**
 * Achata o texto até a forma comparável: sem acento, sem maiúscula, e com todo
 * separador (espaço, underscore, cifrão, pontuação) virando um espaço só.
 *
 * É o que faz "Até R$ 200.000,00" e "ate_r$_200.000,00" chegarem idênticos
 * aqui — os dois viram "ate r 200 000 00". Enquanto a comparação dependia do
 * caractere original, cada formato novo era uma chance de classificar ao
 * contrário.
 */
function flatten(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Converte "R$ 200.000,00" no número 200000. */
function parseBrCurrency(raw: string): number | null {
  const digits = raw.replace(/[^\d.,]/g, '');
  if (!digits) return null;
  // Formato brasileiro: ponto separa milhar, vírgula separa decimal.
  const normalized = digits.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Palavras que anunciam um teto — quem responde isso fatura menos que o valor. */
const CEILING = /(^|\s)(ate|menos|abaixo|inferior|up to|under)(\s|$)/;
/** Palavras que anunciam um piso. */
const FLOOR = /(^|\s)(acima|mais|superior|above|over|maior)(\s|$)/;
/** Palavras que anunciam um intervalo fechado. */
const BETWEEN = /(^|\s)(de|entre|from)(\s|$)/;
/**
 * Multiplicadores por extenso. Não são interpretados de propósito — ver o
 * comentário em `floorOfRange`.
 */
const SCALE_WORD = /(^|\s)(mil|milhao|milhoes|bilhao|bilhoes|k|kk|mi)(\s|$)/;

/**
 * Piso da faixa declarada, ou `null` quando não dá para afirmar.
 *
 * - "Até R$ 200.000,00"                → 0      (o teto é 200k, o piso é zero)
 * - "De R$ 200.000,00 a R$ 500.000,00" → 200000
 * - "Acima de R$ 500.000,00"           → 500000
 * - "350000"                           → 350000 (número puro, se o campo virar aberto)
 * - qualquer outra coisa               → null
 */
export function floorOfRange(label: string | null | undefined): number | null {
  if (!label) return null;
  const text = flatten(label);
  if (!text) return null;

  // Números saem do texto original, que preserva ponto e vírgula.
  const numbers = (label.match(/[\d.,]*\d/g) || [])
    .map(parseBrCurrency)
    .filter((n): n is number => n !== null);
  if (numbers.length === 0) return null;

  /*
   * Multiplicador por extenso muda a escala em mil vezes: "entre 300 e 500 mil"
   * não é 300, é 300.000 — a diferença entre não qualificar e qualificar.
   * Interpretar isso exigiria adivinhar a qual número o "mil" se aplica, então
   * recusamos: indefinido é visível, escala errada não.
   */
  if (SCALE_WORD.test(text)) return null;

  // Teto e piso na mesma frase não descrevem uma faixa, descrevem incerteza.
  if (CEILING.test(text) && FLOOR.test(text)) return null;

  // Teto vem primeiro: "até X" tem piso zero, mesmo com X no texto.
  if (CEILING.test(text)) return 0;

  // Intervalo: piso é o menor dos valores. Exige duas pontas de verdade.
  if (numbers.length >= 2 && (BETWEEN.test(text) || FLOOR.test(text))) {
    return Math.min(...numbers);
  }

  // Piso explícito: "acima de X", "mais de X".
  if (FLOOR.test(text) && numbers.length === 1) return numbers[0];

  /*
   * Número puro, sem palavra nenhuma em volta — o caso de um campo aberto onde
   * a pessoa digita o valor. Só vale se o texto for de fato só o número: se
   * houver palavra que não reconhecemos, não sabemos se ela nega, limita ou
   * qualifica o valor, e chutar já custou caro.
   */
  if (numbers.length === 1 && /^(r )?[\d ]+$/.test(text)) return numbers[0];

  return null;
}

export type Qualification = 'mql' | 'nao_mql' | 'indefinido';

export function qualify(label: string | null | undefined, threshold = MQL_THRESHOLD): Qualification {
  if (label === null || label === undefined || String(label).trim() === '') return 'indefinido';
  const floor = floorOfRange(label);
  if (floor === null) return 'indefinido';
  // A faixa que começa exatamente no limite conta: ela é a primeira acima da
  // faixa "até o limite", que é onde o cliente traçou a linha.
  return floor >= threshold ? 'mql' : 'nao_mql';
}

/* -------------------------------------------------------------------------- */
/* Qualificação por resposta de múltipla escolha                              */
/* -------------------------------------------------------------------------- */

/**
 * Nem toda conta qualifica o lead por faturamento. Há formulário em que o MQL
 * é uma resposta específica de múltipla escolha — por exemplo, a posição do
 * lead diante do valor do investimento ("estou pronto para investir" vs. "não
 * tenho condições agora"). Aqui não há faixa numérica a interpretar: cada
 * opção é um texto fixo, e o que decide é qual delas o lead marcou.
 *
 * A regra diz qual coluna carrega a resposta e quais respostas contam como MQL
 * e como não-MQL. O mesmo princípio da qualificação por faturamento vale: uma
 * resposta que não casa com nenhuma opção conhecida vira `indefinido` — nunca
 * um palpite —, para aparecer separada e ser corrigida em vez de contaminar o
 * número.
 */
export interface AnswerQualifier {
  kind: 'answer';
  /** Trecho que identifica a coluna da pergunta no cabeçalho da planilha. */
  columnIncludes: string;
  /** Trechos que, presentes na resposta, marcam o lead como MQL. */
  mqlIncludes: string[];
  /** Trechos das demais respostas conhecidas — reconhecidas, mas não-MQL. */
  naoMqlIncludes: string[];
}

export type LeadQualifier = { kind: 'faturamento' } | AnswerQualifier;

export function qualifyByAnswer(answer: string | null | undefined, rule: AnswerQualifier): Qualification {
  if (answer === null || answer === undefined || String(answer).trim() === '') return 'indefinido';
  const text = flatten(String(answer));
  if (!text) return 'indefinido';
  const hits = (needles: string[]) => needles.some(n => text.includes(flatten(n)));
  if (hits(rule.mqlIncludes)) return 'mql';
  if (hits(rule.naoMqlIncludes)) return 'nao_mql';
  // Resposta fora do conjunto conhecido: indefinido, não palpite.
  return 'indefinido';
}

/** Função de veredito da conta, a partir da regra dela (faturamento por padrão). */
export function qualifierFn(rule?: LeadQualifier): (answer: string | null | undefined) => Qualification {
  if (rule && rule.kind === 'answer') return answer => qualifyByAnswer(answer, rule);
  return answer => qualify(answer);
}

/**
 * Predicado que encontra, no cabeçalho, a coluna que carrega a resposta usada
 * para qualificar. Faturamento por padrão; a regra de resposta aponta a sua.
 */
export function qualifierColumn(rule?: LeadQualifier): (header: string) => boolean {
  const needle = rule && rule.kind === 'answer' ? flatten(rule.columnIncludes) : 'faturamento';
  return header => flatten(header).includes(needle);
}
