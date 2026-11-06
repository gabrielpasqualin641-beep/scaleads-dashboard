/**
 * Regras determinísticas que NÃO dependem do modelo.
 * Entrada: detecta opt-out, risco, menor de idade, reembolso e pergunta "é robô?".
 * Saída: bloqueia promessas, urgência falsa, remédios, conteúdo explícito, diagnóstico e links sem rastreamento.
 */
import type { Channel } from "../domain/types.js";
import { extractUrls, hasRequiredTracking, isCheckoutUrl, withTracking } from "./links.js";

export function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s?!.,:/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (t: string) => t.split(/\s+/).filter(Boolean);

// ---------- Entrada ----------

export type OptoutChannel = "whatsapp" | "voz" | "todos";

export function detectOptout(text: string, channel: Channel): OptoutChannel | null {
  const t = norm(text).replace(/[?!.,]/g, "");
  const w = words(t);
  const mentionsCall = /\b(liga|ligar|ligue|ligacao|ligacoes|telefone|telefonema)\b/.test(t);
  const short = w.length <= 4;
  const isOptout =
    (short && /^(para|pare|parar|sai|sair|chega|stop|cancelar|cancela|nao quero|nao obrigado nao quero)$/.test(t)) ||
    /^(nao|n) quero( mais| nada| isso| obrigado| nao| contato)?( obrigado)?$/.test(t) ||
    /\bnao quero (mais|receber|contato|mensage\w*|que (me )?(liguem|ligue|mandem|chamem))\b/.test(t) ||
    /\bnao me (liga|ligue|ligar|ligem|liguem|chama|chame|mande|manda|procure|procura)\b/.test(t) ||
    /\b(para|pare|parem) de (me )?(mandar|ligar|chamar|enviar|encher|incomodar)\b/.test(t) ||
    /\b(me )?(tira|tire|remove|remova|exclui|exclua) (da lista|meu numero|meu contato|meus dados)\b/.test(t) ||
    /\bdescadastr/.test(t) ||
    /\bnao (entre|entrem) mais em contato\b/.test(t);
  if (!isOptout) return null;
  // "não me liga mais" bloqueia só a voz; "não quero mais", "para", "sai" bloqueiam tudo.
  void channel;
  return mentionsCall ? "voz" : "todos";
}

export function detectCrisis(text: string): boolean {
  const t = norm(text);
  return /\b(quero morrer|vou me matar|me matar|suicid\w*|tirar (a )?minha (propria )?vida|acabar com (a )?minha vida|acabar com tudo|nao (aguento|aguentar) mais (viver|essa vida|isso tudo)|nao quero mais viver|melhor (eu )?morrer|sem saida|me machucar|me cortar|nao vejo sentido (em|na) (viver|vida)|desisti de viver|quero sumir|queria sumir|pensando em me matar|nao vale a pena viver|nao tenho motivo pra viver|ninguem vai sentir minha falta)\b/.test(
    t,
  );
}

export function detectMinor(text: string): boolean {
  const t = norm(text);
  if (/\b(sou|eu sou) (menor|de menor)( de idade)?\b/.test(t)) return true;
  if (/\b(tenho|faco|fiz|tô com|to com|estou com) (1[0-7]|[1-9]) anos\b/.test(t)) return true;
  if (/\b(1[0-7]) anos\b/.test(t) && /\b(tenho|idade|sou)\b/.test(t)) return true;
  if (/\b(estou|to|tô) no (ensino medio|[1-9]o ano|colegial|fundamental)\b/.test(t)) return true;
  if (/\b(meus pais|minha mae|meu pai) (nao )?(podem|pode|vao|vai) (saber|descobrir|ver)\b/.test(t)) return true;
  return false;
}

export function detectRefund(text: string): boolean {
  const t = norm(text);
  return /\b(reembols\w*|estorn\w*|devolu\w* (do|o) dinheiro|devolver (o )?(meu )?dinheiro|quero (o )?meu dinheiro|cancelar (a |minha )?compra|chargeback|garantia de 7 dias.*(usar|acionar|pedir))\b/.test(t);
}

export function detectRobotQuestion(text: string): boolean {
  const t = norm(text);
  return /\b(e|eh|voce e|vc e|tu e|isso e|to falando com|estou falando com|falo com)( um| uma)? (robo|bot|maquina|ia|inteligencia artificial|chatbot|gravacao)\b/.test(t) ||
    /\b(robo|bot)\s*\?/.test(t) ||
    /\b(pessoa de verdade|ser humano|humano de verdade)\s*\?/.test(t);
}

/** "É o Marlon? É o doutor? É com o senhor mesmo?": a resposta é sempre a verdade (assistente virtual). */
export function detectMarlonQuestion(text: string): boolean {
  const t = norm(text);
  return (
    /\b(e|eh|seria) (o|com o) (dr\.?|doutor|marlon|proprio marlon)(\s|\b)[^?]{0,40}\?/.test(t) ||
    /\b(falo|falando|to falando|estou falando|tou falando) com o (dr\.?|doutor|marlon|proprio marlon)(\s|\b)/.test(t) ||
    /\b(e|eh) (com )?o senhor mesmo\b/.test(t) ||
    /\bquem (e|esta) (que )?(me )?(respondendo|falando)( aqui)?\s*\?/.test(t)
  );
}

/** Mensagens prontas das páginas e do site: viram contexto para a IA. */
export function detectEntryOrigin(text: string): "pagina_leao" | "suporte_controle2" | "consulta_site" | null {
  const t = norm(text);
  if (/estou na pagina do treino do leao/.test(t)) return "pagina_leao";
  if (/(suporte do treino controle 2\.0|estou no treino controle 2\.0 e preciso)/.test(t)) return "suporte_controle2";
  if (/sexosemduvida\.com.*consultas? online/.test(t)) return "consulta_site";
  return null;
}

export function detectHumanRequest(text: string): boolean {
  const t = norm(text);
  return /\b(falar com (o )?(marlon|atendente|humano|alguem|pessoa|equipe)|quero (um )?(atendente|humano))\b/.test(t);
}

export function detectMedicationTopic(text: string): boolean {
  return MED_RE.test(norm(text));
}

// ---------- Saída ----------

const MED_RE =
  /\b(viagra|sildenafil\w*|tadalafil\w*|cialis|vardenafil\w*|levitra|dapoxetin\w*|priligy|sertralin\w*|paroxetin\w*|fluoxetin\w*|clomipramin\w*|lidocain\w*|benzocain\w*|antidepressiv\w*|ansiolitic\w*|rivotril|clonazepam|\d+ ?mg\b|miligrama\w*|comprimido\w*|dosagem|posologia)\b/;

/** Porcentagens que existem na base científica (agent/knowledge/ciencia.md). Qualquer outra é bloqueada. */
export const ALLOWED_PERCENTS = new Set(["20", "30", "30.3", "82.5", "54"]);

/** Frases que soam como robô (o prompt proíbe; a suíte live verifica). */
export const ROBOTIC_PHRASES = [
  /entendi,? obrigad[oa] por me contar/,
  /(^|[.!?|]\s*)faz sentido\.(\s|$)/,
  /\beu indicaria\b/,
  /\bcomo posso te ajudar\?/,
  /\bposso te ajudar em algo\?/,
  /\bfico a disposicao\b/,
  /\botima pergunta\b/,
  /\bagradeco o contato\b/,
];

export function roboticPhrases(text: string): string[] {
  const t = norm(text);
  return ROBOTIC_PHRASES.filter((re) => re.test(t)).map((re) => re.source);
}

export interface Violation {
  rule: string;
  excerpt: string;
}

const OUTPUT_RULES: Array<{ rule: string; re: RegExp }> = [
  { rule: "promessa de cura", re: /\b(cura|curar|curado|curada|cura definitiva)\b/ },
  { rule: "promessa de resultado", re: /\b(garanto|garantimos|garante|garantem|garantido|garantida|com certeza (vai|voce vai)|100 ?%|sem falha|resultado certo|resolve de vez|vai resolver|nunca mais vai)\b/ },
  { rule: "promessa de tempo", re: /\b(durar|dure|aguentar) (mais )?(\d+|dez|vinte|trinta|varios|muitos) (min|minutos)\b|\bem \d+ dias (voce|vc) (vai|estara)\b/ },
  { rule: "prazo atribuido ao produto", re: /\bem (\d+|uma|duas|tres|quatro|poucas|algumas) (semanas?|dias|meses|mes) (voce|vc|tu) (ja )?(vai|vai estar|vai ter|vai conseguir|consegue|estara|tera)\b/ },
  { rule: "urgencia falsa", re: /\b(ultimas vagas|ultima vaga|so hoje|somente hoje|apenas hoje|acaba hoje|por tempo limitado|corre que|oferta relampago|vagas limitadas)\b/ },
  { rule: "desconto ou bonus inventado", re: /\b(cupom|bonus|brinde|desconto (especial|exclusivo|de \d+)|\d+ ?% (de )?(off|desconto))\b/ },
  { rule: "medicamento", re: MED_RE },
  { rule: "diagnostico", re: /\b(voce tem|vc tem|seu caso e|o seu problema e|seu diagnostico|isso e (um caso de|sintoma de)|voce sofre de) (ejaculacao|disfuncao|transtorno|ansiedade generalizada|depressao|tdah|impotencia)\b/ },
  { rule: "conteudo explicito", re: /\b(penis|pinto|pau|buceta|gozar|gozo|transar|foder|sexo oral|masturba\w*|ereto|erecao forte)\b/ },
];

const SAFE_NEGATIONS = /\b(nao (falo|posso falar|indico|recomendo|trato)|isso e com (um|o) medico|nao (prometo|existe promessa|garanto)|nao tem como garantir|nao da pra prometer|resultados variam)\b/;

export function checkOutput(text: string, channel: Channel): Violation[] {
  const t = norm(text);
  const out: Violation[] = [];
  for (const { rule, re } of OUTPUT_RULES) {
    const m = t.match(re);
    if (!m) continue;
    // "não prometo cura", "remédio é com o médico" etc. são permitidos.
    if ((rule === "promessa de cura" || rule === "promessa de resultado" || rule === "medicamento") && isNegatedContext(t, m.index ?? 0)) continue;
    out.push({ rule, excerpt: m[0] });
  }
  for (const url of extractUrls(text)) {
    if (channel === "voz") out.push({ rule: "link falado na ligacao", excerpt: url });
    else if (isCheckoutUrl(url) && !hasRequiredTracking(url)) out.push({ rule: "link sem sck=f4-ia", excerpt: url });
  }
  // Números: só as porcentagens da base científica; e nenhum número de estudo atribuído aos produtos.
  const raw = text.toLowerCase();
  for (const m of raw.matchAll(/(\d+(?:[.,]\d+)?)\s?%/g)) {
    const n = m[1].replace(",", ".");
    if (!ALLOWED_PERCENTS.has(n)) out.push({ rule: "numero nao autorizado", excerpt: m[0] });
  }
  const prodRe = /(controle 2\.0|controle express|controle2|express|treino|m[ée]todo do marlon|o m[ée]todo|o curso|o programa)/;
  for (const sentence of raw.split(/(?<=[.!?])\s+|\n+/)) {
    if (prodRe.test(sentence) && /\d+(?:[.,]\d+)?\s?%|\d+(?:[.,]\d+)? por cento/.test(sentence) && !/\b(estudo|levantamento|pesquisa)\b/.test(sentence)) {
      out.push({ rule: "resultado atribuido ao produto", excerpt: sentence.trim().slice(0, 80) });
    } else if (prodRe.test(sentence) && /\b\d+(?:[.,]\d+)?\s?% de (sucesso|eficacia|eficácia|resultado|melhora|acerto)/.test(sentence)) {
      out.push({ rule: "resultado atribuido ao produto", excerpt: sentence.trim().slice(0, 80) });
    }
  }
  if (channel === "voz") {
    const long = text.split(/(?<=[.!?])\s+/).find((s) => words(s).length > 20);
    if (long) out.push({ rule: "frase longa demais para voz", excerpt: long.slice(0, 60) });
  }
  return out;
}

function isNegatedContext(t: string, idx: number): boolean {
  const window = t.slice(Math.max(0, idx - 50), idx + 40);
  return SAFE_NEGATIONS.test(window) || /\b(nao|ninguem|nenhum|nenhuma|nunca)\b[^.!?]{0,30}$/.test(t.slice(Math.max(0, idx - 30), idx));
}

/** Corrige o que é corrigível sem o modelo: links de checkout ganham o rastreamento. */
export function autoFixOutput(text: string, channel: Channel): string {
  let fixed = text;
  for (const url of extractUrls(text)) {
    if (channel === "whatsapp" && isCheckoutUrl(url) && !hasRequiredTracking(url)) {
      fixed = fixed.replace(url, withTracking(url, channel));
    }
  }
  if (channel === "voz") fixed = fixed.replace(/https?:\/\/\S+/g, "o link que eu te mando no WhatsApp");
  return fixed;
}

/** Quebra frases longas de voz em frases de no máximo 20 palavras. */
export function shortenForVoice(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .flatMap((s) => {
      const w = words(s);
      if (w.length <= 20) return [s];
      const parts: string[] = [];
      for (let i = 0; i < w.length; i += 18) parts.push(w.slice(i, i + 18).join(" "));
      return parts.map((p, i) => (i < parts.length - 1 && !/[.!?]$/.test(p) ? `${p}.` : p));
    })
    .join(" ");
}

export function mentionsVirtualAssistant(text: string): boolean {
  return /assistente virtual/.test(norm(text));
}

/** Palavras que NÃO podem aparecer em mensagens neutras (pré-visualização, recado, terceiro). */
export const SENSITIVE_TOPIC_RE =
  /\b(ejacula\w*|precoce|sexual\w*|sexo|impot\w*|disfunc\w*|ere(c|ç)\w*|controle 2|controle express|treino|ansiedade|psicoterapia|terapia|consulta)\b/;

export function isNeutral(text: string): boolean {
  return !SENSITIVE_TOPIC_RE.test(norm(text));
}
