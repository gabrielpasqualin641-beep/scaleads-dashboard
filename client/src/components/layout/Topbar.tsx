import React, { useState, useRef, useEffect } from 'react';
import {
  Menu,
  ChevronDown,
  RefreshCw,
  Sun,
  Moon,
  Building2,
  Check,
  LogOut
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { can, ROLE_LABELS } from '../../utils/permissions';
import { useClient } from '../../context/ClientContext';
import { usePeriod } from '../../context/PeriodContext';
import { useTheme } from '../../context/ThemeContext';
import { PeriodPicker } from '../common/PeriodPicker';

interface TopbarProps {
  onOpenMobileSidebar: () => void;
  onRefreshData?: () => Promise<void>;
  isRefreshing?: boolean;
  lastSyncTime?: string;
}

export const Topbar: React.FC<TopbarProps> = ({
  onOpenMobileSidebar,
  onRefreshData,
  isRefreshing = false,
  lastSyncTime
}) => {
  const { clients, selectedClient, setSelectedClient, accounts, selectedAccountId, setSelectedAccountId } = useClient();
  const { compare, toggleCompare, includeMetaTax, toggleMetaTax } = usePeriod();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const accountDropdownRef = useRef<HTMLDivElement>(null);

  // Click-outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(event.target as Node)) {
        setIsClientDropdownOpen(false);
      }
      if (accountDropdownRef.current && !accountDropdownRef.current.contains(event.target as Node)) {
        setIsAccountDropdownOpen(false);
      }
    };
    if (isClientDropdownOpen || isAccountDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isClientDropdownOpen, isAccountDropdownOpen]);

  const selectedAccountName =
    selectedAccountId === 'all'
      ? 'Todas as Contas'
      : accounts.find(a => a.id === selectedAccountId)?.name || 'Conta Selecionada';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="btn btn-sm"
          onClick={onOpenMobileSidebar}
          style={{ display: 'none', padding: '6px' }}
          id="mobileMenuBtn"
        >
          <Menu size={18} />
        </button>

        {/* Client Selector Dropdown */}
        <div style={{ position: 'relative' }} ref={clientDropdownRef}>
          <button
            type="button"
            className="client-select-btn"
            onClick={() => setIsClientDropdownOpen(!isClientDropdownOpen)}
          >
            {selectedClient?.avatarUrl ? (
              <img src={selectedClient.avatarUrl} alt={selectedClient.name} className="client-avatar" />
            ) : (
              <Building2 size={16} style={{ color: 'var(--accent-blue)' }} />
            )}
            <div style={{ textAlign: 'left', lineHeight: '1.2' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 500 }}>Cliente</div>
              <div style={{ fontSize: '13px', fontWeight: 700, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedClient?.name || 'Selecione um cliente'}
              </div>
            </div>
            <ChevronDown size={14} style={{ color: 'var(--muted)', marginLeft: '4px' }} />
          </button>

          {isClientDropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: 0,
                zIndex: 60,
                width: '240px',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                boxShadow: '0 12px 30px rgba(0,0,0,0.15)',
                padding: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}
            >
              <div style={{ fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700, padding: '6px 10px 4px' }}>
                Alternar Cliente
              </div>
              {clients.map(c => {
                const isSel = selectedClient?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelectedClient(c);
                      setIsClientDropdownOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: isSel ? 'var(--selected)' : 'transparent',
                      color: 'var(--ink)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '12.5px',
                      fontWeight: isSel ? 700 : 500
                    }}
                  >
                    <img
                      src={c.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'}
                      alt={c.name}
                      style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                      <div style={{ fontSize: '10.5px', color: 'var(--muted)' }}>{c.companyName}</div>
                    </div>
                    {isSel && <Check size={14} style={{ color: 'var(--accent-blue)' }} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Ad Account Selector Dropdown */}
        {accounts.length > 1 && (
          <div style={{ position: 'relative' }} ref={accountDropdownRef}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
              style={{ fontWeight: 600 }}
            >
              <span>{selectedAccountName}</span>
              <ChevronDown size={12} style={{ color: 'var(--muted)' }} />
            </button>

            {isAccountDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  zIndex: 60,
                  width: '260px',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  boxShadow: '0 12px 30px rgba(0,0,0,0.15)',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px'
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAccountId('all');
                    setIsAccountDropdownOpen(false);
                  }}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: selectedAccountId === 'all' ? 'var(--selected)' : 'transparent',
                    color: 'var(--ink)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: selectedAccountId === 'all' ? 700 : 500
                  }}
                >
                  Todas as Contas ({accounts.length})
                </button>
                {accounts.map(acc => {
                  const isSel = selectedAccountId === acc.id;
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => {
                        setSelectedAccountId(acc.id);
                        setIsAccountDropdownOpen(false);
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: 'none',
                        backgroundColor: isSel ? 'var(--selected)' : 'transparent',
                        color: 'var(--ink)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: isSel ? 700 : 500
                      }}
                    >
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
                        {acc.externalAccountId} · {acc.currency}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Topbar Actions */}
      <div className="topbar-actions">
        {/* Period Picker */}
        <PeriodPicker />

        {/* Compare with Previous Toggle */}
        <div
          className={`custom-toggle ${compare ? 'active' : ''}`}
          onClick={toggleCompare}
          title="Comparar período atual com período anterior"
        >
          <div className="toggle-switch" />
          <span>Comparar</span>
        </div>

        {/* Meta Tax Toggle */}
        <div
          className={`custom-toggle ${includeMetaTax ? 'active' : ''}`}
          onClick={toggleMetaTax}
          title="Aplicar fator de 13.806% de imposto sobre veiculação no Brasil"
        >
          <div className="toggle-switch" />
          <span>Imposto Meta</span>
        </div>

        <div className="divider-v" />

        {/* Theme Toggle */}
        <button
          type="button"
          className="btn btn-sm"
          onClick={toggleTheme}
          title="Alternar entre tema Claro e Escuro"
          style={{ padding: '7px 10px' }}
        >
          {theme === 'dark' ? <Sun size={14} style={{ color: '#F59E0B' }} /> : <Moon size={14} />}
        </button>

        {/* Sincronizar altera dados: só para editor e admin. */}
        {can.editData(user) && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRefreshData}
            disabled={isRefreshing}
            style={{ gap: '6px' }}
          >
            <RefreshCw size={13} className={isRefreshing ? 'spin' : ''} />
            <span>{isRefreshing ? 'Atualizando...' : 'Atualizar Dados'}</span>
          </button>
        )}

        {lastSyncTime && (
          <div style={{ fontSize: '11px', color: 'var(--muted)' }} className="tabular-nums">
            {new Date(lastSyncTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}

        <div className="divider-v" />

        {/* Sessão do administrador */}
        <button
          type="button"
          className="btn btn-sm"
          onClick={logout}
          title={user ? `${user.email} · ${ROLE_LABELS[user.role]} — clique para sair` : 'Sair'}
          style={{ gap: '6px' }}
        >
          <LogOut size={13} />
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15, maxWidth: '130px' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '130px' }}>
              {user?.name?.split(' ')[0] || 'Sair'}
            </span>
            {user && (
              <span style={{ fontSize: '9.5px', color: 'var(--muted)', fontWeight: 600 }}>
                {ROLE_LABELS[user.role]}
              </span>
            )}
          </span>
        </button>
      </div>
    </header>
  );
};
