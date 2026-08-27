import React, { useEffect, useState } from 'react';
import { Globe, Sparkles, Loader2, AlertCircle, ExternalLink, KeyRound } from 'lucide-react';
import { ResearchStudy } from '../../types';
import { api } from '../../services/api';
import { useClient } from '../../context/ClientContext';
import { usePeriod } from '../../context/PeriodContext';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../utils/permissions';

/**
 * Estudo de estratégia gerado por IA com pesquisa na web.
 *
 * Fica deliberadamente marcado e visualmente distinto das telas de métrica:
 * é opinião pesquisada, não dado medido. Traz data, modelo, fontes e o
 * contexto numérico usado, para dar para auditar depois.
 */

/** Markdown mínimo: títulos, negrito, listas. Evita dependência nova. */
function renderMarkdown(md: string): React.ReactNode {
  const blocks = md.split('\n');
  return blocks.map((line, i) => {
    const bold = (text: string) =>
      text.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
        part.startsWith('**') && part.endsWith('**') ? <b key={j}>{part.slice(2, -2)}</b> : part
      );

    if (line.startsWith('## ')) {
      return (
        <h3 key={i} style={{ fontSize: '14px', fontWeight: 800, color: 'var(--ink)', marginTop: i === 0 ? 0 : '18px', marginBottom: '6px' }}>
          {line.slice(3)}
        </h3>
      );
    }
    if (line.startsWith('### ')) {
      return (
        <h4 key={i} style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--ink)', marginTop: '12px', marginBottom: '4px' }}>
          {line.slice(4)}
        </h4>
      );
    }
    if (/^[-*] /.test(line)) {
      return (
        <li key={i} style={{ fontSize: '13px', color: 'var(--ink)', lineHeight: 1.6, marginLeft: '18px' }}>
          {bold(line.slice(2))}
        </li>
      );
    }
    if (/^\d+\. /.test(line)) {
      return (
        <li key={i} style={{ fontSize: '13px', color: 'var(--ink)', lineHeight: 1.6, marginLeft: '18px' }}>
          {bold(line.replace(/^\d+\.\s/, ''))}
        </li>
      );
    }
    if (!line.trim()) return <div key={i} style={{ height: '7px' }} />;
    return (
      <p key={i} style={{ fontSize: '13px', color: 'var(--ink)', lineHeight: 1.65, margin: 0 }}>
        {bold(line)}
      </p>
    );
  });
}

export const ResearchPanel: React.FC = () => {
  const { selectedClient, selectedAccountId } = useClient();
  const { preset, startDate, endDate, includeMetaTax } = usePeriod();
  const { user } = useAuth();

  const [configured, setConfigured] = useState(false);
  const [study, setStudy] = useState<ResearchStudy | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!selectedClient) return;
    try {
      setLoading(true);
      const res = await api.getResearch(selectedClient.id);
      setConfigured(res.configured);
      setStudy(res.study);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar o estudo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [selectedClient]);

  const handleGenerate = async () => {
    if (!selectedClient || generating) return;
    setGenerating(true);
    setError(null);
    try {
      setStudy(await api.generateResearch(selectedClient.id, selectedAccountId, { preset, startDate, endDate, includeMetaTax }));
    } catch (err: any) {
      setError(err.message || 'Erro ao gerar o estudo');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return null;

  return (
    <div className="card" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <Globe size={16} style={{ color: 'var(--accent-blue)' }} />
        <h3 style={{ fontSize: '14px', fontWeight: 800, flex: 1 }}>Estudo de estratégia (Meta e Google)</h3>

        {configured && can.editData(user) && (
          <button type="button" className="btn btn-primary" onClick={handleGenerate} disabled={generating} style={{ gap: '6px' }}>
            {generating ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            <span>{generating ? 'Pesquisando...' : study ? 'Gerar novo estudo' : 'Gerar estudo'}</span>
          </button>
        )}
      </div>

      {!configured && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '11px 13px', borderRadius: '9px', border: '1px solid var(--border)', backgroundColor: 'var(--bg)' }}>
          <KeyRound size={15} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: '1px' }} />
          <div style={{ fontSize: '12.5px', color: 'var(--muted)', lineHeight: 1.55 }}>
            <b style={{ color: 'var(--ink)' }}>Falta a chave da API.</b> Adicione{' '}
            <code style={{ fontSize: '11.5px' }}>ANTHROPIC_API_KEY</code> ao arquivo <code style={{ fontSize: '11.5px' }}>.env</code> e
            reinicie o servidor. Sem ela o painel não consegue pesquisar na internet.
          </div>
        </div>
      )}

      {generating && (
        <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
          Pesquisando fontes e cruzando com os números do período. Costuma levar de 30 a 90 segundos.
        </div>
      )}

      {error && (
        <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--bad)', backgroundColor: 'rgba(220,38,38,0.08)', color: 'var(--bad)', fontSize: '12.5px', fontWeight: 600 }}>
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
          <span>{error}</span>
        </div>
      )}

      {!study && configured && !generating && !error && (
        <p style={{ fontSize: '12.5px', color: 'var(--muted)', lineHeight: 1.55 }}>
          Nenhum estudo gerado ainda. Preencha o briefing acima primeiro — quanto melhor o contexto, mais útil o
          resultado.
        </p>
      )}

      {study && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 12px',
              borderRadius: '8px',
              backgroundColor: 'rgba(180, 83, 9, 0.08)',
              border: '1px solid var(--warn, #b45309)',
              color: 'var(--warn, #b45309)',
              fontSize: '12px',
              fontWeight: 700,
              flexWrap: 'wrap'
            }}
          >
            <Sparkles size={14} />
            <span>Conteúdo gerado por IA — recomendação, não dado medido.</span>
          </div>

          <div style={{ fontSize: '11.5px', color: 'var(--muted)', lineHeight: 1.6 }}>
            Gerado em {new Date(study.generatedAt).toLocaleString('pt-BR')} por {study.generatedBy} · modelo{' '}
            {study.model} · {study.usage.webSearches} busca(s) na web
            <br />
            Contexto: {study.context.periodLabel}
            {study.context.spend !== null && ` · investimento R$ ${study.context.spend.toFixed(2)}`}
            {study.context.leads !== null && ` · ${study.context.leads} leads`}
            {study.context.cpl !== null && ` · CPL R$ ${study.context.cpl.toFixed(2)}`}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px' }}>{renderMarkdown(study.content)}</div>

          {study.sources.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
              <div style={{ fontSize: '11.5px', fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '7px' }}>
                Fontes consultadas
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {study.sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '12px', color: 'var(--accent-blue)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                  >
                    <ExternalLink size={11} style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
