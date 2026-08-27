import React, { useEffect, useState } from 'react';
import { CheckCircle, PauseCircle, Filter } from 'lucide-react';
import { AdSetData, CampaignData } from '../types';
import { metricText } from '../utils/metrics';
import { api } from '../services/api';
import { useClient } from '../context/ClientContext';
import { usePeriod } from '../context/PeriodContext';
import { DataTable, ColumnDef } from '../components/common/DataTable';
import { HierarchyPairChart } from '../components/charts/HierarchyPairChart';
import { buildChartItems, NO_SERIES_MESSAGE } from '../utils/chartSeries';
import { TableSkeleton } from '../components/common/Skeletons';
import { ErrorState } from '../components/common/ErrorState';

export const AdSetsView: React.FC = () => {
  const { selectedClient, selectedAccountId } = useClient();
  const { preset, startDate, endDate, compare, includeMetaTax } = usePeriod();
  const [adSets, setAdSets] = useState<AdSetData[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [filterCampaignId, setFilterCampaignId] = useState<string>('all');
  const [selectedAdSetId, setSelectedAdSetId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!selectedClient) return;
    try {
      setLoading(true);
      setError(null);
      const [adSetsData, campaignsData] = await Promise.all([
        api.getAdSets(selectedClient.id, selectedAccountId, filterCampaignId === 'all' ? undefined : filterCampaignId, {
          preset,
          startDate,
          endDate,
          compare,
          includeMetaTax
        }),
        api.getCampaigns(selectedClient.id, selectedAccountId, { preset, startDate, endDate })
      ]);
      setAdSets(adSetsData);
      setCampaigns(campaignsData);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar conjuntos de anúncios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedClient, selectedAccountId, filterCampaignId, preset, startDate, endDate, compare, includeMetaTax]);

  if (loading && adSets.length === 0) return <TableSkeleton />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;

  const formatMoney = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const formatNum = (v: number) => new Intl.NumberFormat('pt-BR').format(v || 0);
  // Séries do gráfico: diário real de cada entidade, vindo do snapshot do MCP.
  const chartItems = buildChartItems(adSets, 'cpl');

  const columns: ColumnDef<AdSetData>[] = [
    {
      id: 'name',
      header: 'Conjunto de Anúncios',
      accessor: a => a.name,
      align: 'left',
      sticky: true,
      cell: (name, row) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{name}</span>
          <span style={{ fontSize: '10.5px', color: 'var(--muted)' }}>Campanha: {row.campaignName}</span>
        </div>
      ),
      width: '280px'
    },
    {
      id: 'status',
      header: 'Status',
      accessor: a => a.status,
      align: 'center',
      cell: v => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: 'var(--good)' }}>
          <CheckCircle size={12} /> Ativo
        </span>
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
      id: 'impressions',
      header: 'Impressões',
      accessor: a => a.metrics.impressions,
      cell: (v, row) => metricText(row.metrics, 'impressions', v, formatNum)
    },
    {
      id: 'clicks',
      header: 'Cliques',
      accessor: a => a.metrics.clicks,
      cell: (v, row) => metricText(row.metrics, 'clicks', v, formatNum)
    },
    {
      id: 'ctr',
      header: 'CTR',
      accessor: a => a.metrics.ctr,
      cell: (v, row) => metricText(row.metrics, 'ctr', v, n => n.toFixed(2) + '%')
    },
    {
      id: 'cpc',
      header: 'CPC',
      accessor: a => a.metrics.cpc,
      cell: (v, row) => metricText(row.metrics, 'cpc', v, formatMoney)
    },
    {
      id: 'leads',
      header: 'Leads',
      accessor: a => a.metrics.leads,
      cell: (v, row) => metricText(row.metrics, 'leads', v, formatNum),
      heatmap: true,
      heatmapColor: 'var(--heat-leads)'
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
      cell: (v, row) => metricText(row.metrics, 'mqls', v, formatNum),
      heatmap: true,
      heatmapColor: 'var(--heat-mqls)'
    },
    {
      id: 'cpmql',
      header: 'CPMQL',
      accessor: a => a.metrics.cpmql,
      cell: (v, row) => metricText(row.metrics, 'cpmql', v, formatMoney)
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
      cell: (v, row) => metricText(row.metrics, 'conversions', v, formatNum),
      heatmap: true,
      heatmapColor: 'var(--heat-vendas)'
    },
    {
      id: 'cpa',
      header: 'CAC',
      accessor: a => a.metrics.cpa,
      cell: (v, row) => metricText(row.metrics, 'cpa', v, formatMoney)
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">Conjuntos de Anúncios (AdSets)</h2>
          <p className="page-description">
            Performance segmentada por públicos-alvo, posicionamentos e testes de criativos.
          </p>
        </div>

        {/* Filtro por Campanha */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Filter size={14} style={{ color: 'var(--muted)' }} />
          <select
            value={filterCampaignId}
            onChange={e => setFilterCampaignId(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '9px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface)',
              color: 'var(--ink)',
              fontSize: '12.5px',
              fontWeight: 500
            }}
          >
            <option value="all">Todas as Campanhas ({campaigns.length})</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <DataTable
        data={adSets}
        columns={columns}
        searchable
        searchPlaceholder="Buscar conjunto pelo nome..."
        searchFilter={(row, q) => row.name.toLowerCase().includes(q) || row.campaignName.toLowerCase().includes(q)}
        onRowClick={as => setSelectedAdSetId(as.id === selectedAdSetId ? '' : as.id)}
        selectedId={selectedAdSetId}
        idAccessor={a => a.id}
        maxHeight="420px"
      />

      {chartItems.length > 0 ? (
        <HierarchyPairChart
          title="Custo por Lead por Conjunto"
          metricLabel="CPL Diário (R$)"
          items={chartItems}
          selectedId={selectedAdSetId}
          onSelectItem={id => setSelectedAdSetId(id)}
        />
      ) : (
        <div className="card" style={{ padding: '22px', textAlign: 'center', color: 'var(--muted)', fontSize: '12.5px' }}>
          {NO_SERIES_MESSAGE}
        </div>
      )}
    </div>
  );
};
