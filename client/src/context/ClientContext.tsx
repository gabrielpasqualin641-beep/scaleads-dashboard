import React, { createContext, useContext, useEffect, useState } from 'react';
import { Client, AdAccount } from '../types';
import { api } from '../services/api';

interface ClientContextType {
  clients: Client[];
  selectedClient: Client | null;
  accounts: AdAccount[];
  selectedAccountId: string; // 'all' or specific accountId
  loading: boolean;
  error: string | null;
  setSelectedClient: (client: Client) => void;
  setSelectedAccountId: (accountId: string) => void;
  refreshClients: () => Promise<void>;
  createClient: (data: Partial<Client>) => Promise<Client>;
  createAccount: (data: any) => Promise<AdAccount>;
}

const ClientContext = createContext<ClientContextType | undefined>(undefined);

export const ClientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClientState] = useState<Client | null>(null);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchClients = async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await api.getClients();
      setClients(list);

      const savedClientId = localStorage.getItem('scale_ads_client_id');
      const found = list.find(c => c.id === savedClientId) || list[0] || null;
      if (found) {
        // O id salvo pode apontar para um cliente que não existe mais; regrava o resolvido.
        if (found.id !== savedClientId) {
          localStorage.setItem('scale_ads_client_id', found.id);
        }
        setSelectedClientState(found);
        await loadAccountsForClient(found.id);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar clientes');
    } finally {
      setLoading(false);
    }
  };

  const loadAccountsForClient = async (clientId: string) => {
    try {
      const accs = await api.getClientAccounts(clientId);
      setAccounts(accs);
      setSelectedAccountId('all');
    } catch (e) {
      console.error('Erro ao carregar contas do cliente:', e);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const setSelectedClient = (client: Client) => {
    setSelectedClientState(client);
    localStorage.setItem('scale_ads_client_id', client.id);
    loadAccountsForClient(client.id);
  };

  const createClient = async (data: Partial<Client>): Promise<Client> => {
    const created = await api.createClient(data);
    await fetchClients();
    setSelectedClient(created);
    return created;
  };

  const createAccount = async (data: any): Promise<AdAccount> => {
    const created = await api.createAccount(data);
    if (selectedClient) {
      await loadAccountsForClient(selectedClient.id);
    }
    return created;
  };

  return (
    <ClientContext.Provider
      value={{
        clients,
        selectedClient,
        accounts,
        selectedAccountId,
        loading,
        error,
        setSelectedClient,
        setSelectedAccountId,
        refreshClients: fetchClients,
        createClient,
        createAccount
      }}
    >
      {children}
    </ClientContext.Provider>
  );
};

export const useClient = () => {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error('useClient deve ser usado dentro de ClientProvider');
  return ctx;
};
