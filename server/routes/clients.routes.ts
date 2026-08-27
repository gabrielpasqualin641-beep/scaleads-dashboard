import { Router } from 'express';
import { ClientService } from '../services/ClientService.js';
import { UserService } from '../services/UserService.js';
import { requireRole, requireClientAccess } from '../middleware/requireAuth.js';
import { pathParam } from '../utils/http.js';

export const clientsRouter = Router();

const scoped = requireClientAccess(req => pathParam(req, 'id'));

/** Lista apenas os clientes no escopo do usuário; admin recebe todos. */
clientsRouter.get('/', (req, res) => {
  try {
    const allowed = UserService.allowedClientIds(req.user!);
    const clients = ClientService.getAll();
    res.json({
      success: true,
      data: allowed === null ? clients : clients.filter(c => allowed.includes(c.id))
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erro ao buscar clientes.' });
  }
});

clientsRouter.get('/:id', scoped, (req, res) => {
  try {
    const client = ClientService.getById(pathParam(req, 'id'));
    if (!client) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado.' });
    }
    res.json({ success: true, data: client });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erro ao buscar cliente.' });
  }
});

clientsRouter.get('/:id/accounts', scoped, (req, res) => {
  try {
    const accounts = ClientService.getAccounts(pathParam(req, 'id'));
    res.json({ success: true, data: accounts });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erro ao buscar contas do cliente.' });
  }
});

clientsRouter.post('/', requireRole('editor'), (req, res) => {
  try {
    const { name, companyName, email, phone, avatarUrl } = req.body;
    if (!name || !companyName) {
      return res.status(400).json({ success: false, error: 'Nome e Empresa são obrigatórios.' });
    }
    const client = ClientService.create({ name, companyName, email: email || '', phone: phone || '', avatarUrl });
    res.status(201).json({ success: true, data: client });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erro ao criar cliente.' });
  }
});

clientsRouter.put('/:id', requireRole('editor'), scoped, (req, res) => {
  try {
    const updated = ClientService.update(pathParam(req, 'id'), req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado.' });
    }
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erro ao atualizar cliente.' });
  }
});

// Excluir cliente remove também as contas vinculadas: restrito a administradores.
clientsRouter.delete('/:id', requireRole('admin'), (req, res) => {
  try {
    const ok = ClientService.delete(pathParam(req, 'id'));
    if (!ok) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado.' });
    }
    res.json({ success: true, message: 'Cliente excluído com sucesso.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erro ao excluir cliente.' });
  }
});
