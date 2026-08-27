import React, { useState } from 'react';
import { Plus, Building2, CreditCard, ArrowRight, CheckCircle, Mail, Phone } from 'lucide-react';
import { useClient } from '../context/ClientContext';
import { ClientModal } from '../components/drawers/ClientModal';
import { Client } from '../types';

interface ClientsViewProps {
  onSelectClientAndNavigate: (client: Client) => void;
}

export const ClientsView: React.FC<ClientsViewProps> = ({ onSelectClientAndNavigate }) => {
  const { clients, setSelectedClient, selectedClient } = useClient();
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">Gestão de Clientes & Workspaces</h2>
          <p className="page-description">
            Cadastre clientes, gerencie acessos e visualize os resultados consolidados de cada marca da sua carteira.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setIsModalOpen(true)}
          style={{ gap: '6px' }}
        >
          <Plus size={15} /> Novo Cliente
        </button>
      </div>

      {/* Grid de Clientes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
        {clients.map(c => {
          const isSelected = selectedClient?.id === c.id;
          return (
            <div
              key={c.id}
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '16px',
                borderColor: isSelected ? 'var(--accent-blue)' : undefined,
                boxShadow: isSelected ? '0 0 0 1px var(--accent-blue)' : undefined
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <img
                      src={c.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80'}
                      alt={c.name}
                      style={{ width: '42px', height: '42px', borderRadius: '10px', objectFit: 'cover', border: '1px solid var(--border)' }}
                    />
                    <div>
                      <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--ink)' }}>{c.name}</h3>
                      <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{c.companyName}</div>
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
                    <CheckCircle size={11} /> Ativo
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', color: 'var(--muted)', marginTop: '8px' }}>
                  {c.email && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Mail size={13} /> <span>{c.email}</span>
                    </div>
                  )}
                  {c.phone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Phone size={13} /> <span>{c.phone}</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                  {isSelected ? '✓ Cliente Atual' : 'Meta Ads Vinculado'}
                </span>
                <button
                  type="button"
                  className={`btn btn-sm ${isSelected ? 'btn-active' : 'btn-primary'}`}
                  onClick={() => {
                    setSelectedClient(c);
                    onSelectClientAndNavigate(c);
                  }}
                  style={{ gap: '6px' }}
                >
                  <span>Abrir Dashboard</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <ClientModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
};
