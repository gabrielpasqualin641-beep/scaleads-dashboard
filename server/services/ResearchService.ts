import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { ProjectBrief, NormalizedMetrics } from '../models/types.js';
import { dataFile, ensureDataDir } from '../config/paths.js';

/**
 * Estudo de estratégia de mídia, gerado pela API da Claude com busca web.
 *
 * É conteúdo de opinião — pesquisa de mercado somada ao briefing e aos números
 * do período. Fica gravado com data e fontes, separado das métricas medidas, e
 * a interface o rotula como gerado por IA. Nunca entra nas telas de dados.
 */

const FILE = dataFile('research.json');

const MODEL = 'claude-opus-5';

export interface ResearchSource {
  title: string;
  url: string;
}

export interface ResearchStudy {
  clientId: string;
  /** Markdown com o estudo. */
  content: string;
  sources: ResearchSource[];
  generatedAt: string;
  generatedBy: string;
  model: string;
  /** Contexto usado, para o estudo ser auditável depois. */
  context: {
    periodLabel: string;
    spend: number | null;
    leads: number | null;
    cpl: number | null;
    briefSummary: string;
  };
  usage: { inputTokens: number; outputTokens: number; webSearches: number };
}

export function researchConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || '').trim();
}

const SYSTEM = `Você é um estrategista de mídia paga sênior, especializado em Meta Ads e Google Ads no mercado brasileiro.

Sua tarefa é produzir um estudo de estratégia para o projeto descrito, em português do Brasil.

REGRAS QUE NÃO PODEM SER QUEBRADAS:

1. Pesquise na web antes de recomendar. Baseie afirmações sobre formatos, políticas, benchmarks e recursos de plataforma em fontes que você consultou, e cite-as.

2. Separe claramente o que é fato verificado do que é sua recomendação. Se um benchmark de mercado veio de uma fonte, diga a fonte. Se é sua leitura profissional, diga que é leitura sua.

3. Sobre o Google Ads: você NÃO tem dados da conta Google deste cliente. Trate toda recomendação para Google como estratégia genérica de mercado para o nicho, e diga isso explicitamente na seção. Nunca escreva como se conhecesse o desempenho atual da conta Google.

4. Sobre a Meta: você recebe números reais do período. Use-os. Mas não invente métrica que não foi fornecida — se algo não está nos dados, diga que não está disponível em vez de estimar.

5. Não invente benchmark numérico. Se não encontrou um número confiável na pesquisa, diga que não encontrou.

FORMATO — markdown, nesta ordem:

## Leitura do cenário
O que os números do período dizem, em 2 a 3 parágrafos.

## Meta Ads — o que fazer
Recomendações concretas: estrutura de campanha, públicos, criativos, orçamento. Ancoradas nos números fornecidos.

## Google Ads — estratégia de entrada
Marcado como genérico. Que tipo de campanha faz sentido para este nicho e por quê.

## Riscos e o que observar
O que pode dar errado, e qual métrica acompanhar.

## Fontes
Lista do que você consultou.

Seja específico e direto. Sem enrolação, sem elogio ao projeto, sem repetir o briefing de volta.`;

/**
 * Traduz falhas da API em algo que o usuário consegue resolver.
 *
 * O SDK lança classes tipadas; a mensagem crua da Anthropic é técnica demais
 * para aparecer no painel.
 */
function toFriendlyError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error('A ANTHROPIC_API_KEY foi recusada. Verifique se a chave está correta e ativa no Console.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new Error('Limite de requisições da API atingido. Aguarde alguns instantes e tente de novo.');
  }
  if (err instanceof Anthropic.APIError) {
    const raw = String((err as { message?: string }).message || '');
    if (/credit balance is too low/i.test(raw)) {
      return new Error(
        'A conta da Anthropic está sem crédito. Adicione crédito em Plans & Billing no Console (console.anthropic.com) — a chave está válida, falta saldo.'
      );
    }
    return new Error(`A API respondeu com erro ${err.status}. ${raw.slice(0, 200)}`);
  }
  if (err instanceof Error) return err;
  return new Error('Falha inesperada ao gerar o estudo.');
}

function loadAll(): Record<string, ResearchStudy> {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch (err) {
    console.error('[ResearchService] Falha ao ler research.json:', err);
  }
  return {};
}

function saveAll(all: Record<string, ResearchStudy>): void {
  ensureDataDir();
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf-8');
}

function briefToText(brief: ProjectBrief | null): string {
  if (!brief) return 'Briefing não preenchido.';
  const linhas = [
    brief.description && `Projeto: ${brief.description}`,
    brief.offer && `Oferta e funil: ${brief.offer}`,
    brief.audience && `Público-alvo: ${brief.audience}`,
    brief.targetCpl && `CPL alvo: R$ ${brief.targetCpl.toFixed(2)}`,
    brief.targetCpa && `CAC alvo: R$ ${brief.targetCpa.toFixed(2)}`,
    brief.targetRoas && `ROAS alvo: ${brief.targetRoas}x`,
    brief.averageTicket && `Ticket médio: R$ ${brief.averageTicket.toFixed(2)}`,
    brief.monthlyBudget && `Verba mensal: R$ ${brief.monthlyBudget.toFixed(2)}`,
    brief.constraints && `Restrições: ${brief.constraints}`
  ].filter(Boolean);
  return linhas.join('\n');
}

export class ResearchService {
  public static get(clientId: string): ResearchStudy | null {
    return loadAll()[clientId] ?? null;
  }

  public static async generate(input: {
    clientId: string;
    clientName: string;
    brief: ProjectBrief | null;
    metrics: NormalizedMetrics;
    periodLabel: string;
    generatedBy: string;
  }): Promise<ResearchStudy> {
    if (!researchConfigured()) {
      throw new Error(
        'ANTHROPIC_API_KEY não está configurada no .env. Sem ela o painel não consegue pesquisar nem gerar o estudo.'
      );
    }

    const client = new Anthropic();
    const m = input.metrics;

    const disponivel = (metric: keyof NormalizedMetrics, valor: number, fmt: (v: number) => string) =>
      m.unavailable.includes(metric as never) ? 'não reportado pela Meta' : fmt(valor);

    const real = (v: number) => `R$ ${v.toFixed(2)}`;
    const inteiro = (v: number) => new Intl.NumberFormat('pt-BR').format(v);

    const prompt = `CLIENTE: ${input.clientName}

BRIEFING DO PROJETO
${briefToText(input.brief)}

NÚMEROS REAIS DA META NO PERÍODO (${input.periodLabel})
Investimento: ${disponivel('spend', m.spend, real)}
Impressões: ${disponivel('impressions', m.impressions, inteiro)}
Alcance: ${disponivel('reach', m.reach, inteiro)}
Frequência: ${disponivel('frequency', m.frequency, v => v.toFixed(2))}
Cliques: ${disponivel('clicks', m.clicks, inteiro)}
CTR: ${disponivel('ctr', m.ctr, v => v.toFixed(2) + '%')}
CPM: ${disponivel('cpm', m.cpm, real)}
Leads: ${disponivel('leads', m.leads, inteiro)}
CPL: ${disponivel('cpl', m.cpl, real)}
Receita atribuída: ${disponivel('revenue', m.revenue, real)}
ROAS: ${disponivel('roas', m.roas, v => v.toFixed(2) + 'x')}

MQL, agendamento e venda não são reportados nesta integração — não os estime.

Produza o estudo.`;

    let response;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        thinking: { type: 'adaptive' },
        tools: [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            // Teto de buscas: controla custo e evita pesquisa sem fim.
            max_uses: 8
          } as never
        ],
        messages: [{ role: 'user', content: prompt }]
      });
    } catch (err) {
      throw toFriendlyError(err);
    }

    // Erros de ferramenta de servidor voltam como bloco de resultado com HTTP 200,
    // não como exceção — por isso a varredura em vez de try/catch.
    const sources: ResearchSource[] = [];
    let webSearches = 0;
    let content = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if ((block as { type: string }).type === 'web_search_tool_result') {
        webSearches++;
        const results = (block as unknown as { content: unknown }).content;
        if (Array.isArray(results)) {
          for (const r of results as Array<{ title?: string; url?: string }>) {
            if (r.url && !sources.some(s => s.url === r.url)) {
              sources.push({ title: r.title || r.url, url: r.url });
            }
          }
        } else {
          console.warn('[ResearchService] Busca web retornou erro:', results);
        }
      }
    }

    if (!content.trim()) {
      throw new Error('A API respondeu sem texto. Tente novamente.');
    }

    const study: ResearchStudy = {
      clientId: input.clientId,
      content,
      sources,
      generatedAt: new Date().toISOString(),
      generatedBy: input.generatedBy,
      model: MODEL,
      context: {
        periodLabel: input.periodLabel,
        spend: m.unavailable.includes('spend') ? null : m.spend,
        leads: m.unavailable.includes('leads') ? null : m.leads,
        cpl: m.unavailable.includes('cpl') ? null : m.cpl,
        briefSummary: briefToText(input.brief).slice(0, 400)
      },
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        webSearches
      }
    };

    const all = loadAll();
    all[input.clientId] = study;
    saveAll(all);

    return study;
  }
}
