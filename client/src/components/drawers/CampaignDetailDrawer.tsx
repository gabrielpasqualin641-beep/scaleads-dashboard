import { StatusBadge } from '../common/StatusBadge';
import React, { useEffect, useState } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { CampaignData, AdSetData, AdData } from '../../types';
import { dropEmptyMetricColumns } from '../../utils/metrics';
import { CreativeThumb } from '../common/CreativeThumb';
import { FunnelStage } from '../common/FunnelStage';
import { ComboEvolutionChart } from '../charts/ComboEvolutionChart';
import { DailyIndicatorPairs } from '../charts/DailyIndicatorPairs';
import { DataTable, ColumnDef } from '../common/DataTable';
import { entityMetricColumns } from '../../utils/entityColumns';
import { buildDailyColumns, buildDailyFooter } from '../../utils/dailyColumns';
import { api } from '../../services/api';
import { useClient } from '../../context/ClientContext';
import { usePeriod } from '../../context/PeriodContext';

interface CampaignDetailDrawerProps {
  campaign: CampaignData | null;
  onClose: () => void;
}

export const CampaignDetailDrawer: React.FC<CampaignDetailDrawerProps> = ({
  campaign,
  onClose
}) => {
  const { selectedClient } = useClient();
  const { preset, startDate, endDate, compare, includeMetaTax } = usePeriod();
  const [adSets, setAdSets] = useState<AdSetData[]>([]);
  const [ads, setAds] = useState<AdData[]>([]);
  const [loading, setLoading] = useState(false);
  // Conjunto clicado: filtra a tabela de anúncios. Vazio = todos da campanha.
  const [selectedAdSetId, setSelectedAdSetId] = useState('');

  // Fecha o drawer com Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (campaign) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [campaign, onClose]);

  useEffect(() => {
    if (!campaign || !selectedClient) return;

    setSelectedAdSetId('');
    const loadDrilldown = async () => {
      try {
        setLoading(true);
        const [adSetsData, adsData] = await Promise.all([
          api.getAdSets(selectedClient.id, campaign.adAccountId, campaign.id, {
            preset,
            startDate,
            endDate,
            compare,
            includeMetaTax
          }),
          api.getAds(selectedClient.id, campaign.adAccountId, undefined, {
            preset,
            startDate,
            endDate,
            compare,
            includeMetaTax
          })
        ]);
        setAdSets(adSetsData);
        setAds(adsData.filter(a => a.campaignId === campaign.id));
      } catch (err) {
        console.error('Erro ao carregar detalhes da campanha:', err);
      } finally {
        setLoading(false);
      }
    };

    loadDrilldown();
  }, [campaign, selectedClient, preset, startDate, endDate, compare, includeMetaTax]);


  if (!campaign) return null;

  // Série do dia mais antigo ao mais recente; a tabela mostra invertida (hoje no topo).
  const daily = [...(campaign.dailyMetrics || [])].sort((x, y) => x.date.localeCompare(y.date));
  // Coluna que a origem não mede em nenhum dia não entra (ex.: vendas numa conta de formulário).
  const { columns: dailyColumns } = dropEmptyMetricColumns(buildDailyColumns(), daily, d => d);

  const adSetColumns = dropEmptyMetricColumns<ColumnDef<AdSetData>, AdSetData>(
    [
      {
        id: 'name',
        header: 'Conjunto',
        accessor: as => as.name,
        align: 'left',
        sticky: true,
        width: '240px',
        cell: (name, row) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <StatusBadge status={row.status} size={11} />
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{name}</span>
          </div>
        )
      },
      ...entityMetricColumns<AdSetData>()
    ],
    adSets,
    r => r.metrics
  ).columns;

  const visibleAds = selectedAdSetId ? ads.filter(ad => ad.adSetId === selectedAdSetId) : ads;
  const adColumns = dropEmptyMetricColumns<ColumnDef<AdData>, AdData>(
    [
      {
        id: 'preview',
        header: 'Criativo',
        accessor: ad => ad.previewUrl,
        align: 'center',
        sticky: true,
        width: '60px',
        cell: (url, row) => <CreativeThumb url={url} name={row.name} format={row.format} size={40} />
      },
      {
        id: 'name',
        header: 'Anúncio',
        accessor: ad => ad.name,
        align: 'left',
        width: '240px',
        cell: (name, row) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{name}</span>
            <span style={{ fontSize: '10.5px', color: 'var(--muted)' }}>{row.adSetName}</span>
          </div>
        )
      },
      {
        id: 'link',
        header: 'Link',
        accessor: ad => ad.permalinkUrl,
        align: 'center',
        cell: url =>
          url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-sm"
              style={{ padding: '4px 8px', gap: '4px', textDecoration: 'none', color: 'var(--accent-blue)' }}
              onClick={e => e.stopPropagation()}>
              <ExternalLink size={12} /> Ver
            </a>
          ) : (
            <span style={{ color: 'var(--muted)', fontSize: '11px' }}>—</span>
          )
      },
      ...entityMetricColumns<AdData>()
    ],
    ads,
    r => r.metrics
  ).columns;


  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: 100,
        display: 'flex',
        justifyContent: 'flex-end',
        animation: 'fadeIn 0.2s ease-out'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '1120px',
          maxWidth: '96vw',
          backgroundColor: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.2)',
          overflowY: 'auto'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <StatusBadge status={campaign.status} size={13} />
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>ID: {campaign.externalCampaignId}</span>
            </div>
            <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--ink)' }}>{campaign.name}</h2>
          </div>

          <button
            type="button"
            className="btn btn-sm"
            onClick={onClose}
            style={{ padding: '6px' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Drawer Content */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {daily.length === 0 ? (
            <div className="card" style={{ padding: '18px', textAlign: 'center', color: 'var(--muted)', fontSize: '12.5px' }}>
              Esta campanha não tem série diária no período selecionado.
            </div>
          ) : (
            <>
              {/* 1. Funil + combinação diária */}
              <div>
                <div className="section-label">Funil &amp; Combinação Diária</div>
                <div className="funnel-chart-grid">
                  <div className="card">
                    <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px' }}>Funil da Campanha</h3>
                    <FunnelStage metrics={campaign.metrics} />
                  </div>
                  <div>
                    <ComboEvolutionChart dailyData={daily} />
                  </div>
                </div>
              </div>

              {/* 2. Tabela diária com heatmap */}
              <div>
                <div className="section-label">Detalhamento Diário &middot; Histórico com Heatmap</div>
                <DataTable
                  data={[...daily].reverse()}
                  columns={dailyColumns}
                  maxHeight="320px"
                  footerData={buildDailyFooter(campaign.metrics, 'TOTAL GERAL')}
                />
              </div>

              {/* 3. Indicadores por dia */}
              <div>
                <div className="section-label">Indicadores por Dia</div>
                <DailyIndicatorPairs daily={daily} />
              </div>
            </>
          )}

          {/* 4. Conjuntos da campanha */}
          <div>
            <div className="section-label">
              Conjuntos de Anúncios ({adSets.length})
              {selectedAdSetId && (
                <button type="button" className="btn btn-sm" style={{ marginLeft: '10px' }} onClick={() => setSelectedAdSetId('')}>
                  Mostrar todos os anúncios
                </button>
              )}
            </div>
            {loading ? (
              <div className="card" style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>Carregando conjuntos...</div>
            ) : adSets.length === 0 ? (
              <div className="card" style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', fontSize: '12.5px' }}>
                Nenhum conjunto com dado no período.
              </div>
            ) : (
              <>
                <DataTable
                  data={adSets}
                  columns={adSetColumns}
                  onRowClick={as => setSelectedAdSetId(prev => (prev === as.id ? '' : as.id))}
                  selectedId={selectedAdSetId}
                  idAccessor={as => as.id}
                  maxHeight="300px"
                />
                <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '6px' }}>
                  Clique num conjunto para ver só os anúncios dele.
                </p>
              </>
            )}
          </div>

          {/* 5. Anúncios da campanha (ou do conjunto selecionado) */}
          <div>
            <div className="section-label">
              Anúncios &amp; Criativos ({visibleAds.length})
              {selectedAdSetId && (
                <span style={{ textTransform: 'none', fontWeight: 600, marginLeft: '6px' }}>
                  · conjunto {adSets.find(x => x.id === selectedAdSetId)?.name}
                </span>
              )}
            </div>
            {loading ? (
              <div className="card" style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>Carregando anúncios...</div>
            ) : visibleAds.length === 0 ? (
              <div className="card" style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', fontSize: '12.5px' }}>
                Nenhum anúncio com dado no período.
              </div>
            ) : (
              <DataTable data={visibleAds} columns={adColumns} idAccessor={ad => ad.id} maxHeight="360px" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
