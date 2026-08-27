import React, { useEffect, useState } from 'react';
import {
  DollarSign,
  Users,
  UserCheck,
  MousePointer,
  Percent,
  CalendarCheck,
  ShoppingBag,
  TrendingUp,
  Award,
  AlertTriangle
} from 'lucide-react';
import { DashboardOverviewResponse } from '../types';
import { metricText, DATA_SOURCE_LABEL, isDemoData } from '../utils/metrics';
import { api } from '../services/api';
import { useClient } from '../context/ClientContext';
import { usePeriod } from '../context/PeriodContext';
import { KpiCard } from '../components/common/KpiCard';
import { FunnelStage } from '../components/common/FunnelStage';
import { DataTable, ColumnDef } from '../components/common/DataTable';
import { ComboEvolutionChart } from '../components/charts/ComboEvolutionChart';
import { DemographicsChart } from '../components/charts/DemographicsChart';
import { KpiSkeletonGrid, ChartSkeleton, TableSkeleton } from '../components/common/Skeletons';
import { ErrorState } from '../components/common/ErrorState';


/** dd/mm/aaaa a partir de uma data ISO curta. */
function formatDateBR(iso: string): string {
  return iso.split('-').reverse().join('/');
}

/** "hoje", "ontem" ou "há N dias" — mais legível que um timestamp cru. */
function formatCollectedAt(freshness: { ageInDays: number }): string {
  if (freshness.ageInDays < 1) return 'hoje';
  if (freshness.ageInDays < 2) return 'ontem';
  return `há ${Math.round(freshness.ageInDays)} dias`;
}

export const GeneralDashboard: React.FC = () => {
  const { selectedClient, selectedAccountId } = useClient();
  const { preset, startDate, endDate, compare, includeMetaTax } = usePeriod();
  const [data, setData] = useState<DashboardOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!selectedClient) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.getDashboardOverview(selectedClient.id, selectedAccountId, {
        preset,
        startDate,
        endDate,
        compare,
        includeMetaTax
      });
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar dados da Visão Geral');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedClient, selectedAccountId, preset, startDate, endDate, compare, includeMetaTax]);

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <KpiSkeletonGrid />
        <ChartSkeleton height="320px" />
        <TableSkeleton />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadData} />;
  }

  if (!data) return null;

  const m = data.currentMetrics;
  const deltas = data.deltas;
  const formatMoney = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const formatNum = (v: number) => new Intl.NumberFormat('pt-BR').format(v || 0);

  // Colunas da Tabela Diária
  const dailyColumns: ColumnDef<any>[] = [
    {
      id: 'date',
      header: 'Data',
      accessor: d => d.date.split('-').reverse().join('/'),
      align: 'left',
      sticky: true,
      width: '100px'
    },
    {
      id: 'spend',
      header: 'Investimento',
      accessor: d => d.spend,
      cell: (v, row) => metricText(row, 'spend', v, formatMoney),
      heatmap: true,
      heatmapColor: 'var(--heat-gasto)'
    },
    {
      id: 'impressions',
      header: 'Impressões',
      accessor: d => d.impressions,
      cell: (v, row) => metricText(row, 'impressions', v, formatNum)
    },
    {
      id: 'clicks',
      header: 'Cliques',
      accessor: d => d.clicks,
      cell: (v, row) => metricText(row, 'clicks', v, formatNum)
    },
    {
      id: 'leads',
      header: 'Leads',
      accessor: d => d.leads,
      cell: (v, row) => metricText(row, 'leads', v, formatNum),
      heatmap: true,
      heatmapColor: 'var(--heat-leads)'
    },
    {
      id: 'cpl',
      header: 'CPL',
      accessor: d => d.cpl,
      cell: (v, row) => metricText(row, 'cpl', v, formatMoney)
    },
    {
      id: 'mqls',
      header: 'MQLs',
      accessor: d => d.mqls,
      cell: (v, row) => metricText(row, 'mqls', v, formatNum),
      heatmap: true,
      heatmapColor: 'var(--heat-mqls)'
    },
    {
      id: 'cpmql',
      header: 'CPMQL',
      accessor: d => d.cpmql,
      cell: (v, row) => metricText(row, 'cpmql', v, formatMoney)
    },
    {
      id: 'appointments',
      header: 'Agendamentos',
      accessor: d => d.appointments,
      cell: (v, row) => metricText(row, 'appointments', v, formatNum)
    },
    {
      id: 'conversions',
      header: 'Vendas',
      accessor: d => d.conversions,
      cell: (v, row) => metricText(row, 'conversions', v, formatNum),
      heatmap: true,
      heatmapColor: 'var(--heat-vendas)'
    },
    {
      id: 'revenue',
      header: 'Receita',
      accessor: d => d.revenue,
      cell: (v, row) => metricText(row, 'revenue', v, formatMoney),
      heatmap: true,
      heatmapColor: 'var(--heat-rec)'
    },
    {
      id: 'roas',
      header: 'ROAS',
      accessor: d => d.roas,
      cell: (v, row) => (
        <span style={{ fontWeight: 800, color: 'var(--good)' }}>
          {metricText(row, 'roas', v, n => `${n.toFixed(2)}x`)}
        </span>
      )
    }
  ];

  // Colunas de Leads Qualificados
  const qLeadColumns: ColumnDef<any>[] = [
    {
      id: 'date',
      header: 'Data',
      accessor: l => l.date.split('-').reverse().join('/'),
      align: 'left',
      width: '95px'
    },
    {
      id: 'name',
      header: 'Nome',
      accessor: l => l.name,
      align: 'left'
    },
    {
      id: 'score',
      header: 'Score',
      accessor: l => l.score,
      align: 'center',
      cell: v => (
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: '999px',
            fontSize: '11px',
            fontWeight: 800,
            backgroundColor: v === 'A' ? 'var(--good-bg)' : 'var(--accent-blue-light)',
            color: v === 'A' ? 'var(--good)' : 'var(--accent-blue)'
          }}
        >
          Score {v}
        </span>
      )
    },
    {
      id: 'campaign',
      header: 'Campanha de Origem',
      accessor: l => l.campaign,
      align: 'left'
    },
    {
      id: 'funnel',
      header: 'Funil',
      accessor: l => l.funnel,
      align: 'center'
    },
    {
      id: 'cityState',
      header: 'Localização',
      accessor: l => l.cityState,
      align: 'left'
    },
    {
      id: 'moment',
      header: 'Momento',
      accessor: l => l.moment,
      align: 'left'
    },
    {
      id: 'appointmentBooked',
      header: 'Agendou?',
      accessor: l => (l.appointmentBooked ? 'Sim' : 'Não'),
      align: 'center',
      cell: v => (
        <span style={{ fontWeight: 700, color: v === 'Sim' ? 'var(--good)' : 'var(--muted)' }}>
          {v}
        </span>
      )
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div
        role="status"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          borderRadius: '8px',
          fontSize: '12.5px',
          fontWeight: 600,
          border: '1px solid',
          borderColor: isDemoData(data.dataSource) ? 'var(--warn, #b45309)' : 'var(--border)',
          background: isDemoData(data.dataSource) ? 'rgba(180, 83, 9, 0.10)' : 'transparent',
          color: isDemoData(data.dataSource) ? 'var(--warn, #b45309)' : 'var(--muted)'
        }}
      >
        {isDemoData(data.dataSource) ? '⚠' : '●'} {DATA_SOURCE_LABEL[data.dataSource]}
        {!isDemoData(data.dataSource) && data.dailyTrends.length === 0 && (
          <span style={{ fontWeight: 500 }}>
            &middot; sem veiculação nas contas deste cliente no período selecionado
          </span>
        )}
        {data.snapshotFreshness && (
          <span style={{ fontWeight: 500 }}>
            &middot; coletado {formatCollectedAt(data.snapshotFreshness)}
          </span>
        )}
      </div>

      {/* Dado velho ou período fora da janela coletada: avisa antes de o usuário decidir algo com ele. */}
      {data.snapshotFreshness && (data.snapshotFreshness.stale || data.snapshotFreshness.periodExceedsCoverage) && (
        <div
          role="status"
          className="card"
          style={{
            padding: '11px 14px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '9px',
            borderColor: 'var(--warn, #b45309)',
            backgroundColor: 'rgba(180, 83, 9, 0.08)',
            color: 'var(--warn, #b45309)',
            fontSize: '12.5px',
            fontWeight: 600
          }}
        >
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {data.snapshotFreshness.stale && (
              <span>
                Esta coleta tem {data.snapshotFreshness.ageInDays.toFixed(0)} dias. Os números podem não refletir o que
                está acontecendo agora na Meta.
              </span>
            )}
            {data.snapshotFreshness.periodExceedsCoverage && data.snapshotFreshness.coverage && (
              <span style={{ fontWeight: 500 }}>
                O período selecionado ultrapassa a janela coletada (
                {formatDateBR(data.snapshotFreshness.coverage.since)} a{' '}
                {formatDateBR(data.snapshotFreshness.coverage.until)}). Os dias fora dela aparecem vazios por falta de
                dado, não por falta de veiculação.
              </span>
            )}
          </div>
        </div>
      )}

      {/* 1. KPIs Grid */}
      <div>
        <div className="section-label">Métricas Principais &middot; Desempenho Consolidado</div>
        <div className="kpi-grid">
          <KpiCard
            title="Investimento Total"
            value={metricText(m, 'spend', m.spend, formatMoney)}
            delta={deltas.spend}
            deltaType="negative_is_good"
            hero
            hint="Valor total investido no período considerando impostos configurados."
          />
          <KpiCard
            title="Leads Cadastrados"
            value={metricText(m, 'leads', m.leads, formatNum)}
            delta={deltas.leads}
            hint="Volume total de contatos/leads captados através dos formulários e landing pages."
          />
          <KpiCard
            title="CPL Médio"
            value={metricText(m, 'cpl', m.cpl, formatMoney)}
            delta={deltas.cpl}
            deltaType="negative_is_good"
            hint="Custo por lead (Investimento / Leads)."
          />
          <KpiCard
            title="MQLs Qualificados"
            value={metricText(m, 'mqls', m.mqls, formatNum)}
            delta={deltas.mqls}
            hint="Leads qualificados com perfil ideal (Score A e B)."
          />
          <KpiCard
            title="CPMQL"
            value={metricText(m, 'cpmql', m.cpmql, formatMoney)}
            delta={deltas.cpmql}
            deltaType="negative_is_good"
            hint="Custo por lead qualificado (Investimento / MQLs)."
          />
          <KpiCard
            title="Agendamentos"
            value={metricText(m, 'appointments', m.appointments, formatNum)}
            delta={deltas.appointments}
            hint="Reuniões e diagnósticos agendados na agenda dos closers."
          />
          <KpiCard
            title="Vendas Realizadas"
            value={metricText(m, 'conversions', m.conversions, formatNum)}
            delta={deltas.conversions}
            hint="Total de clientes fechados e matriculados."
          />
          <KpiCard
            title="CAC (CPA)"
            value={metricText(m, 'cpa', m.cpa, formatMoney)}
            delta={deltas.cpa}
            deltaType="negative_is_good"
            hint="Custo de Aquisição de Cliente (Investimento / Vendas)."
          />
          <KpiCard
            title="Faturamento Bruto"
            value={metricText(m, 'revenue', m.revenue, formatMoney)}
            delta={deltas.revenue}
            hero
            hint="Receita total gerada pelas conversões."
          />
          <KpiCard
            title="ROAS Geral"
            value={metricText(m, 'roas', m.roas, v => `${v.toFixed(2)}x`)}
            delta={deltas.roas}
            hero
            hint="Retorno sobre investimento em publicidade (Receita / Investimento)."
          />
          <KpiCard
            title="CTR Médio"
            value={metricText(m, 'ctr', m.ctr, v => `${v.toFixed(2)}%`)}
            delta={deltas.ctr}
            hint="Taxa de cliques no anúncio (Cliques / Impressões)."
          />
          <KpiCard
            title="CPM"
            value={metricText(m, 'cpm', m.cpm, formatMoney)}
            delta={deltas.cpm}
            deltaType="negative_is_good"
            hint="Custo por mil impressões."
          />
        </div>
      </div>

      {/* 2. Funnel & Combo Chart */}
      <div>
        <div className="section-label">Funil de Conversão &middot; Do Tráfego ao Fechamento</div>
        <div className="funnel-chart-grid">
          <div className="card">
            <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>Funil de Vendas Completo</h3>
            <p style={{ fontSize: '11.5px', color: 'var(--muted)', marginBottom: '14px' }}>
              Acompanhamento de eficiência e gargalos em cada etapa do processo comercial.
            </p>
            <FunnelStage metrics={m} />
          </div>

          <div>
            <ComboEvolutionChart dailyData={data.dailyTrends} />
          </div>
        </div>
      </div>

      {/* 3. Daily Breakdown Table */}
      <div>
        <div className="section-label">Detalhamento Diário &middot; Histórico com Heatmap</div>
        <DataTable
          data={[...data.dailyTrends].reverse()}
          columns={dailyColumns}
          maxHeight="340px"
          footerData={{
            date: 'TOTAL ACUMULADO',
            spend: metricText(m, 'spend', m.spend, formatMoney),
            impressions: metricText(m, 'impressions', m.impressions, formatNum),
            clicks: metricText(m, 'clicks', m.clicks, formatNum),
            leads: metricText(m, 'leads', m.leads, formatNum),
            cpl: metricText(m, 'cpl', m.cpl, formatMoney),
            mqls: metricText(m, 'mqls', m.mqls, formatNum),
            cpmql: metricText(m, 'cpmql', m.cpmql, formatMoney),
            appointments: metricText(m, 'appointments', m.appointments, formatNum),
            conversions: metricText(m, 'conversions', m.conversions, formatNum),
            revenue: metricText(m, 'revenue', m.revenue, formatMoney),
            roas: metricText(m, 'roas', m.roas, n => `${n.toFixed(2)}x`)
          }}
        />
      </div>

      {/* 4. Acumulado por Funil */}
      <div>
        <div className="section-label">Acumulado por Segmento / Funil</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
          {data.funnelSegments.map(seg => (
            <div key={seg.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ fontSize: '13.5px', fontWeight: 800, color: 'var(--ink)' }}>{seg.name}</h4>
                <span className="tabular-nums" style={{ fontSize: '12px', fontWeight: 700, color: 'var(--good)' }}>
                  ROAS {seg.roas.toFixed(2)}x
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                <div style={{ padding: '8px', background: 'var(--bg)', borderRadius: '8px' }}>
                  <div style={{ color: 'var(--muted)', fontSize: '10.5px' }}>Investimento</div>
                  <div style={{ fontWeight: 700, color: 'var(--bad)' }} className="tabular-nums">{formatMoney(seg.spend)}</div>
                </div>
                <div style={{ padding: '8px', background: 'var(--bg)', borderRadius: '8px' }}>
                  <div style={{ color: 'var(--muted)', fontSize: '10.5px' }}>Faturamento</div>
                  <div style={{ fontWeight: 700, color: 'var(--good)' }} className="tabular-nums">{formatMoney(seg.revenue)}</div>
                </div>
                <div style={{ padding: '8px', background: 'var(--bg)', borderRadius: '8px' }}>
                  <div style={{ color: 'var(--muted)', fontSize: '10.5px' }}>Leads / CPL</div>
                  <div style={{ fontWeight: 700 }} className="tabular-nums">{seg.leads} · {formatMoney(seg.cpl)}</div>
                </div>
                <div style={{ padding: '8px', background: 'var(--bg)', borderRadius: '8px' }}>
                  <div style={{ color: 'var(--muted)', fontSize: '10.5px' }}>MQLs / CPMQL</div>
                  <div style={{ fontWeight: 700, color: 'var(--accent-blue)' }} className="tabular-nums">{seg.mqls} · {formatMoney(seg.cpmql)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Demographics Breakdown */}
      <div>
        <div className="section-label">Perfil Demográfico &middot; Qualificação e Origem das Leads</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
          <DemographicsChart title="Top Países" items={data.demographics.countries} />
          <DemographicsChart title="Top Estados (BR)" items={data.demographics.states} />
          <DemographicsChart title="Momento Profissional" items={data.demographics.moments} />
          <DemographicsChart title="Experiência Prévia" items={data.demographics.experiences} />
          <DemographicsChart title="Objetivo Principal" items={data.demographics.results} />
          <DemographicsChart title="Disposta a Investir?" items={data.demographics.invest} />
        </div>
      </div>

      {/* 6. Qualified Leads Table */}
      <div>
        <div className="section-label">Amostra de Leads Qualificados (Score A & B)</div>
        <DataTable data={data.qualifiedLeads} columns={qLeadColumns} maxHeight="280px" />
      </div>
    </div>
  );
};
