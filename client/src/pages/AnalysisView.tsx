import React, { useEffect, useState } from 'react';
import { TrendingUp, Wrench, Scissors, Eye, HelpCircle, Info, ChevronDown, ChevronRight, Target } from 'lucide-react';
import { AnalysisResponse, AnalysisItem, AnalysisVerdict } from '../types';
import { api } from '../services/api';
import { useClient } from '../context/ClientContext';
import { usePeriod } from '../context/PeriodContext';
import { TableSkeleton } from '../components/common/Skeletons';
import { ErrorState } from '../components/common/ErrorState';
import { StatusBadge } from '../components/common/StatusBadge';

const VERDICTS: Record<
  AnalysisVerdict,
  { label: string; color: string; bg: string; icon: React.ReactNode; hint: string }
> = {
  escalar: {
    label: 'Escalar',
    color: 'var(--good)',
    bg: 'var(--good-bg)',
    icon: <TrendingUp size={14} />,
    hint: 'CPL confortavelmente abaixo da referência, com volume que sustenta a leitura.'
  },
  otimizar: {
    label: 'Otimizar',
    color: 'var(--accent-blue)',
    bg: 'var(--accent-blue-light)',
    icon: <Wrench size={14} />,
    hint: 'Funciona, mas há folga: CPL perto do limite, CTR fraco ou público saturando.'
  },
  cortar: {
    label: 'Cortar',
    color: 'var(--bad)',
    bg: 'var(--bad-bg)',
    icon: <Scissors size={14} />,
    hint: 'CPL muito acima da referência com volume relevante, ou gasto sem lead algum.'
  },
  observar: {
    label: 'Observar',
    color: 'var(--muted)',
    bg: 'var(--border-subtle)',
    icon: <Eye size={14} />,
    hint: 'Volume baixo demais para decidir. Deixe rodar ou aumente o orçamento para gerar amostra.'
  },
  sem_dados: {
    label: 'Sem dados',
    color: 'var(--muted)',
    bg: 'var(--border-subtle)',
    icon: <HelpCircle size={14} />,
    hint: 'A Meta não reportou leads para esta entidade no período.'
  }
};

const money = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const num = (v: number) => new Intl.NumberFormat('pt-BR').format(v || 0);

export const AnalysisView: React.FC = () => {
  const { selectedClient, selectedAccountId } = useClient();
  const { preset, startDate, endDate, includeMetaTax } = usePeriod();
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<AnalysisItem['level']>('campaign');
  // Clicar num card de veredito filtra a lista; clicar de novo limpa o filtro.
  const [verdictFilter, setVerdictFilter] = useState<AnalysisVerdict | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);

  const load = async () => {
    if (!selectedClient) return;
    try {
      setLoading(true);
      setError(null);
      setData(await api.getAnalysis(selectedClient.id, selectedAccountId, { preset, startDate, endDate, includeMetaTax }));
    } catch (err: any) {
      setError(err.message || 'Erro ao gerar a análise');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [selectedClient, selectedAccountId, preset, startDate, endDate, includeMetaTax]);

  if (loading && !data) return <TableSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const items = data.items.filter(i => i.level === level && (verdictFilter === null || i.verdict === verdictFilter));
  const ordem: AnalysisVerdict[] = ['cortar', 'escalar', 'otimizar', 'observar', 'sem_dados'];
  const ordenados = [...items].sort(
    (a, b) => ordem.indexOf(a.verdict) - ordem.indexOf(b.verdict) || b.metrics.spend - a.metrics.spend
  );

  const refLabel =
    data.benchmark.cplSource === 'meta_do_briefing'
      ? 'meta do briefing'
      : data.benchmark.cplSource === 'media_da_conta'
        ? 'média da conta'
        : 'indisponível';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">Análise de Campanhas</h2>
          <p className="page-description">
            Classificação por regras sobre os números reais do período. Cada veredito mostra a métrica que o
            disparou — confira a conta em vez de confiar.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['campaign', 'adset', 'ad'] as const).map(l => (
            <button
              key={l}
              type="button"
              className={`btn btn-sm ${level === l ? 'btn-active' : ''}`}
              onClick={() => setLevel(l)}
            >
              {l === 'campaign' ? 'Campanhas' : l === 'adset' ? 'Conjuntos' : 'Anúncios'}
            </button>
          ))}
        </div>
      </div>

      {/* Referência usada */}
      <div className="card" style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <Info size={15} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
        <span style={{ fontSize: '12.5px', color: 'var(--ink)' }}>
          Referência de CPL:{' '}
          <b>{data.benchmark.cpl !== null ? money(data.benchmark.cpl) : 'indisponível'}</b>{' '}
          <span style={{ color: 'var(--muted)' }}>({refLabel})</span>
          {data.benchmark.cplSource === 'media_da_conta' && (
            <span style={{ color: 'var(--muted)' }}> · defina o CPL alvo na aba Projeto para uma leitura de negócio</span>
          )}
        </span>
      </div>

      {/* Resumo por veredito */}
      <div className="kpi-grid">
        {ordem.map(v => {
          const cfg = VERDICTS[v];
          const count =
            v === 'sem_dados' ? data.summary.semDados : (data.summary as Record<string, number>)[v] ?? 0;
          return (
            <button
              key={v}
              type="button"
              className={`kpi-card verdict-card ${verdictFilter === v ? 'is-active' : ''}`}
              title={cfg.hint}
              disabled={count === 0}
              onClick={() => setVerdictFilter(verdictFilter === v ? null : v)}
              style={{ borderColor: verdictFilter === v ? cfg.color : undefined }}
            >
              <div className="kpi-header">
                <span className="kpi-label" style={{ color: cfg.color }}>
                  {cfg.label}
                </span>
                {cfg.icon}
              </div>
              <div className="kpi-val" style={{ color: cfg.color }}>{count}</div>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                {count === 0 ? 'nenhuma' : verdictFilter === v ? 'mostrando · clique para limpar' : 'ver o que fazer'}
              </div>
            </button>
          );
        })}
      </div>

      {data.summary.spendEmCorte > 0 && (
        <div
          className="card"
          style={{
            padding: '13px 16px',
            borderColor: 'var(--bad)',
            backgroundColor: 'var(--bad-bg)',
            color: 'var(--bad)',
            fontSize: '13px',
            fontWeight: 700
          }}
        >
          {money(data.summary.spendEmCorte)} do investimento do período está em campanhas marcadas para corte.
        </div>
      )}

      {/* Lista */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {ordenados.length === 0 && (
          <div className="card" style={{ padding: '22px', textAlign: 'center', color: 'var(--muted)', fontSize: '12.5px' }}>
            Nenhuma entidade neste nível no período selecionado.
          </div>
        )}

        {ordenados.map(item => {
          const cfg = VERDICTS[item.verdict];
          return (
            <div key={`${item.level}-${item.id}`} className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    backgroundColor: cfg.bg,
                    color: cfg.color,
                    fontSize: '11.5px',
                    fontWeight: 800,
                    flexShrink: 0
                  }}
                >
                  {cfg.icon} {cfg.label}
                </span>

                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--ink)' }}>{item.name}</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '2px' }}>
                    {item.accountName} · <StatusBadge status={item.status} size={11} /> ·{' '}
                    {(item.spendShare * 100).toFixed(1)}% do investimento
                  </div>
                </div>

                <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--muted)' }} className="tabular-nums">
                  <div><b style={{ color: 'var(--ink)' }}>{money(item.metrics.spend)}</b> investidos</div>
                  <div>{num(item.metrics.leads)} leads · CPL {money(item.metrics.cpl)}</div>
                </div>
              </div>

              <div style={{ fontSize: '12.5px', color: 'var(--ink)', fontWeight: 600 }}>{item.rationale}</div>

              {item.signals.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
                  {item.signals.map((s, idx) => (
                    <span
                      key={idx}
                      style={{
                        fontSize: '11px',
                        padding: '4px 9px',
                        borderRadius: '7px',
                        border: '1px solid var(--border)',
                        color:
                          s.direction === 'good' ? 'var(--good)' : s.direction === 'bad' ? 'var(--bad)' : 'var(--muted)'
                      }}
                      className="tabular-nums"
                    >
                      {s.label}
                      {s.value !== null && (
                        <b style={{ marginLeft: '5px' }}>
                          {s.metric === 'volume' ? num(s.value) : s.metric === 'ctr' ? `${s.value.toFixed(2)}%` : s.metric === 'frequency' ? s.value.toFixed(2) : money(s.value)}
                        </b>
                      )}
                      {s.reference !== null && (
                        <span style={{ color: 'var(--muted)' }}>
                          {' '}/ ref{' '}
                          {s.metric === 'volume' ? num(s.reference) : s.metric === 'ctr' ? `${s.reference.toFixed(2)}%` : s.metric === 'frequency' ? s.reference.toFixed(2) : money(s.reference)}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}

              {(item.diagnosis || item.actions.length > 0) && (
                <>
                  <button
                    type="button"
                    className="plan-toggle"
                    onClick={() => setOpenItem(openItem === item.id ? null : item.id)}
                  >
                    {openItem === item.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {openItem === item.id ? 'Fechar o plano' : `O que fazer${item.actions.length ? ` · ${item.actions.length} ação(ões)` : ''}`}
                  </button>

                  {openItem === item.id && (
                    <div className="plan-body">
                      {item.diagnosis && (
                        <div className="plan-diagnosis">
                          <div className="plan-section-title">Onde o CPL se quebra</div>
                          <div className="plan-formula">
                            CPL {money(item.diagnosis.cpl)} = CPM {item.diagnosis.cpm !== null ? money(item.diagnosis.cpm) : 'N/D'}
                            {' ÷ ('}CTR {item.diagnosis.ctr !== null ? `${item.diagnosis.ctr.toFixed(2)}%` : 'N/D'}
                            {' × '}conversão do clique {item.diagnosis.clickToLead !== null ? `${item.diagnosis.clickToLead.toFixed(1)}%` : 'N/D'}
                            {')'}
                          </div>
                          {item.diagnosis.bottleneck && item.diagnosis.cplSeCorrigido !== null ? (
                            <div className="plan-bottleneck">
                              <Target size={13} />
                              <span>
                                Maior alavanca: <b>{
                                  item.diagnosis.bottleneck === 'cpm' ? 'o CPM'
                                    : item.diagnosis.bottleneck === 'ctr' ? 'o CTR'
                                    : 'a conversão do clique'
                                }</b>. Corrigindo só ele, o CPL iria para <b>{money(item.diagnosis.cplSeCorrigido)}</b>
                                {item.diagnosis.ganhoPercentual !== null && ` (−${item.diagnosis.ganhoPercentual}%)`}.
                              </span>
                            </div>
                          ) : (
                            <div className="plan-bottleneck" style={{ color: 'var(--muted)' }}>
                              <Target size={13} />
                              <span>As três alavancas estão na referência ou acima — não há gargalo isolado a atacar.</span>
                            </div>
                          )}
                        </div>
                      )}

                      {item.actions.map((a, i) => (
                        <div key={i} className="plan-action">
                          <div className="plan-action-title">{i + 1}. {a.title}</div>
                          <div className="plan-action-why">{a.why}</div>
                          <ul className="plan-steps">
                            {a.steps.map((st, j) => <li key={j}>{st}</li>)}
                          </ul>
                          {a.expectedImpact && <div className="plan-impact">{a.expectedImpact}</div>}
                        </div>
                      ))}

                      {item.actions.length === 0 && (
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          Os dados não sustentam nenhuma recomendação específica para esta entidade.
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Limitações */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: '11.5px', fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '7px' }}>
          O que esta análise não alcança
        </div>
        <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {data.limitacoes.map((l, i) => (
            <li key={i} style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.5 }}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};
