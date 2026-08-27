import React, { useState } from 'react';
import { X, Plus, Building2, CreditCard } from 'lucide-react';
import { useClient } from '../../context/ClientContext';

interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ClientModal: React.FC<ClientModalProps> = ({ isOpen, onClose }) => {
  const { createClient, createAccount } = useClient();
  const [tab, setTab] = useState<'client' | 'account'>('client');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Client form
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  // Account form
  const [accountName, setAccountName] = useState('');
  const [externalAccountId, setExternalAccountId] = useState('');
  const [currency, setCurrency] = useState('BRL');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [accessToken, setAccessToken] = useState('');

  if (!isOpen) return null;

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !companyName.trim()) {
      setError('Nome e Empresa são obrigatórios.');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const newClient = await createClient({
        name,
        companyName,
        email,
        phone,
        avatarUrl: avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'
      });

      // Cria conta Meta padrão para o cliente
      if (externalAccountId.trim()) {
        await createAccount({
          clientId: newClient.id,
          name: accountName || `Meta Ads — ${companyName}`,
          externalAccountId: externalAccountId.startsWith('act_') ? externalAccountId : `act_${externalAccountId}`,
          platform: 'meta_ads',
          currency,
          timezone,
          accessToken: accessToken.trim() || undefined
        });
      }

      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao cadastrar cliente');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        zIndex: 110,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.15s ease-out'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '520px',
          maxWidth: '100%',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
          overflow: 'hidden'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Building2 size={18} style={{ color: 'var(--accent-blue)' }} />
            <h3 style={{ fontSize: '15px', fontWeight: 800 }}>Novo Cliente & Conta Meta Ads</h3>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose} style={{ padding: '6px' }}>
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleCreateClient} style={{ padding: '22px' }}>
          {error && (
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bad-bg)', color: 'var(--bad)', borderRadius: '8px', fontSize: '12px', marginBottom: '14px' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div className="date-input-group" style={{ flex: 1 }}>
                <label>Nome do Responsável *</label>
                <input
                  type="text"
                  placeholder="Ex: Larissa Topper"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>
              <div className="date-input-group" style={{ flex: 1 }}>
                <label>Nome da Empresa / Marca *</label>
                <input
                  type="text"
                  placeholder="Ex: Mentoria Versalhes"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <div className="date-input-group" style={{ flex: 1 }}>
                <label>E-mail de Contato</label>
                <input
                  type="email"
                  placeholder="contato@empresa.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <div className="date-input-group" style={{ flex: 1 }}>
                <label>WhatsApp / Telefone</label>
                <input
                  type="tel"
                  placeholder="+55 11 99999-9999"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                />
              </div>
            </div>

            <div style={{ marginTop: '10px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, marginBottom: '8px', color: 'var(--accent-blue)' }}>
                <CreditCard size={15} /> Conta de Anúncios Meta Ads Inicial (Opcional)
              </div>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '10px' }}>
                <div className="date-input-group" style={{ flex: 1 }}>
                  <label>ID da Conta Meta</label>
                  <input
                    type="text"
                    placeholder="act_123456789"
                    value={externalAccountId}
                    onChange={e => setExternalAccountId(e.target.value)}
                  />
                </div>
                <div className="date-input-group" style={{ flex: 1 }}>
                  <label>Nome Amigável da Conta</label>
                  <input
                    type="text"
                    placeholder="Meta Ads — Principal"
                    value={accountName}
                    onChange={e => setAccountName(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div className="date-input-group" style={{ flex: 1 }}>
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
                <div className="date-input-group" style={{ flex: 1 }}>
                  <label>Fuso Horário</label>
                  <select
                    value={timezone}
                    onChange={e => setTimezone(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                  >
                    <option value="America/Sao_Paulo">America/Sao_Paulo (BRT)</option>
                    <option value="America/New_York">America/New_York (EST)</option>
                    <option value="Europe/Lisbon">Europe/Lisbon (WET)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Salvando...' : 'Cadastrar Cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
