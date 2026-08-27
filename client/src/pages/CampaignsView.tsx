import React, { useEffect, useState } from 'react';
import { CheckCircle, PauseCircle } from 'lucide-react';
import { CampaignData } from '../types';
import { metricText } from '../utils/metrics';
import { api } from '../services/api';
import { useClient } from '../context/ClientContext';
import { usePeriod } from '../context/PeriodContext';
import { DataTable, ColumnDef } from '../components/common/DataTable';
import { HierarchyPairChart } from '../components/charts/HierarchyPairChart';
import { buildChartItems, NO_SERIES_MESSAGE } from '../utils/chartSeries';
import { CampaignDetailDrawer } from '../components/drawers/CampaignDetailDrawer';
import { TableSkeleton } from '../components/common/Skeletons';
import { ErrorState } from '../components/common/ErrorState';

export const CampaignsView: React.FC = () => {
  const { selectedClient, selectedAccountId } = useClient();
  const { preset, startDate, endDate, compare, includeMetaTax } = usePeriod();
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // CPL no lugar de CPMQL: MQL não existe na Meta Ads API e ficaria sempre N/D.
  const [chartMetric, setChartMetric] = useState<'cpl' | 'leads' | 'spend'>('cpl');

  const loadCampaigns = async () => {
    if (!selectedClient) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.getCampaigns(selectedClient.id, selectedAccountId, {
        preset,
        startDate,
        endDate,
        compare,
        includeMetaTax
      });
      setCampaigns(data);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar campanhas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, [selectedClient, selectedAccountId, preset, startDate, endDate, compare, includeMetaTax]);

  if (loading && campaigns.length === 0) {
    return <TableSkeleton />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadCampaigns} />;
  }

  const formatMoney = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const formatNum = (v: number) => new Intl.NumberFormat('pt-BR').format(v || 0);

  // Séries do gráfico: diário real de cada campanha, vindo do snapshot do MCP.
  const chartItems = buildChartItems(campaigns, chartMetric);

  const columns: ColumnDef<CampaignData>[] = [
    {
      id: 'name',
      header: 'Campanha',
      accessor: c => c.name,
      align: 'left',
      sticky: true,
      cell: (name, row) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{name}</span>
          <span style={{ fontSize: '10.5px', color: 'var(--muted)' }}>ID: {row.externalCampaignId}</span>
        </div>
      ),
      width: '280px'
    },
    {
      id: 'status',
      header: 'Status',
      accessor: c => c.status,
      align: 'center',
      cell: v => (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            fontWeight: 700,
            color: v === 'ACTIVE' ? 'var(--good)' : 'var(--muted)'
          }}
        >
          {v === 'ACTIVE' ? <CheckCircle size={12} /> : <PauseCircle size={12} />}
          {v === 'ACTIVE' ? 'Ativo' : 'Pausado'}
        </span>
      )
    },
    {
      id: 'spend',
      header: 'Investimento',
      accessor: c => c.metrics.spend,
      cell: (v, row) => metricText(row.metrics, 'spend', v, formatMoney),
      heatmap: true,
      heatmapColor: 'var(--heat-gasto)'
    },
    {
      id: 'impressions',
      header: 'Impressões',
      accessor: c => c.metrics.impressions,
      cell: (v, row) => metricText(row.metrics, 'impressions', v, formatNum)
    },
    {
      id: 'clicks',
      header: 'Cliques',
      accessor: c => c.metrics.clicks,
      cell: (v, row) => metricText(row.metrics, 'clicks', v, formatNum)
    },
    {
      id: 'ctr',
      header: 'CTR',
      accessor: c => c.metrics.ctr,
      cell: (v, row) => metricText(row.metrics, 'ctr', v, n => n.toFixed(2) + '%')
    },
    {
      id: 'cpc',
      header: 'CPC',
      accessor: c => c.metrics.cpc,
      cell: (v, row) => metricText(row.metrics, 'cpc', v, formatMoney)
    },
    {
      id: 'cpm',
      header: 'CPM',
      accessor: c => c.metrics.cpm,
      cell: (v, row) => metricText(row.metrics, 'cpm', v, formatMoney)
    },
    {
      id: 'leads',
      header: 'Leads',
      accessor: c => c.metrics.leads,
      cell: (v, row) => metricText(row.metrics, 'leads', v, formatNum),
      heatmap: true,
      heatmapColor: 'var(--heat-leads)'
    },
    {
      id: 'cpl',
      header: 'CPL',
      accessor: c => c.metrics.cpl,
      cell: (v, row) => metricText(row.metrics, 'cpl', v, formatMoney)
    },
    {
      id: 'mqls',
      header: 'MQLs',
      accessor: c => c.metrics.mqls,
      cell: (v, row) => metricText(row.metrics, 'mqls', v, formatNum),
      heatmap: true,
      heatmapColor: 'var(--heat-mqls)'
    },
    {
      id: 'cpmql',
      header: 'CPMQL',
      accessor: c => c.metrics.cpmql,
      cell: (v, row) => metricText(row.metrics, 'cpmql', v, formatMoney)
    },
    {
      id: 'appointments',
      header: 'Agendamentos',
      accessor: c => c.metrics.appointments,
      cell: (v, row) => metricText(row.metrics, 'appointments', v, formatNum)
    },
    {
      id: 'conversions',
      header: 'Vendas',
      accessor: c => c.metrics.conversions,
      cell: (v, row) => metricText(row.metrics, 'conversions', v, formatNum),
      heatmap: true,
      heatmapColor: 'var(--heat-vendas)'
    },
    {
      id: 'cpa',
      header: 'CAC',
      accessor: c => c.metrics.cpa,
      cell: (v, row) => metricText(row.metrics, 'cpa', v, formatMoney)
    },
    {
      id: 'revenue',
      header: 'Receita',
      accessor: c => c.metrics.revenue,
      cell: (v, row) => metricText(row.metrics, 'revenue', v, formatMoney),
      heatmap: true,
      heatmapColor: 'var(--heat-rec)'
    },
    {
      id: 'roas',
      header: 'ROAS',
      accessor: c => c.metrics.roas,
      cell: (v, row) => <span style={{ fontWeight: 800, color: 'var(--good)' }}>{metricText(row.metrics, 'roas', v, n => n.toFixed(2) + 'x')}</span>
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">Performance de Campanhas</h2>
          <p className="page-description">
            Hierarquia principal de veiculação. Clique em uma campanha para abrir o raio-X completo com conjuntos e criativos.
          </p>
        </div>
      </div>

      {/* Tabela de Campanhas */}
      <DataTable
        data={campaigns}
        columns={columns}
        searchable
        searchPlaceholder="Buscar campanha pelo nome ou ID..."
        searchFilter={(row, q) => row.name.toLowerCase().includes(q) || row.externalCampaignId.includes(q)}
        onRowClick={cmp => setSelectedCampaign(cmp)}
        selectedId={selectedCampaign?.id}
        idAccessor={c => c.id}
        maxHeight="420px"
      />

      {/* Gráfico Pareado com Métricas */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div className="section-label" style={{ margin: 0 }}>
            Evolução Comparativa por Campanha
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              className={`btn btn-sm ${chartMetric === 'cpl' ? 'btn-active' : ''}`}
              onClick={() => setChartMetric('cpl')}
            >
              Custo por Lead
            </button>
            <button
              type="button"
              className={`btn btn-sm ${chartMetric === 'leads' ? 'btn-active' : ''}`}
              onClick={() => setChartMetric('leads')}
            >
              Leads
            </button>
            <button
              type="button"
              className={`btn btn-sm ${chartMetric === 'spend' ? 'btn-active' : ''}`}
              onClick={() => setChartMetric('spend')}
            >
              Investimento
            </button>
          </div>
        </div>

        {chartItems.length > 0 ? (
          <HierarchyPairChart
            title="Histórico Diário"
            metricLabel={chartMetric === 'cpl' ? 'CPL (R$)' : chartMetric === 'leads' ? 'Leads Cadastrados' : 'Investimento (R$)'}
            items={chartItems}
            isCurrency={chartMetric !== 'leads'}
            selectedId={selectedCampaign?.id}
            onSelectItem={id => {
              const found = campaigns.find(c => c.id === id) || null;
              setSelectedCampaign(found);
            }}
          />
        ) : (
          <div className="card" style={{ padding: '22px', textAlign: 'center', color: 'var(--muted)', fontSize: '12.5px' }}>
            {NO_SERIES_MESSAGE}
          </div>
        )}
      </div>

      {/* Drawer de Raio-X */}
      <CampaignDetailDrawer
        campaign={selectedCampaign}
        onClose={() => setSelectedCampaign(null)}
      />
    </div>
  );
};
