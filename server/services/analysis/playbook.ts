import {
  AnalysisAction,
  AnalysisBenchmark,
  AnalysisVerdict,
  CplBreakdown,
  MetricName,
  NormalizedMetrics
} from '../../models/types.js';

/**
 * Traduz o veredito num plano de ação concreto.
 *
 * A análise sabia dizer que o CPL estava alto, mas não onde mexer — e "melhore
 * o CPL" não é acionável. Aqui o CPL é decomposto na identidade que o forma:
 *
 *     CPL = CPM ÷ (1000 × CTR × conversão do clique em lead)
 *
 * Isso é aritmética, não modelo: as três pernas multiplicadas devolvem o CPL
 * observado. Com elas dá para dizer qual está fora da referência e quanto o CPL
 * cairia se só ela voltasse ao normal — que é a informação que decide onde
 * gastar a próxima hora de trabalho.
 *
 * As recomendações são determinísticas e cada uma carrega o número que a
 * sustenta. Nenhuma sugere ação que os dados não justifiquem: sem base, a lista
 * vem vazia em vez de repetir conselho genérico.
 */

function has(metrics: NormalizedMetrics, metric: MetricName): boolean {
  return !metrics.unavailable.includes(metric);
}

const money = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
const pct = (v: number) => `${v.toFixed(2).replace('.', ',')}%`;

/**
 * Decompõe o CPL e aponta a perna com maior ganho potencial.
 *
 * O gargalo não é simplesmente a perna "pior": é a que, trazida sozinha de
 * volta à referência, derruba mais o CPL. Uma perna 10% fora com peso grande
 * vale mais que outra 50% fora com peso pequeno.
 */
export function decomposeCpl(m: NormalizedMetrics, benchmark: AnalysisBenchmark): CplBreakdown | null {
  if (!has(m, 'cpl') || m.leads <= 0) return null;

  const cpm = has(m, 'cpm') ? m.cpm : null;
  const ctr = has(m, 'ctr') ? m.ctr : null;
  const clickToLead = has(m, 'clicks') && m.clicks > 0 ? (m.leads / m.clicks) * 100 : null;

  const candidatos: Array<{ perna: 'cpm' | 'ctr' | 'conversao'; cplCorrigido: number }> = [];

  // Cada simulação mexe em uma perna só e mantém as outras como estão.
  if (cpm !== null && benchmark.cpm !== null && cpm > benchmark.cpm) {
    candidatos.push({ perna: 'cpm', cplCorrigido: m.cpl * (benchmark.cpm / cpm) });
  }
  if (ctr !== null && ctr > 0 && benchmark.ctr !== null && ctr < benchmark.ctr) {
    candidatos.push({ perna: 'ctr', cplCorrigido: m.cpl * (ctr / benchmark.ctr) });
  }
  if (
    clickToLead !== null &&
    clickToLead > 0 &&
    benchmark.clickToLead !== null &&
    clickToLead < benchmark.clickToLead
  ) {
    candidatos.push({ perna: 'conversao', cplCorrigido: m.cpl * (clickToLead / benchmark.clickToLead) });
  }

  // Menor CPL corrigido = maior ganho.
  const melhor = candidatos.sort((a, b) => a.cplCorrigido - b.cplCorrigido)[0] ?? null;

  return {
    cpl: m.cpl,
    cpm,
    ctr,
    clickToLead: clickToLead === null ? null : Number(clickToLead.toFixed(1)),
    bottleneck: melhor?.perna ?? null,
    cplSeCorrigido: melhor ? Number(melhor.cplCorrigido.toFixed(2)) : null,
    ganhoPercentual: melhor ? Number((100 * (1 - melhor.cplCorrigido / m.cpl)).toFixed(0)) : null
  };
}

function acaoCpm(d: CplBreakdown, benchmark: AnalysisBenchmark): AnalysisAction {
  const acima = d.cpm !== null && benchmark.cpm !== null
    ? ` — ${(100 * (d.cpm / benchmark.cpm - 1)).toFixed(0)}% acima da referência de ${money(benchmark.cpm)}`
    : '';
  return {
    title: 'Baixar o custo de mídia (CPM)',
    why: `O CPM está em ${d.cpm !== null ? money(d.cpm) : 'N/D'}${acima}. ` +
      'CPM alto encarece cada lead sem que o anúncio ou o formulário tenham qualquer culpa: ' +
      'você paga mais caro para aparecer para a mesma pessoa.',
    steps: [
      'Confira a frequência: se a mesma pessoa vê o anúncio muitas vezes, o leilão cobra mais caro para continuar entregando. Público maior costuma derrubar o CPM.',
      'Abra os posicionamentos e veja o CPM por posicionamento. Feed costuma custar bem mais que Reels e Stories — se a entrega está concentrada no mais caro, vale testar deixar a Meta distribuir.',
      'Criativo cansado eleva CPM: quando a taxa de engajamento cai, o leilão pune. Subir criativo novo costuma reduzir o CPM antes mesmo de melhorar o CTR.',
      'Se estiver usando lance manual ou custo por resultado, verifique se o teto não está forçando a Meta a disputar só os inventários caros.'
    ],
    expectedImpact: d.cplSeCorrigido !== null && d.bottleneck === 'cpm'
      ? `Só trazer o CPM à referência levaria o CPL de ${money(d.cpl)} para ${money(d.cplSeCorrigido)} (−${d.ganhoPercentual}%).`
      : undefined
  };
}

function acaoCtr(d: CplBreakdown, benchmark: AnalysisBenchmark): AnalysisAction {
  return {
    title: 'Melhorar o CTR com teste de criativo',
    why: `O CTR está em ${d.ctr !== null ? pct(d.ctr) : 'N/D'}` +
      (benchmark.ctr !== null ? `, contra ${pct(benchmark.ctr)} de referência da conta` : '') +
      '. CTR baixo significa que a mensagem não está prendendo quem vê — você paga a impressão e não ganha o clique.',
    steps: [
      'Teste o gancho dos primeiros 3 segundos separadamente do resto: é ele que decide o clique. Suba 3 variações do mesmo criativo mudando só a abertura.',
      'Varie o formato antes de variar a oferta: estático contra vídeo costuma mudar o CTR mais do que reescrever a copy.',
      'Deixe cada variação acumular impressões suficientes antes de julgar — comparar criativos com poucas centenas de impressões é ler ruído.',
      'Olhe o CTR por posicionamento: um criativo vertical entregue em Feed costuma render bem menos que em Reels.'
    ],
    expectedImpact: d.cplSeCorrigido !== null && d.bottleneck === 'ctr'
      ? `Só trazer o CTR à média da conta levaria o CPL de ${money(d.cpl)} para ${money(d.cplSeCorrigido)} (−${d.ganhoPercentual}%).`
      : undefined
  };
}

function acaoConversao(d: CplBreakdown, benchmark: AnalysisBenchmark): AnalysisAction {
  return {
    title: 'Recuperar a conversão do clique em lead',
    why: `De cada 100 cliques, ${d.clickToLead !== null ? d.clickToLead.toFixed(0) : '?'} viram lead` +
      (benchmark.clickToLead !== null ? `, contra ${benchmark.clickToLead.toFixed(0)} na média da conta` : '') +
      '. Aqui o dinheiro já foi gasto no clique e se perde no formulário.',
    steps: [
      'Corte campos do formulário. Cada pergunta a mais derruba a conclusão, e campo que ninguém usa na qualificação só custa lead.',
      'Confira se a promessa do anúncio e a do formulário são a mesma: quem clica esperando uma coisa e encontra outra abandona.',
      'Se o formulário tem pergunta de qualificação, ela reduz volume de propósito — o que importa aí é o custo por lead qualificado, não o CPL bruto.',
      'Teste o formulário instantâneo contra o envio para site: no instantâneo a conversão costuma ser bem maior, ainda que o lead chegue menos qualificado.'
    ],
    expectedImpact: d.cplSeCorrigido !== null && d.bottleneck === 'conversao'
      ? `Só trazer a conversão à média da conta levaria o CPL de ${money(d.cpl)} para ${money(d.cplSeCorrigido)} (−${d.ganhoPercentual}%).`
      : undefined
  };
}

function acaoFrequencia(m: NormalizedMetrics): AnalysisAction {
  return {
    title: 'Ampliar o público — a entrega está saturando',
    why: `A frequência está em ${m.frequency.toFixed(2)}: a mesma pessoa já viu o anúncio várias vezes no período. ` +
      'Daqui para frente cada impressão nova custa mais e converte menos.',
    steps: [
      'Amplie a segmentação antes de trocar o criativo: com público pequeno, criativo novo satura de novo em poucos dias.',
      'Verifique exclusões acumuladas — listas de exclusão antigas costumam estreitar o público sem ninguém perceber.',
      'Se o público já é amplo, o caminho é renovar criativo: a saturação passa a ser de mensagem, não de audiência.'
    ]
  };
}

function acaoVolume(m: NormalizedMetrics, minimo: number): AnalysisAction {
  return {
    title: 'Esperar volume antes de decidir',
    why: `São ${m.leads} lead(s) no período, abaixo dos ${minimo} que sustentam uma leitura. ` +
      'Com essa amostra, a diferença entre um CPL bom e um ruim cabe dentro do acaso.',
    steps: [
      'Não corte nem escale por enquanto: as duas decisões seriam tomadas no ruído.',
      'Se precisa decidir logo, concentre orçamento em menos variações para cada uma acumular volume mais rápido.',
      'Olhe métricas de topo enquanto isso — CPM e CTR estabilizam com muito menos dados que o CPL.'
    ]
  };
}

function acaoCortar(m: NormalizedMetrics, benchmark: AnalysisBenchmark): AnalysisAction {
  const comparacao = benchmark.cpl !== null
    ? `${money(m.cpl)} contra ${money(benchmark.cpl)} de referência`
    : money(m.cpl);
  return {
    title: 'Cortar ou reconstruir',
    why: `O CPL está em ${comparacao}, com volume suficiente para a leitura ser confiável. ` +
      'Continuar investindo aqui é comprar lead caro tendo alternativa mais barata na mesma conta.',
    steps: [
      'Pause e redistribua o orçamento para o que está entregando abaixo da referência — a verba rende mais lá hoje.',
      'Antes de descartar de vez, verifique se o problema é o conjunto inteiro ou um criativo puxando a média: às vezes só um anúncio está afundando o resultado.',
      'Se a campanha tem propósito estratégico e não pode parar, reduza o orçamento em vez de pausar, e trate como teste e não como aquisição.'
    ]
  };
}

function acaoSemLead(m: NormalizedMetrics): AnalysisAction {
  return {
    title: 'Investigar por que não há lead nenhum',
    why: `Foram ${money(m.spend)} investidos sem um único lead. Isso raramente é performance ruim — costuma ser algo quebrado.`,
    steps: [
      'Teste o formulário você mesmo, do anúncio até o envio. Formulário com erro consome verba e não registra nada.',
      'Confira se o evento de lead está sendo recebido: se a Meta não registra, ela também não otimiza a entrega.',
      'Verifique se o anúncio está aprovado e entregando de fato — gasto sem entrega útil aparece igual a gasto sem conversão.'
    ]
  };
}

function acaoEscalar(m: NormalizedMetrics, benchmark: AnalysisBenchmark): AnalysisAction {
  return {
    title: 'Escalar com aumento gradual',
    why: `CPL de ${money(m.cpl)}` +
      (benchmark.cpl !== null ? `, abaixo da referência de ${money(benchmark.cpl)}` : '') +
      `, com ${m.leads} leads — volume suficiente para confiar no número.`,
    steps: [
      'Suba o orçamento em passos de cerca de 20% e espere estabilizar antes do próximo. Salto grande joga a campanha de volta em aprendizagem e o CPL sobe antes de cair.',
      'Acompanhe a frequência enquanto escala: o CPL costuma piorar quando o público começa a saturar, e é esse o teto real da escala.',
      'Duplicar o conjunto para outro público rende mais que empurrar orçamento no mesmo — evita competir consigo mesmo no leilão.'
    ]
  };
}

/**
 * Monta o plano de ação. A ordem importa: o gargalo com maior ganho vem
 * primeiro, porque é onde a próxima hora de trabalho rende mais.
 */
export function buildActions(
  verdict: AnalysisVerdict,
  m: NormalizedMetrics,
  benchmark: AnalysisBenchmark,
  diagnosis: CplBreakdown | null,
  minimoLeads: number,
  saturado: boolean
): AnalysisAction[] {
  const actions: AnalysisAction[] = [];

  if (verdict === 'cortar') {
    if (has(m, 'leads') && m.leads === 0) return [acaoSemLead(m)];
    actions.push(acaoCortar(m, benchmark));
  }

  if (verdict === 'escalar' && has(m, 'cpl')) actions.push(acaoEscalar(m, benchmark));
  if (verdict === 'observar') actions.push(acaoVolume(m, minimoLeads));
  if (saturado && has(m, 'frequency')) actions.push(acaoFrequencia(m));

  if (diagnosis && verdict !== 'observar') {
    // O gargalo primeiro; as outras pernas entram depois, se estiverem fora.
    const porPerna = {
      cpm: () => acaoCpm(diagnosis, benchmark),
      ctr: () => acaoCtr(diagnosis, benchmark),
      conversao: () => acaoConversao(diagnosis, benchmark)
    };
    if (diagnosis.bottleneck) actions.push(porPerna[diagnosis.bottleneck]());
  }

  return actions;
}

/**
 * O que estes dados sustentam, e o que não sustentam.
 *
 * Uma recomendação sem os seus limites convida a usá-la onde ela não vale.
 * Aqui cada afirmação vem com a base que a segura, e as perguntas que os dados
 * não respondem ficam escritas — em vez de a ausência ser confundida com
 * ausência de problema.
 */
export function buildEvidence(
  m: NormalizedMetrics,
  benchmark: AnalysisBenchmark,
  diagnosis: CplBreakdown | null,
  margem: number
): { supports: string[]; limits: string[] } {
  const supports: string[] = [];
  const limits: string[] = [];

  const leads = has(m, 'leads') ? m.leads : 0;

  if (diagnosis && Number.isFinite(margem) && benchmark.cpl !== null) {
    const gap = Math.abs(m.cpl / benchmark.cpl - 1) * 100;
    const lado = m.cpl < benchmark.cpl ? 'abaixo' : 'acima';
    if (gap > margem * 100) {
      supports.push(
        `CPL ${gap.toFixed(0)}% ${lado} da referência com ${leads} leads. A margem desse volume é ±${(margem * 100).toFixed(0)}%, ` +
        'então a diferença não se explica por acaso.'
      );
    } else {
      limits.push(
        `Não dá para afirmar que o CPL está ${lado} da referência: a diferença de ${gap.toFixed(0)}% ` +
        `cabe na margem de ±${(margem * 100).toFixed(0)}% que ${leads} leads permitem.`
      );
    }
  } else if (leads > 0) {
    limits.push(`Com ${leads} lead(s), o CPL observado não sustenta conclusão nenhuma sobre eficiência.`);
  }

  // CTR e CPM estabilizam com impressões, que costumam sobrar quando leads faltam.
  if (has(m, 'impressions') && m.impressions >= 1000 && has(m, 'ctr') && benchmark.ctr !== null) {
    const rel = m.ctr / benchmark.ctr;
    const comparativo = rel >= 1.3 ? 'acima da' : rel <= 0.7 ? 'abaixo da' : 'em linha com a';
    supports.push(
      `CTR de ${pct(m.ctr)} sobre ${m.impressions.toLocaleString('pt-BR')} impressões — ${comparativo} ` +
      `média da conta (${pct(benchmark.ctr)}). Impressão é o que não falta aqui, então essa leitura é firme.`
    );
  } else if (has(m, 'impressions') && m.impressions < 1000) {
    limits.push(
      `Só ${m.impressions.toLocaleString('pt-BR')} impressões: CTR e CPM ainda oscilam demais para comparar com outros criativos.`
    );
  }

  if (has(m, 'cpm') && benchmark.cpm !== null) {
    const rel = (m.cpm / benchmark.cpm - 1) * 100;
    if (Math.abs(rel) >= 15) {
      supports.push(
        `CPM de ${money(m.cpm)}, ${Math.abs(rel).toFixed(0)}% ${rel > 0 ? 'acima' : 'abaixo'} da referência de ${money(benchmark.cpm)}.`
      );
    }
  }

  if (!has(m, 'mqls')) {
    limits.push(
      'MQL não chega atribuído a esta entidade: dá para dizer qual criativo traz lead mais barato, ' +
      'não qual traz lead que presta. Os dois podem ser criativos diferentes.'
    );
  }

  if (!has(m, 'conversions') && !has(m, 'revenue')) {
    limits.push('Venda e receita não são reportadas nesta origem, então nada aqui alcança retorno — só custo de captação.');
  }

  return { supports, limits };
}
