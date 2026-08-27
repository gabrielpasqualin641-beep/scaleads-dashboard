import React, { useState } from 'react';
import { CreditCard, CheckCircle, RefreshCw, Plus, Globe, Clock, ShieldCheck } from 'lucide-react';
import { useClient } from '../context/ClientContext';
import { AdAccount } from '../types';

export const AccountsView: React.FC = () => {
  const { accounts, selectedClient, createAccount } = useClient();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [isAddingAccount, setIsAddingAccount] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [externalAccountId, setExternalAccountId] = useState('');
  const [currency, setCurrency] = useState('BRL');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');

  const handleTestConnection = async (accId: string) => {
    try {
      setTestingId(accId);
      const res = await fetch(`/api/accounts/${accId}/test`, { method: 'POST' });
      const json = await res.json();
      setTestResults(prev => ({ ...prev, [accId]: json.message || 'Conexão ativa e validada.' }));
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [accId]: 'Falha ao testar conexão.' }));
    } finally {
      setTestingId(null);
    }
  };

  const handleCreateNewAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !name || !externalAccountId) return;
    await createAccount({
      clientId: selectedClient.id,
      name,
      externalAccountId: externalAccountId.startsWith('act_') ? externalAccountId : `act_${externalAccountId}`,
      platform: 'meta_ads',
      currency,
      timezone
    });
    setName('');
    setExternalAccountId('');
    setIsAddingAccount(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">Contas de Anúncios Vinculadas</h2>
          <p className="page-description">
            Gerenciamento técnico das conexões Meta Ads para o cliente <b>{selectedClient?.name}</b>.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setIsAddingAccount(true)}
          style={{ gap: '6px' }}
        >
          <Plus size={15} /> Vincular Nova Conta Meta
        </button>
      </div>

      {isAddingAccount && (
        <form
          onSubmit={handleCreateNewAccount}
          className="card"
          style={{ padding: '20px', border: '1px solid var(--accent-blue)', display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          <h3 style={{ fontSize: '14px', fontWeight: 800 }}>Vincular Nova Conta Meta Ads</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div className="date-input-group">
              <label>Nome Amigável da Conta *</label>
              <input
                type="text"
                placeholder="Ex: Meta Ads — Tráfego Direto"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
            <div className="date-input-group">
              <label>ID da Conta (act_...) *</label>
              <input
                type="text"
                placeholder="act_982347102938473"
                value={externalAccountId}
                onChange={e => setExternalAccountId(e.target.value)}
                required
              />
            </div>
            <div className="date-input-group">
              <label>Moeda</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
              >
                <option value="BRL">BRL (R$)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
            <div className="date-input-group">
              <label>Fuso Horário</label>
              <select
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
              >
                <option value="America/Sao_Paulo">America/Sao_Paulo</option>
                <option value="America/New_York">America/New_York</option>
                <option value="Europe/Lisbon">Europe/Lisbon</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" className="btn btn-sm" onClick={() => setIsAddingAccount(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary btn-sm">
              Salvar Conta
            </button>
          </div>
        </form>
      )}

      {/* Grid de Contas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
        {accounts.map(acc => {
          const isTesting = testingId === acc.id;
          const resultMsg = testResults[acc.id];
          return (
            <div key={acc.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--accent-blue-light)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent-blue)'
                    }}
                  >
                    <CreditCard size={18} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink)' }}>{acc.name}</h3>
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{acc.externalAccountId}</div>
                  </div>
                </div>

                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--good)',
                    backgroundColor: 'var(--good-bg)',
                    padding: '2px 8px',
                    borderRadius: '999px'
                  }}
                >
                  <CheckCircle size={11} /> Conectado
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                <div style={{ padding: '8px', background: 'var(--bg)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Globe size={13} style={{ color: 'var(--muted)' }} />
                  <div>
                    <div style={{ color: 'var(--muted)', fontSize: '10px' }}>Moeda</div>
                    <div style={{ fontWeight: 700 }}>{acc.currency}</div>
                  </div>
                </div>
                <div style={{ padding: '8px', background: 'var(--bg)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Clock size={13} style={{ color: 'var(--muted)' }} />
                  <div>
                    <div style={{ color: 'var(--muted)', fontSize: '10px' }}>Fuso Horário</div>
                    <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {acc.timezone.split('/')[1] || acc.timezone}
                    </div>
                  </div>
                </div>
              </div>

              {resultMsg && (
                <div style={{ padding: '8px 10px', backgroundColor: 'var(--good-bg)', color: 'var(--good)', borderRadius: '8px', fontSize: '11.5px', fontWeight: 600 }}>
                  ✓ {resultMsg}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  Sincronizado: {new Date(acc.lastSyncAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => handleTestConnection(acc.id)}
                  disabled={isTesting}
                  style={{ gap: '4px' }}
                >
                  <RefreshCw size={12} className={isTesting ? 'spin' : ''} />
                  <span>{isTesting ? 'Validando...' : 'Testar Conexão'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
