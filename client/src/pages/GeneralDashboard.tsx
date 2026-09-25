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
  AlertTriangle,
  Info
} from 'lucide-react';
import { DashboardOverviewResponse } from '../types';
import { metricText, DATA_SOURCE_LABEL, isDemoData } from '../utils/metrics';
import { api } from '../services/api';
import { useClient } from '../context/ClientContext';
import { usePeriod } from '../context/PeriodContext';
import { KpiCard, KpiStatus } from '../components/common/KpiCard';
import { FunnelStage } from '../components/common/FunnelStage';
import { DataTable, ColumnDef } from '../components/common/DataTable';
import { buildDailyColumns, buildDailyFooter } from '../utils/dailyColumns';
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

/**
 * Situação de um indicador de custo diante da meta do cliente.
 *
 * Dentro da meta é bom; até 20% acima ainda é alerta, porque oscilação de leilão
 * nessa faixa é ruído e não tendência; acima disso é problema. Sem meta
 * cadastrada devolve null, e o card fica neutro — colorir sem critério definido
 * seria o painel inventando uma avaliação.
 */
const TOLERANCE = 1.2;

function costStatus(value: number | undefined, target: number | null, isNd: boolean): KpiStatus | null {
  if (isNd || target === null || value === undefined) return null;
  if (value <= target) return 'good';
  if (value <= target * TOLERANCE) return 'warn';
  return 'bad';
}

/** ROAS é o inverso: quanto maior, melhor. */
function returnStatus(value: number | undefined, target: number | null, isNd: boolean): KpiStatus | null {
  if (isNd || target === null || value === undefined) return null;
  if (value >= target) return 'good';
  if (value >= target / TOLERANCE) return 'warn';
  return 'bad';
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
  // Resposta em cache gravada antes destes campos existirem não os traz. Sem o
  // fallback, o primeiro acesso após um deploy quebraria a tela até o cache expirar.
  const targets = data.targets ?? { cpl: null, cpmql: null, cpa: null, cpm: null, roas: null };
  const excluded = data.excludedCampaigns ?? [];
  const warnings = data.dataWarnings ?? [];
  const hasDemographics = Object.values(data.demographics || {}).some(
    arr => Array.isArray(arr) && arr.length > 0
  );
  const nd = (k: string) => m.unavailable.includes(k as never);
  const moneyTarget = (v: number | null) => (v === null ? undefined : `meta ${formatMoney(v)}`);
  const formatMoney = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const formatNum = (v: number) => new Intl.NumberFormat('pt-BR').format(v || 0);

  // Colunas da Tabela Diária — compartilhadas com o raio-X da campanha.
  const dailyColumns = buildDailyColumns();

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
        {/*
          Sem dados, a causa importa: nunca houve coleta neste servidor, ou
          houve e as contas não veicularam. Dizer "sem veiculação" no primeiro
          caso faz o usuário achar que as campanhas não rodaram.
        */}
        {!isDemoData(data.dataSource) && data.dailyTrends.length === 0 && (
          <span style={{ fontWeight: 500 }}>
            {data.snapshotFreshness === null
              ? ' · nenhuma coleta do MCP foi enviada para este servidor ainda'
              : ' · sem veiculação nas contas deste cliente no período selecionado'}
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
            status={costStatus(m.cpl, targets.cpl, nd('cpl'))}
            targetLabel={moneyTarget(targets.cpl)}
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
            status={costStatus(m.cpmql, targets.cpmql, nd('cpmql'))}
            targetLabel={moneyTarget(targets.cpmql)}
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
            status={costStatus(m.cpa, targets.cpa, nd('cpa'))}
            targetLabel={moneyTarget(targets.cpa)}
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
            status={returnStatus(m.roas, targets.roas, nd('roas'))}
            targetLabel={targets.roas === null ? undefined : `meta ${targets.roas.toFixed(2)}x`}
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
            status={costStatus(m.cpm, targets.cpm, nd('cpm'))}
            targetLabel={moneyTarget(targets.cpm)}
            hint="Custo por mil impressões."
          />
        </div>

        {warnings.map((w, i) => (
          <div key={i} className="data-warning">
            <AlertTriangle size={14} />
            <span>{w}</span>
          </div>
        ))}

        {excluded.length > 0 && (
          <div className="excluded-note">
            <AlertTriangle size={13} />
            <span>
              Fora do cálculo:{' '}
              {excluded
                .map(c => `${c.name} (${formatMoney(c.spend)})`)
                .join(', ')}
              {' '}— objetivo diferente, sem lead atribuível. O gasto existiu, mas não entra em CPL nem CPMQL.
            </span>
          </div>
        )}
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
          footerData={buildDailyFooter(m)}
        />
      </div>

      {/* 4. Acumulado por Funil */}
      {data.funnelSegments.length > 0 && (
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
      )}

      {/* 5. Demographics Breakdown */}
      {hasDemographics && (
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
      )}

      {/* 6. Qualified Leads Table */}
      {data.qualifiedLeads.length > 0 && (
        <div>
          <div className="section-label">Amostra de Leads Qualificados (Score A & B)</div>
          <DataTable data={data.qualifiedLeads} columns={qLeadColumns} maxHeight="280px" />
        </div>
      )}

      {/* Aviso informativo elegante quando os dados reais não trazem demografia/leads nominais */}
      {!isDemoData(data.dataSource) && !hasDemographics && (
        <div
          className="card"
          style={{
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '10px'
          }}
        >
          <Info size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>
              Detalhamento demográfico e lista nominal de leads
            </span>
            <span style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.45 }}>
              Dados demográficos agregados e nomes individuais não são fornecidos pela Meta Ads API nesta integração. O ScaleAds segue o princípio de exibir exclusivamente métricas reais reportadas, sem estimativas inventadas.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
