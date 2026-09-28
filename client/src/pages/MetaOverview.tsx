import React, { useEffect, useState } from 'react';
import { Ca01Report, Ca01ReportEntity } from '../types';
import { api } from '../services/api';
import { usePeriod } from '../context/PeriodContext';
import { TableSkeleton } from '../components/common/Skeletons';
import { ErrorState } from '../components/common/ErrorState';

/**
 * Visão Geral da CA 01 - Giacobelli, no padrão de relatório do cliente.
 *
 * Dados reais da Meta Marketing API (janela coletada, imposto Meta incluso).
 * Só as partes de dado: KPIs, investimento por frente, ranking de anúncios e
 * comparação de conjuntos. Recomendações e "temas criativos" ficam de fora de
 * propósito — são análise humana, e inventá-las contaminaria o painel.
 *
 * É exclusivo desta conta; nenhuma outra página ou conta é afetada.
 */

const money = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const num = (v: number | null | undefined) => (v == null ? '—' : new Intl.NumberFormat('pt-BR').format(v));
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(2)}%`);
const brDate = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');

/** Rótulo e resultado principal de cada frente, pelo objetivo da campanha. */
const OBJECTIVE_LABEL: Record<string, string> = {
  OUTCOME_LEADS: 'Captação de lead',
  OUTCOME_SALES: 'Vendas / conversão',
  OUTCOME_AWARENESS: 'Reconhecimento',
  OUTCOME_ENGAGEMENT: 'Engajamento',
  OUTCOME_TRAFFIC: 'Tráfego',
  OUTCOME_APP_PROMOTION: 'Aplicativo'
};
const objLabel = (o: string | null) => (o ? OBJECTIVE_LABEL[o] || o.replace('OUTCOME_', '').toLowerCase() : '—');

/** O "resultado" que importa para aquela frente, e seu custo. */
function primaryResult(c: Ca01ReportEntity): { label: string; cost: string } {
  switch (c.objective) {
    case 'OUTCOME_SALES':
      return { label: `${num(c.conversions ?? 0)} compra(s)`, cost: c.cpa != null ? `CPA ${money(c.cpa)}` : '' };
    case 'OUTCOME_AWARENESS':
      return { label: `${num(c.reach ?? 0)} alcance`, cost: '' };
    case 'OUTCOME_ENGAGEMENT':
      return { label: `${num(c.engagement ?? 0)} engaj.`, cost: c.cpe != null ? `${money(c.cpe)}/engaj.` : '' };
    default:
      return { label: `${num(c.leads ?? 0)} lead(s)`, cost: c.cpl != null ? `CPL ${money(c.cpl)}` : '' };
  }
}

const BAR_COLORS = ['#2563EB', '#EA6A34', '#16A34A', '#D97706', '#DB2777', '#7C3AED', '#0EA5E9'];

const card: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '18px', marginBottom: '16px'
};
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', color: 'var(--muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.02em', borderBottom: '1px solid var(--border)' };
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: '13px' };
const tdR: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

const Pill: React.FC<{ tone: 'good' | 'bad' | 'muted'; children: React.ReactNode }> = ({ tone, children }) => {
  const c = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : 'var(--muted)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 20, fontSize: 11.5, fontWeight: 600, color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
      {children}
    </span>
  );
};

const Kpi: React.FC<{ label: string; value: string; note?: string }> = ({ label, value, note }) => (
  <div style={{ ...card, margin: 0, padding: '16px' }}>
    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    {note && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{note}</div>}
  </div>
);

interface MetaOverviewProps {
  accountId: string;
  accountName: string;
}

export const MetaOverview: React.FC<MetaOverviewProps> = ({ accountId, accountName }) => {
  const { startDate, endDate } = usePeriod();
  const [report, setReport] = useState<Ca01Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      setReport(await api.getMetaReport(accountId, startDate, endDate));
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar o relatório da Meta');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [accountId, startDate, endDate]);

  if (loading && !report) return <TableSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!report) return null;

  const k = report.kpis;
  const dias = Math.round((Date.parse(report.range.until) - Date.parse(report.range.since)) / 86400000) + 1;
  const maxSpend = Math.max(1, ...report.campaigns.map(c => c.spend));

  // Frentes de captação (leads) para o CPL médio "de captação".
  const captacao = report.campaigns.filter(c => c.objective === 'OUTCOME_LEADS' || c.objective == null);
  const capSpend = captacao.reduce((t, c) => t + c.spend, 0);
  const capLeads = captacao.reduce((t, c) => t + (c.leads ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div>
          <h2 className="page-title">{report.accountName || accountName} · Painel de Campanhas</h2>
          <p className="page-description">
            Meta Ads · {brDate(report.range.since)} a {brDate(report.range.until)} ({dias} dias) · imposto Meta incluso · coletado {new Date(report.fetchedAt).toLocaleString('pt-BR')}
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <Kpi label="Investimento total" value={money(k.spend)} note={`${report.campaigns.length} frentes`} />
        <Kpi label="Leads no período" value={num(k.leads)} note={`${num(k.conversions)} venda(s) · ${num(k.landingPageViews)} visitas`} />
        <Kpi label="CPL médio (captação)" value={capLeads > 0 ? money(capSpend / capLeads) : '—'} note={`${money(capSpend)} ÷ ${num(capLeads)} leads`} />
        <Kpi label="CTR médio geral" value={pct(k.ctr)} note={`${num(k.clicks)} cliques / ${num(k.impressions)} impr.`} />
      </div>

      {/* Investimento por frente */}
      <div style={card}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>Investimento por frente</h3>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px' }}>Cada campanha tem um objetivo diferente — nem todas visam lead.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {report.campaigns.map((c, i) => {
            const share = (c.spend / k.spend) * 100;
            const width = (c.spend / maxSpend) * 100;
            const color = BAR_COLORS[i % BAR_COLORS.length];
            return (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '210px 1fr 128px', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--ink)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{objLabel(c.objective)}</span>
                </div>
                <div style={{ position: 'relative', height: 22, background: 'var(--border)', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${width}%`, background: color, borderRadius: '5px 0 0 5px' }} />
                </div>
                <div style={{ fontSize: 13, textAlign: 'right', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                  <b style={{ color: 'var(--ink)' }}>{money(c.spend)}</b> · {share.toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ overflowX: 'auto', marginTop: 18 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={th}>Frente</th><th style={th}>Objetivo</th><th style={thR}>Gasto</th><th style={thR}>Resultado</th><th style={thR}>Visitas</th><th style={thR}>Leads</th><th style={thR}>CPL</th></tr>
            </thead>
            <tbody>
              {report.campaigns.map(c => {
                const r = primaryResult(c);
                return (
                  <tr key={c.id}>
                    <td style={td}>{c.name}</td>
                    <td style={{ ...td, color: 'var(--muted)' }}>{objLabel(c.objective)}</td>
                    <td style={tdR}>{money(c.spend)}</td>
                    <td style={tdR}>{r.label}{r.cost ? <span style={{ color: 'var(--muted)' }}> · {r.cost}</span> : null}</td>
                    <td style={tdR}>{num(c.landingPageViews)}</td>
                    <td style={tdR}>{c.hasLeads ? num(c.leads) : '—'}</td>
                    <td style={tdR}>{money(c.cpl)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ranking de anúncios */}
      <div style={card}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>Ranking de anúncios</h3>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>Todos os anúncios ativos, do maior gasto ao menor.</p>
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={th}>Anúncio</th><th style={thR}>Gasto</th><th style={thR}>Cliques</th><th style={thR}>Leads</th><th style={thR}>CPL</th><th style={th}>Status</th></tr>
            </thead>
            <tbody>
              {report.ads.map(a => (
                <tr key={a.id}>
                  <td style={td}>{a.name}</td>
                  <td style={tdR}>{money(a.spend)}</td>
                  <td style={tdR}>{num(a.clicks)}</td>
                  <td style={tdR}>{a.hasLeads ? num(a.leads) : '—'}</td>
                  <td style={tdR}>{money(a.cpl)}</td>
                  <td style={td}>
                    {(a.leads ?? 0) > 0
                      ? <Pill tone="good">com lead</Pill>
                      : (a.conversions ?? 0) > 0
                        ? <Pill tone="good">com venda</Pill>
                        : a.spend > 0 ? <Pill tone="bad">sem resultado</Pill> : <Pill tone="muted">sem gasto</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Comparação de conjuntos */}
      <div style={card}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>Conjuntos de anúncios</h3>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>Gasto, tráfego e resultado por conjunto.</p>
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={th}>Conjunto</th><th style={thR}>Gasto</th><th style={thR}>Cliques</th><th style={thR}>Visitas</th><th style={thR}>Leads</th><th style={thR}>CPL</th></tr>
            </thead>
            <tbody>
              {report.adSets.map(s => (
                <tr key={s.id}>
                  <td style={td}>{s.name}</td>
                  <td style={tdR}>{money(s.spend)}</td>
                  <td style={tdR}>{num(s.clicks)}</td>
                  <td style={tdR}>{num(s.landingPageViews)}</td>
                  <td style={tdR}>{s.hasLeads ? num(s.leads) : '—'}</td>
                  <td style={tdR}>{money(s.cpl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {report.windowRange && startDate < report.windowRange.since && (
        <p style={{ fontSize: 12, color: 'var(--warn, #b45309)', textAlign: 'center', marginTop: 4 }}>
          A coleta cobre {brDate(report.windowRange.since)} a {brDate(report.windowRange.until)}. O período do filtro foi recortado a essa janela.
        </p>
      )}
      <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 8 }}>
        Dados reais da Meta Marketing API · imposto Meta incluso · alcance/frequência só na visão da janela completa · "engajamento" = curtidas líquidas no post (a Meta não reporta "seguidor" nesta conta).
      </p>
    </div>
  );
};
