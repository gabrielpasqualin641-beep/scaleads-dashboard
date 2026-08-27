import React, { useEffect, useState } from 'react';
import { X, ExternalLink, TrendingUp, CheckCircle, PauseCircle, Layers } from 'lucide-react';
import { CampaignData, AdSetData, AdData } from '../../types';
import { metricText } from '../../utils/metrics';
import { CreativeThumb } from '../common/CreativeThumb';
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
          width: '640px',
          maxWidth: '92vw',
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
              {campaign.status === 'ACTIVE' ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--good)', fontSize: '11.5px', fontWeight: 700 }}>
                  <CheckCircle size={13} /> Ativo
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--muted)', fontSize: '11.5px', fontWeight: 700 }}>
                  <PauseCircle size={13} /> Pausado
                </span>
              )}
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
          {/* Quick Metrics Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            <div className="card" style={{ padding: '12px' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Investimento</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--bad)', marginTop: '4px' }} className="tabular-nums">
                {metricText(campaign.metrics, 'spend', campaign.metrics.spend, formatMoney)}
              </div>
            </div>
            <div className="card" style={{ padding: '12px' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Leads & MQLs</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--accent-blue)', marginTop: '4px' }} className="tabular-nums">
                {metricText(campaign.metrics, 'leads', campaign.metrics.leads, formatNum)} <span style={{ fontSize: '12px', color: 'var(--good)' }}>({metricText(campaign.metrics, 'mqls', campaign.metrics.mqls, formatNum)} MQLs)</span>
              </div>
            </div>
            <div className="card" style={{ padding: '12px' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>CPL & CPMQL</div>
              <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '4px' }} className="tabular-nums">
                {metricText(campaign.metrics, 'cpl', campaign.metrics.cpl, formatMoney)} <span style={{ fontSize: '11px', color: 'var(--muted)' }}>/ {metricText(campaign.metrics, 'cpmql', campaign.metrics.cpmql, formatMoney)}</span>
              </div>
            </div>
            <div className="card" style={{ padding: '12px' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Agendamentos</div>
              <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '4px' }} className="tabular-nums">
                {metricText(campaign.metrics, 'appointments', campaign.metrics.appointments, formatNum)}
              </div>
            </div>
            <div className="card" style={{ padding: '12px' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Vendas & CAC</div>
              <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '4px' }} className="tabular-nums">
                {metricText(campaign.metrics, 'conversions', campaign.metrics.conversions, formatNum)} <span style={{ fontSize: '11px', color: 'var(--muted)' }}>({metricText(campaign.metrics, 'cpa', campaign.metrics.cpa, formatMoney)})</span>
              </div>
            </div>
            <div className="card" style={{ padding: '12px' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Faturamento & ROAS</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--good)', marginTop: '4px' }} className="tabular-nums">
                {metricText(campaign.metrics, 'revenue', campaign.metrics.revenue, formatMoney)} <span style={{ fontSize: '12px' }}>({metricText(campaign.metrics, 'roas', campaign.metrics.roas, n => n.toFixed(2) + 'x')})</span>
              </div>
            </div>
          </div>

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
