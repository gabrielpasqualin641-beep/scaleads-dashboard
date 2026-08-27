import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginView } from './pages/LoginView';
import { ChangePasswordView } from './pages/ChangePasswordView';
import { UsersView } from './pages/UsersView';
import { ProjectView } from './pages/ProjectView';
import { AnalysisView } from './pages/AnalysisView';
import { can } from './utils/permissions';
import { PeriodProvider, usePeriod } from './context/PeriodContext';
import { ClientProvider, useClient } from './context/ClientContext';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { GeneralDashboard } from './pages/GeneralDashboard';
import { CampaignsView } from './pages/CampaignsView';
import { AdSetsView } from './pages/AdSetsView';
import { AdsView } from './pages/AdsView';
import { ClientsView } from './pages/ClientsView';
import { AccountsView } from './pages/AccountsView';
import { ReportView } from './pages/ReportView';
import { AppPage } from './types';
import { api } from './services/api';

const VALID_PAGES: AppPage[] = ['geral', 'campanhas', 'conjuntos', 'anuncios', 'analise', 'projeto', 'relatorio', 'clientes', 'contas', 'usuarios'];

const NoAccess: React.FC = () => (
  <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>
    <p style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>Sem permissão</p>
    <p style={{ fontSize: '13px' }}>Seu nível de acesso não permite abrir esta página.</p>
  </div>
);

const MainApp: React.FC = () => {
  const { user } = useAuth();
  const [currentPage, setCurrentPage] = useState<AppPage>(() => {
    const hash = window.location.hash.replace('#', '') as AppPage;
    return VALID_PAGES.includes(hash) ? hash : 'geral';
  });

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toISOString());
  const [syncKey, setSyncKey] = useState(0);
  const { selectedClient, selectedAccountId, refreshClients } = useClient();

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '') as AppPage;
      if (VALID_PAGES.includes(hash)) {
        setCurrentPage(hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handlePageChange = (page: AppPage) => {
    setCurrentPage(page);
    window.location.hash = `#${page}`;
  };

  const handleRefreshData = async () => {
    try {
      setIsRefreshing(true);
      if (selectedAccountId && selectedAccountId !== 'all') {
        const res = await api.syncAccount(selectedAccountId);
        setLastSyncTime(res.lastSyncAt);
      } else {
        setLastSyncTime(new Date().toISOString());
      }
      await refreshClients();
      // Força remount de todas as páginas para recarregar dados
      setSyncKey(prev => prev + 1);
    } catch (e) {
      console.error('Erro ao sincronizar:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <Sidebar
        currentPage={currentPage}
        onPageChange={handlePageChange}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="main-wrapper">
        <Topbar
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onRefreshData={handleRefreshData}
          isRefreshing={isRefreshing}
          lastSyncTime={lastSyncTime}
        />

        <main className="page-container" key={syncKey}>
          {currentPage === 'geral' && <GeneralDashboard />}
          {currentPage === 'campanhas' && <CampaignsView />}
          {currentPage === 'conjuntos' && <AdSetsView />}
          {currentPage === 'anuncios' && <AdsView />}
          {currentPage === 'analise' && <AnalysisView />}
          {currentPage === 'projeto' && <ProjectView />}
          {currentPage === 'relatorio' && <ReportView />}
          {currentPage === 'clientes' && (
            <ClientsView
              onSelectClientAndNavigate={() => handlePageChange('geral')}
            />
          )}
          {currentPage === 'contas' && <AccountsView />}
          {currentPage === 'usuarios' && (can.manageUsers(user) ? <UsersView /> : <NoAccess />)}
        </main>
      </div>
    </div>
  );
};

/**
 * Só monta os providers de dados depois da sessão validada — assim nenhuma
 * chamada à API sai antes de existir um token.
 */
const AuthGate: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          color: 'var(--muted)',
          fontSize: '13px',
          backgroundColor: 'var(--bg)'
        }}
      >
        <Loader2 size={16} className="spin" />
        <span>Verificando sessão...</span>
      </div>
    );
  }

  if (!user) return <LoginView />;

  // Senha provisória: bloqueia o painel até a troca.
  if (user.mustChangePassword) return <ChangePasswordView />;

  return (
    <ClientProvider>
      <PeriodProvider>
        <MainApp />
      </PeriodProvider>
    </ClientProvider>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
