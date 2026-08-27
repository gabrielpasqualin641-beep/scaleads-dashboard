import { Router } from 'express';
import { DashboardService } from '../services/DashboardService.js';
import { AdAccountService } from '../services/AdAccountService.js';
import { UserService } from '../services/UserService.js';
import { requireRole, requireClientAccess } from '../middleware/requireAuth.js';
import { PeriodSelection } from '../models/types.js';

export const dashboardRouter = Router();

/** Toda leitura de dashboard é restrita ao escopo de clientes do usuário. */
const scopedByQuery = requireClientAccess(req => req.query.clientId as string | undefined);

function parsePeriodFromQuery(query: any): PeriodSelection {
  const today = new Date();
  const defaultEnd = today.toISOString().split('T')[0];
  const defaultStartDate = new Date(today);
  defaultStartDate.setDate(defaultStartDate.getDate() - 29); // 30 dias por padrão
  const defaultStart = defaultStartDate.toISOString().split('T')[0];

  return {
    preset: (query.preset as string) || 'last_30d',
    startDate: (query.startDate as string) || defaultStart,
    endDate: (query.endDate as string) || defaultEnd,
    compare: query.compare === 'true' || query.compare === true,
    includeMetaTax: query.includeMetaTax !== 'false'
  };
}

dashboardRouter.get('/overview', scopedByQuery, async (req, res) => {
  try {
    const clientId = req.query.clientId as string;
    const accountId = (req.query.accountId as string) || 'all';

    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId é obrigatório.' });
    }

    const period = parsePeriodFromQuery(req.query);
    const overview = await DashboardService.getOverview(clientId, accountId, period);

    res.json({ success: true, data: overview });
  } catch (err: any) {
    console.error('[Dashboard Route Error]', err);
    res.status(500).json({ success: false, error: err.message || 'Erro ao carregar dados do dashboard.' });
  }
});

dashboardRouter.get('/campaigns', scopedByQuery, async (req, res) => {
  try {
    const clientId = req.query.clientId as string;
    const accountId = (req.query.accountId as string) || 'all';
    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId é obrigatório.' });
    }

    const period = parsePeriodFromQuery(req.query);
    const campaigns = await DashboardService.getCampaigns(clientId, accountId, period);

    res.json({ success: true, data: campaigns });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao carregar campanhas.' });
  }
});

dashboardRouter.get('/adsets', scopedByQuery, async (req, res) => {
  try {
    const clientId = req.query.clientId as string;
    const accountId = (req.query.accountId as string) || 'all';
    const campaignId = req.query.campaignId as string;
    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId é obrigatório.' });
    }

    const period = parsePeriodFromQuery(req.query);
    const adsets = await DashboardService.getAdSets(clientId, accountId, period, campaignId);

    res.json({ success: true, data: adsets });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao carregar conjuntos.' });
  }
});

dashboardRouter.get('/ads', scopedByQuery, async (req, res) => {
  try {
    const clientId = req.query.clientId as string;
    const accountId = (req.query.accountId as string) || 'all';
    const adSetId = req.query.adSetId as string;
    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId é obrigatório.' });
    }

    const period = parsePeriodFromQuery(req.query);
    const ads = await DashboardService.getAds(clientId, accountId, period, adSetId);

    res.json({ success: true, data: ads });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao carregar anúncios.' });
  }
});

dashboardRouter.post('/sync', requireRole('editor'), async (req, res) => {
  try {
    const { accountId } = req.body;
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId é obrigatório para sincronização.' });
    }
    // Sincronizar toca dados reais: valida o escopo pela conta, não só o papel.
    const account = AdAccountService.getById(accountId);
    if (!account || !UserService.canAccessClient(req.user!, account.clientId)) {
      return res.status(404).json({ success: false, error: 'Conta não encontrada.' });
    }

    const result = await DashboardService.syncAccount(accountId);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao sincronizar dados da conta.' });
  }
});
