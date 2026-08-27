import React, { useEffect, useState } from 'react';
import { ExternalLink, CheckCircle, Sparkles } from 'lucide-react';
import { AdData } from '../types';
import { metricText } from '../utils/metrics';
import { api } from '../services/api';
import { useClient } from '../context/ClientContext';
import { usePeriod } from '../context/PeriodContext';
import { DataTable, ColumnDef } from '../components/common/DataTable';
import { HierarchyPairChart } from '../components/charts/HierarchyPairChart';
import { buildChartItems, NO_SERIES_MESSAGE } from '../utils/chartSeries';
import { CreativeThumb } from '../components/common/CreativeThumb';
import { TableSkeleton } from '../components/common/Skeletons';
import { ErrorState } from '../components/common/ErrorState';

export const AdsView: React.FC = () => {
  const { selectedClient, selectedAccountId } = useClient();
  const { preset, startDate, endDate, compare, includeMetaTax } = usePeriod();
  const [ads, setAds] = useState<AdData[]>([]);
  const [selectedAdId, setSelectedAdId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!selectedClient) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.getAds(selectedClient.id, selectedAccountId, undefined, {
        preset,
        startDate,
        endDate,
        compare,
        includeMetaTax
      });
      setAds(data);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar anúncios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedClient, selectedAccountId, preset, startDate, endDate, compare, includeMetaTax]);

  if (loading && ads.length === 0) return <TableSkeleton />;
  if (error) return <ErrorState message={error} onRetry={loadData} />;

  const formatMoney = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const formatNum = (v: number) => new Intl.NumberFormat('pt-BR').format(v || 0);
  // Séries do gráfico: diário real de cada entidade, vindo do snapshot do MCP.
  const chartItems = buildChartItems(ads, 'cpl');

  const columns: ColumnDef<AdData>[] = [
    {
      id: 'preview',
      header: 'Criativo',
      accessor: a => a.previewUrl,
      align: 'center',
      sticky: true,
      width: '60px',
      cell: (url, row) => <CreativeThumb url={url} name={row.name} format={row.format} />
    },
    {
      id: 'name',
      header: 'Anúncio / Criativo',
      accessor: a => a.name,
      align: 'left',
      sticky: true,
      cell: (name, row) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{name}</span>
          <span style={{ fontSize: '10.5px', color: 'var(--muted)' }}>
            {row.adSetName} · {row.campaignName}
          </span>
        </div>
      ),
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
            onClick={e => e.stopPropagation()}
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
          <h2 className="page-title">Anúncios & Criativos</h2>
          <p className="page-description">
            Visualização granular de cada criativo veiculado com métricas de engajamento, custo por qualificação e conversão.
          </p>
        </div>
      </div>

      <DataTable
        data={ads}
        columns={columns}
        searchable
        searchPlaceholder="Buscar anúncio por título, formato ou conjunto..."
        searchFilter={(row, q) => row.name.toLowerCase().includes(q) || row.adSetName.toLowerCase().includes(q)}
        onRowClick={ad => setSelectedAdId(ad.id === selectedAdId ? '' : ad.id)}
        selectedId={selectedAdId}
        idAccessor={a => a.id}
        maxHeight="420px"
      />

      {chartItems.length > 0 ? (
        <HierarchyPairChart
          title="Custo por Lead por Anúncio"
          metricLabel="CPL Diário (R$)"
          items={chartItems}
          selectedId={selectedAdId}
          onSelectItem={id => setSelectedAdId(id)}
        />
      ) : (
        <div className="card" style={{ padding: '22px', textAlign: 'center', color: 'var(--muted)', fontSize: '12.5px' }}>
          {NO_SERIES_MESSAGE}
        </div>
      )}
    </div>
  );
};
