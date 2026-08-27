import React, { useEffect, useState } from 'react';
import { Copy, Check, ExternalLink, Sparkles, Target } from 'lucide-react';
import { AdData, DashboardOverviewResponse, MetricName } from '../types';
import { metricText } from '../utils/metrics';
import { api } from '../services/api';
import { useClient } from '../context/ClientContext';
import { usePeriod } from '../context/PeriodContext';
import { DataTable, ColumnDef } from '../components/common/DataTable';
import { TableSkeleton } from '../components/common/Skeletons';

export const ReportView: React.FC = () => {
  const { selectedClient, selectedAccountId } = useClient();
  const { preset, startDate, endDate, compare, includeMetaTax, getPeriodLabel } = usePeriod();
  const [ads, setAds] = useState<AdData[]>([]);
  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Leitura do período escrita pelo gestor, por cliente. Fica no navegador.
  const notesKey = `scale_report_notes_${selectedClient?.id || 'sem_cliente'}`;
  const [notes, setNotes] = useState('');

  useEffect(() => {
    try {
      setNotes(localStorage.getItem(notesKey) || '');
    } catch {
      setNotes('');
    }
  }, [notesKey]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    try {
      localStorage.setItem(notesKey, value);
    } catch {
      /* storage indisponível: a nota vale só nesta sessão */
    }
  };

  // Metas editáveis salvas no LocalStorage
  const [metaCpagd, setMetaCpagd] = useState<number>(() => {
    const saved = localStorage.getItem('scale_meta_cpagd');
    return saved ? Number(saved) : 85;
  });
  const [metaCac, setMetaCac] = useState<number>(() => {
    const saved = localStorage.getItem('scale_meta_cac');
    return saved ? Number(saved) : 300;
  });
  const [volMin, setVolMin] = useState<number>(() => {
    const saved = localStorage.getItem('scale_meta_vol_min');
    return saved ? Number(saved) : 3;
  });

  const handleSaveMeta = (key: string, val: number, setter: (v: number) => void) => {
    setter(val);
    localStorage.setItem(key, String(val));
  };

  useEffect(() => {
    if (!selectedClient) return;
    const loadReportData = async () => {
      try {
        setLoading(true);
        const [adsData, overData] = await Promise.all([
          api.getAds(selectedClient.id, selectedAccountId, undefined, {
            preset,
            startDate,
            endDate,
            compare,
            includeMetaTax
          }),
          api.getDashboardOverview(selectedClient.id, selectedAccountId, {
            preset,
            startDate,
            endDate,
            compare,
            includeMetaTax
          })
        ]);
        setAds(adsData);
        setOverview(overData);
      } catch (e) {
        console.error('Erro ao carregar dados do relatório:', e);
      } finally {
        setLoading(false);
      }
    };
    loadReportData();
  }, [selectedClient, selectedAccountId, preset, startDate, endDate, compare, includeMetaTax]);

  if (loading && !overview) return <TableSkeleton />;
  if (!overview) return null;

  const formatMoney = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const formatNum = (v: number) => new Intl.NumberFormat('pt-BR').format(v || 0);

  const m = overview.currentMetrics;

  /**
   * Monta a mensagem do WhatsApp só com o que a Meta realmente reportou.
   *
   * Métricas indisponíveis são omitidas em vez de virarem uma linha "N/D", e a
   * leitura do período é escrita pelo gestor — antes havia três bullets fixos
   * que afirmavam coisas sobre a conta ("CPMQL saudável abaixo da meta") sem
   * relação com os números, e iam para o cliente em todo relatório.
   */
  const generateWhatsAppSummary = (): string => {
    const clientName = selectedClient?.name || 'Cliente';
    const periodLabel = getPeriodLabel();

    const linhas: Array<[string, MetricName, number, (v: number) => string]> = [
      ['💰 *Investimento Total:*', 'spend', m.spend, formatMoney],
      ['👥 *Leads Cadastrados:*', 'leads', m.leads, formatNum],
      ['🎯 *Custo por Lead (CPL):*', 'cpl', m.cpl, formatMoney],
      ['⭐ *Leads Qualificados (MQLs):*', 'mqls', m.mqls, formatNum],
      ['💎 *Custo por MQL (CPMQL):*', 'cpmql', m.cpmql, formatMoney],
      ['📅 *Agendamentos:*', 'appointments', m.appointments, formatNum],
      ['💳 *Vendas Fechadas:*', 'conversions', m.conversions, formatNum],
      ['📈 *CAC Médio:*', 'cpa', m.cpa, formatMoney],
      ['💵 *Faturamento Bruto:*', 'revenue', m.revenue, formatMoney],
      ['🚀 *ROAS:*', 'roas', m.roas, n => `${n.toFixed(2)}x`]
    ];

    const corpo = linhas
      .filter(([, metric]) => !m.unavailable.includes(metric))
      .map(([rotulo, , valor, fmt]) => `${rotulo} ${fmt(valor)}`)
      .join('\n');

    const omitidas = linhas.filter(([, metric]) => m.unavailable.includes(metric)).length;
    const rodapeOmitidas =
      omitidas > 0 ? `\n\n_${omitidas} métrica(s) não reportada(s) pela Meta neste período foram omitidas._` : '';

    const observacoes = notes.trim();
    const blocoNotas = observacoes ? `\n\n💡 *LEITURA DO PERÍODO:*\n${observacoes}` : '';

    return `📊 *RELATÓRIO DE PERFORMANCE — META ADS*
🏢 *Cliente:* ${clientName}
🗓 *Período:* ${periodLabel}

${corpo}${blocoNotas}${rodapeOmitidas}

_Dados extraídos do Meta Ads via ScaleAds Performance Hub_`;
  };

  const handleCopyWhatsApp = () => {
    const text = generateWhatsAppSummary();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Colunas de Top Anúncios
  const adColumns: ColumnDef<AdData>[] = [
    {
      id: 'name',
      header: 'Anúncio / Criativo',
      accessor: a => a.name,
      align: 'left',
      sticky: true,
      cell: (name, row) => {
        const isSampled = row.metrics.mqls >= volMin;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: isSampled ? 'var(--good)' : 'var(--yellow)'
              }}
              title={isSampled ? 'Avaliável (Amostra Relevante)' : 'Em Observação'}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{name}</span>
              <span style={{ fontSize: '10.5px', color: 'var(--muted)' }}>{row.adSetName}</span>
            </div>
          </div>
        );
      },
      width: '280px'
    },
    {
      id: 'link',
      header: 'Link',
      accessor: a => a.permalinkUrl,
      align: 'center',
      cell: url =>
        url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm"
            style={{ padding: '4px 8px', gap: '4px', textDecoration: 'none', color: 'var(--accent-blue)' }}
          >
            <ExternalLink size={12} /> Ver
          </a>
        ) : (
          <span style={{ color: 'var(--muted)', fontSize: '11px' }}>—</span>
        )
    },
    {
      id: 'spend',
      header: 'Investimento',
      accessor: a => a.metrics.spend,
      cell: (v, row) => metricText(row.metrics, 'spend', v, formatMoney),
      heatmap: true,
      heatmapColor: 'var(--heat-gasto)'
    },
    {
      id: 'leads',
      header: 'Leads',
      accessor: a => a.metrics.leads,
      cell: (v, row) => metricText(row.metrics, 'leads', v, formatNum)
    },
    {
      id: 'cpl',
      header: 'CPL',
      accessor: a => a.metrics.cpl,
      cell: (v, row) => metricText(row.metrics, 'cpl', v, formatMoney)
    },
    {
      id: 'mqls',
      header: 'MQLs',
      accessor: a => a.metrics.mqls,
      cell: v => (
        <span style={{ fontWeight: 700, color: v >= volMin ? 'var(--good)' : 'var(--ink)' }}>
          {formatNum(v)}
        </span>
      ),
      heatmap: true,
      heatmapColor: 'var(--heat-mqls)'
    },
    {
      id: 'cpmql',
      header: 'CPMQL',
      accessor: a => a.metrics.cpmql,
      cell: (v, row) => {
        const isSampled = row.metrics.mqls >= volMin;
        const color = !isSampled
          ? 'var(--ink)'
          : v <= metaCpagd * 0.5
          ? 'var(--good)'
          : v <= metaCpagd
          ? 'var(--yellow)'
          : 'var(--bad)';
        return <span style={{ fontWeight: 800, color }}>{formatMoney(v)}</span>;
      }
    },
    {
      id: 'appointments',
      header: 'Agendamentos',
      accessor: a => a.metrics.appointments,
      cell: (v, row) => metricText(row.metrics, 'appointments', v, formatNum)
    },
    {
      id: 'conversions',
      header: 'Vendas',
      accessor: a => a.metrics.conversions,
      cell: (v, row) => metricText(row.metrics, 'conversions', v, formatNum)
    },
    {
      id: 'cpa',
      header: 'CAC',
      accessor: a => a.metrics.cpa,
      cell: (v, row) => {
        const isGood = row.metrics.conversions > 0 && v <= metaCac;
        return (
          <span style={{ fontWeight: 700, color: isGood ? 'var(--good)' : 'var(--ink)' }}>
            {row.metrics.conversions > 0 ? formatMoney(v) : '—'}
          </span>
        );
      }
    },
    {
      id: 'revenue',
      header: 'Receita',
      accessor: a => a.metrics.revenue,
      cell: (v, row) => metricText(row.metrics, 'revenue', v, formatMoney),
      heatmap: true,
      heatmapColor: 'var(--heat-rec)'
    },
    {
      id: 'roas',
      header: 'ROAS',
      accessor: a => a.metrics.roas,
      cell: (v, row) => <span style={{ fontWeight: 800, color: 'var(--good)' }}>{metricText(row.metrics, 'roas', v, n => n.toFixed(2) + 'x')}</span>
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Relatório Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Relatório Executivo & Insights</h2>
          <p className="page-description">
            Visão consolidada de performance com classificação de metas e ferramenta de disparo rápido para o cliente via WhatsApp.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>Amostra:</span>
          <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px', backgroundColor: 'var(--good-bg)', color: 'var(--good)' }}>
            ● Avaliável (≥{volMin} MQLs)
          </span>
          <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px', backgroundColor: 'var(--yellow-bg)', color: 'var(--yellow)' }}>
            ● Em Observação
          </span>
        </div>
      </div>

      {/* Painel de Metas & Parâmetros */}
      <div className="card" style={{ padding: '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <Target size={16} style={{ color: 'var(--accent-blue)' }} />
          <h3 style={{ fontSize: '14px', fontWeight: 800 }}>Metas & Parâmetros da Conta</h3>
          <span style={{ fontSize: '11.5px', color: 'var(--muted)', marginLeft: 'auto' }}>
            Ajuste os valores para calibrar a coloração semântica e análise dos anúncios.
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
          <div className="date-input-group">
            <label>Meta CPAGD (R$)</label>
            <input
              type="number"
              value={metaCpagd}
              onChange={e => handleSaveMeta('scale_meta_cpagd', Number(e.target.value), setMetaCpagd)}
              min="0"
              step="5"
            />
          </div>
          <div className="date-input-group">
            <label>Meta CAC (R$)</label>
            <input
              type="number"
              value={metaCac}
              onChange={e => handleSaveMeta('scale_meta_cac', Number(e.target.value), setMetaCac)}
              min="0"
              step="10"
            />
          </div>
          <div className="date-input-group">
            <label>Volume Mínimo Amostral (MQLs)</label>
            <input
              type="number"
              value={volMin}
              onChange={e => handleSaveMeta('scale_meta_vol_min', Number(e.target.value), setVolMin)}
              min="1"
              step="1"
            />
          </div>
        </div>
      </div>

      {/* Top Anúncios vs Metas */}
      <div>
        <div className="section-label">Ranqueamento de Anúncios vs Metas</div>
        <DataTable data={ads} columns={adColumns} maxHeight="360px" />
      </div>

      {/* Briefing do Gestor */}
      <div className="card" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={17} style={{ color: 'var(--accent-blue)' }} />
          <h3 style={{ fontSize: '15px', fontWeight: 800 }}>Leitura do Período</h3>
        </div>

        <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '-6px' }}>
          A sua leitura do período. Entra no resumo do WhatsApp logo abaixo dos números; em branco, a seção não aparece.
        </p>

        <textarea
          id="report-notes"
          value={notes}
          onChange={e => handleNotesChange(e.target.value)}
          rows={5}
          placeholder={
            'O que funcionou, o que cortar e o próximo passo.\n\n' +
            'Ex.: Criativo AD_002 sustentou CPL abaixo da média do período; ' +
            'subir orçamento. Públicos lookalike com custo acima do aceitável; pausar.'
          }
          style={{
            width: '100%',
            padding: '11px 13px',
            borderRadius: '9px',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--bg)',
            color: 'var(--ink)',
            fontSize: '13px',
            fontFamily: 'inherit',
            lineHeight: 1.5,
            resize: 'vertical',
            outline: 'none'
          }}
        />

        <p style={{ fontSize: '11px', color: 'var(--muted)' }}>
          Salvo neste navegador, separado por cliente.
        </p>
      </div>

      {/* Bloco de Cópia WhatsApp */}
      <div className="card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 800 }}>Resumo Executivo para WhatsApp</h3>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Pronto para envio direto ao cliente</span>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCopyWhatsApp}
            style={{ gap: '6px' }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Copiado para a área de transferência!' : 'Copiar Resumo WhatsApp'}</span>
          </button>
        </div>

        <pre
          style={{
            padding: '16px',
            backgroundColor: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            fontSize: '12.5px',
            lineHeight: '1.55',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--ink)'
          }}
        >
          {generateWhatsAppSummary()}
        </pre>
      </div>
    </div>
  );
};
