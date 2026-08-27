import React from 'react';
import {
  LayoutDashboard,
  Megaphone,
  Layers,
  Sparkles,
  FileSpreadsheet,
  Users,
  CreditCard,
  ShieldCheck,
  Lightbulb,
  ClipboardList,
  TrendingUp,
  X
} from 'lucide-react';
import { AppPage } from '../../types';
import { useClient } from '../../context/ClientContext';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../utils/permissions';

interface SidebarProps {
  currentPage: AppPage;
  onPageChange: (page: AppPage) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onPageChange,
  isOpenMobile,
  onCloseMobile
}) => {
  const { selectedClient } = useClient();
  const { user } = useAuth();

  const handleNav = (page: AppPage) => {
    onPageChange(page);
    onCloseMobile();
  };

  return (
    <aside className={`app-sidebar ${isOpenMobile ? 'open' : ''}`}>
      {/* Brand Header */}
      <div className="sidebar-brand">
        <div className="brand-icon">
          <TrendingUp size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="brand-title">ScaleAds</div>
          <div className="brand-subtitle">Performance Hub</div>
        </div>
        {isOpenMobile && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={onCloseMobile}
            style={{ background: 'transparent', border: 'none', color: '#fff', padding: '4px' }}
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="nav-section-title">Dashboards</div>
        <div
          className={`nav-link ${currentPage === 'geral' ? 'active' : ''}`}
          onClick={() => handleNav('geral')}
        >
          <LayoutDashboard size={16} />
          <span>Visão Geral Total</span>
        </div>
        <div
          className={`nav-link ${currentPage === 'campanhas' ? 'active' : ''}`}
          onClick={() => handleNav('campanhas')}
        >
          <Megaphone size={16} />
          <span>Campanhas</span>
        </div>
        <div
          className={`nav-link ${currentPage === 'conjuntos' ? 'active' : ''}`}
          onClick={() => handleNav('conjuntos')}
        >
          <Layers size={16} />
          <span>Conjuntos (AdSets)</span>
        </div>
        <div
          className={`nav-link ${currentPage === 'anuncios' ? 'active' : ''}`}
          onClick={() => handleNav('anuncios')}
        >
          <Sparkles size={16} />
          <span>Anúncios & Criativos</span>
        </div>
        <div
          className={`nav-link ${currentPage === 'analise' ? 'active' : ''}`}
          onClick={() => handleNav('analise')}
        >
          <Lightbulb size={16} />
          <span>Análise de Campanhas</span>
        </div>
        <div
          className={`nav-link ${currentPage === 'projeto' ? 'active' : ''}`}
          onClick={() => handleNav('projeto')}
        >
          <ClipboardList size={16} />
          <span>Projeto</span>
        </div>
        <div
          className={`nav-link ${currentPage === 'relatorio' ? 'active' : ''}`}
          onClick={() => handleNav('relatorio')}
        >
          <FileSpreadsheet size={16} />
          <span>Relatório & WhatsApp</span>
        </div>

        {/* Gestão só aparece para quem pode editar; admin ganha também os acessos. */}
        {can.editData(user) && (
          <>
            <div className="nav-section-title">Gestão</div>
            <div
              className={`nav-link ${currentPage === 'clientes' ? 'active' : ''}`}
              onClick={() => handleNav('clientes')}
            >
              <Users size={16} />
              <span>Clientes</span>
            </div>
            <div
              className={`nav-link ${currentPage === 'contas' ? 'active' : ''}`}
              onClick={() => handleNav('contas')}
            >
              <CreditCard size={16} />
              <span>Contas de Anúncios</span>
            </div>
            {can.manageUsers(user) && (
              <div
                className={`nav-link ${currentPage === 'usuarios' ? 'active' : ''}`}
                onClick={() => handleNav('usuarios')}
              >
                <ShieldCheck size={16} />
                <span>Usuários & Acessos</span>
              </div>
            )}
          </>
        )}
      </nav>

      {/* Footer info */}
      <div className="sidebar-footer">
        {selectedClient && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img
              src={selectedClient.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'}
              alt={selectedClient.name}
              style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }}
            />
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px', color: '#fff', fontWeight: 600 }}>
              {selectedClient.name}
            </div>
          </div>
        )}
        <div style={{ fontSize: '10.5px', opacity: 0.6 }}>
          Conectado ao Meta Ads v21.0
        </div>
      </div>
    </aside>
  );
};
