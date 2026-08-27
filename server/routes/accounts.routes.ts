import { Router, Request } from 'express';
import { AdAccountService } from '../services/AdAccountService.js';
import { UserService } from '../services/UserService.js';
import { requireRole, requireClientAccess } from '../middleware/requireAuth.js';
import { pathParam } from '../utils/http.js';

export const accountsRouter = Router();

/** Uma conta só é visível se o cliente dono dela estiver no escopo do usuário. */
function accountInScope(req: Request): boolean {
  const acc = AdAccountService.getById(pathParam(req, 'id'));
  return !!acc && !!req.user && UserService.canAccessClient(req.user, acc.clientId);
}

accountsRouter.get('/:id', (req, res) => {
  try {
    const acc = AdAccountService.getById(pathParam(req, 'id'));
    if (!acc || !UserService.canAccessClient(req.user!, acc.clientId)) {
      return res.status(404).json({ success: false, error: 'Conta não encontrada.' });
    }
    const { accessTokenRef, ...safeAcc } = acc;
    res.json({ success: true, data: safeAcc });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erro ao buscar conta.' });
  }
});

accountsRouter.post('/', requireRole('editor'), requireClientAccess(req => req.body?.clientId), (req, res) => {
  try {
    const { clientId, externalAccountId, name, platform, currency, timezone, accessToken } = req.body;
    if (!clientId || !externalAccountId || !name) {
      return res.status(400).json({ success: false, error: 'Cliente, ID da Conta e Nome são obrigatórios.' });
    }

    const created = AdAccountService.create({
      clientId,
      externalAccountId,
      name,
      platform: platform || 'meta_ads',
      currency,
      timezone,
      accessToken
    });

    const { accessTokenRef, ...safeAcc } = created;
    res.status(201).json({ success: true, data: safeAcc });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erro ao criar conta de anúncio.' });
  }
});

accountsRouter.put('/:id', requireRole('editor'), (req, res) => {
  try {
    if (!accountInScope(req)) {
      return res.status(404).json({ success: false, error: 'Conta não encontrada.' });
    }
    // clientId não é alterável por aqui: mover conta entre clientes contornaria o escopo.
    const { clientId, ...safeUpdates } = req.body || {};
    const updated = AdAccountService.update(pathParam(req, 'id'), safeUpdates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Conta não encontrada.' });
    }
    const { accessTokenRef, ...safeAcc } = updated;
    res.json({ success: true, data: safeAcc });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erro ao atualizar conta.' });
  }
});

accountsRouter.post('/:id/test', async (req, res) => {
  try {
    if (!accountInScope(req)) {
      return res.status(404).json({ success: false, error: 'Conta não encontrada.' });
    }
    const result = await AdAccountService.testConnection(pathParam(req, 'id'));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erro ao testar conexão com a conta.' });
  }
});
