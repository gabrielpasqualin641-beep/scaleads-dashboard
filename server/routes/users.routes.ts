import { Router } from 'express';
import { db } from '../db/database.js';
import { UserService, ROLES, MIN_PASSWORD_LENGTH } from '../services/UserService.js';
import { requireRole } from '../middleware/requireAuth.js';
import { UserRole, UserStatus } from '../models/types.js';
import { pathParam } from '../utils/http.js';

export const usersRouter = Router();

// Gestão de usuários é exclusiva de administradores.
usersRouter.use(requireRole('admin'));

function parseRole(value: unknown): UserRole | null {
  return typeof value === 'string' && (ROLES as string[]).includes(value) ? (value as UserRole) : null;
}

usersRouter.get('/', (req, res) => {
  res.json({ success: true, data: UserService.list() });
});

usersRouter.post('/', (req, res) => {
  const { name, email, role, clientIds, password } = req.body as {
    name?: string;
    email?: string;
    role?: string;
    clientIds?: string[];
    password?: string;
  };

  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ success: false, error: 'Nome e e-mail são obrigatórios.' });
  }

  const parsedRole = parseRole(role);
  if (!parsedRole) {
    return res.status(400).json({ success: false, error: 'Papel inválido. Use admin, editor ou viewer.' });
  }

  // Sem senha informada, geramos uma provisória e devolvemos uma única vez.
  const generated = password ? null : UserService.generateTempPassword();
  const finalPassword = password || generated!;

  if (password) {
    const invalid = UserService.validatePassword(password);
    if (invalid) return res.status(400).json({ success: false, error: invalid });
  }

  try {
    const { user } = UserService.create({
      name,
      email,
      role: parsedRole,
      clientIds: Array.isArray(clientIds) ? clientIds : [],
      password: finalPassword
    });

    res.status(201).json({
      success: true,
      data: {
        user,
        // Mostrada uma única vez: não fica recuperável depois.
        temporaryPassword: generated,
        notice: `O usuário deverá trocar a senha no primeiro acesso (mínimo ${MIN_PASSWORD_LENGTH} caracteres).`
      }
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Erro ao criar usuário.' });
  }
});

usersRouter.put('/:id', (req, res) => {
  const target = UserService.getById(pathParam(req, 'id'));
  if (!target) {
    return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  }

  const { name, role, clientIds, status } = req.body as {
    name?: string;
    role?: string;
    clientIds?: string[];
    status?: string;
  };

  const parsedRole = role === undefined ? undefined : parseRole(role);
  if (role !== undefined && !parsedRole) {
    return res.status(400).json({ success: false, error: 'Papel inválido.' });
  }

  const parsedStatus =
    status === undefined ? undefined : status === 'active' || status === 'suspended' ? (status as UserStatus) : null;
  if (status !== undefined && parsedStatus === null) {
    return res.status(400).json({ success: false, error: 'Status inválido.' });
  }

  // Trava de segurança: nunca deixar a instalação sem nenhum admin ativo.
  const losingAdmin =
    (parsedRole !== undefined && target.role === 'admin' && parsedRole !== 'admin') ||
    (parsedStatus === 'suspended' && target.role === 'admin');

  if (losingAdmin && UserService.countActiveAdmins(target.id) === 0) {
    return res.status(400).json({
      success: false,
      error: 'Este é o último administrador ativo. Promova outro usuário antes de alterar este.'
    });
  }

  if (req.user!.id === target.id && parsedRole !== undefined && parsedRole !== 'admin') {
    return res.status(400).json({ success: false, error: 'Você não pode rebaixar o seu próprio acesso.' });
  }

  const updated = UserService.update(pathParam(req, 'id'), {
    name,
    role: parsedRole ?? undefined,
    clientIds,
    status: parsedStatus ?? undefined
  });

  res.json({ success: true, data: updated });
});

usersRouter.post('/:id/reset-password', (req, res) => {
  const temporaryPassword = UserService.resetPassword(pathParam(req, 'id'));
  if (!temporaryPassword) {
    return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  }
  res.json({
    success: true,
    data: { temporaryPassword, notice: 'Senha provisória gerada. Ela é exibida apenas agora.' }
  });
});

usersRouter.delete('/:id', (req, res) => {
  const target = UserService.getById(pathParam(req, 'id'));
  if (!target) {
    return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  }
  if (req.user!.id === target.id) {
    return res.status(400).json({ success: false, error: 'Você não pode excluir o seu próprio usuário.' });
  }
  if (target.role === 'admin' && UserService.countActiveAdmins(target.id) === 0) {
    return res.status(400).json({
      success: false,
      error: 'Este é o último administrador ativo. Promova outro usuário antes de excluir este.'
    });
  }

  UserService.delete(pathParam(req, 'id'));
  res.json({ success: true, message: 'Usuário excluído.' });
});

/** Lista enxuta de clientes para montar o escopo na interface. */
usersRouter.get('/assignable-clients', (req, res) => {
  res.json({
    success: true,
    data: db.getClients().map(c => ({ id: c.id, name: c.name, companyName: c.companyName }))
  });
});
