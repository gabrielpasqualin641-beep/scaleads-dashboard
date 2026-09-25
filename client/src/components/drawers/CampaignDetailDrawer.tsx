import { StatusBadge } from '../common/StatusBadge';
import React, { useEffect, useState } from 'react';
import { X, ExternalLink, TrendingUp, Layers } from 'lucide-react';
import { CampaignData, AdSetData, AdData } from '../../types';
import { metricText, dropEmptyMetricColumns } from '../../utils/metrics';
import { CreativeThumb } from '../common/CreativeThumb';
import { FunnelStage } from '../common/FunnelStage';
import { ComboEvolutionChart } from '../charts/ComboEvolutionChart';
import { DailyIndicatorPairs } from '../charts/DailyIndicatorPairs';
import { DataTable } from '../common/DataTable';
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

  const formatMoney = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const formatNum = (v: number) => new Intl.NumberFormat('pt-BR').format(v || 0);

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

          {/* Ad Sets List */}
          <div>
            <h3 style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', fontWeight: 700, marginBottom: '10px' }}>
              Conjuntos de Anúncios ({adSets.length})
            </h3>
            {loading ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>Carregando conjuntos...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {adSets.map(as => (
                  <div
                    key={as.id}
                    className="card"
                    style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--ink)' }}>{as.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                        Investimento: <b>{formatMoney(as.metrics.spend)}</b> · {as.metrics.leads} leads · CPL: {formatMoney(as.metrics.cpl)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--accent-blue)' }} className="tabular-nums">
                        {as.metrics.mqls} MQLs
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }} className="tabular-nums">
                        CPMQL {formatMoney(as.metrics.cpmql)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ads List */}
          <div>
            <h3 style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', fontWeight: 700, marginBottom: '10px' }}>
              Anúncios & Criativos ({ads.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {ads.map(ad => (
                <div
                  key={ad.id}
                  className="card"
                  style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '12px' }}
                >
                  <CreativeThumb url={ad.previewUrl} name={ad.name} format={ad.format} size={48} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ad.name}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                      Gasto: <b>{formatMoney(ad.metrics.spend)}</b> · {ad.metrics.leads} leads · CTR: {ad.metrics.ctr.toFixed(2)}%
                    </div>
                  </div>
                  {ad.permalinkUrl && (
                    <a
                      href={ad.permalinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm"
                      style={{ padding: '6px 8px', gap: '4px', textDecoration: 'none', color: 'var(--accent-blue)' }}
                    >
                      <ExternalLink size={12} /> Ver Anúncio
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
