import { Router } from 'express';
import { AuthService } from '../services/AuthService.js';
import { UserService } from '../services/UserService.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const authRouter = Router();

/** Resposta genérica: não revela se o e-mail existe nem se está suspenso. */
const INVALID_CREDENTIALS = 'E-mail ou senha incorretos.';

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Informe e-mail e senha.' });
  }

  const status = AuthService.configStatus();
  if (!status.configured) {
    return res.status(503).json({
      success: false,
      error: `Login não configurado no servidor. Pendente: ${status.missing.join(', ')}.`
    });
  }

  const { user, reason } = AuthService.verifyCredentials(email, password);
  if (!user) {
    console.warn(`[Auth] Login recusado para "${String(email).slice(0, 64)}"${reason ? ` (${reason})` : ''}`);
    return res.status(401).json({ success: false, error: INVALID_CREDENTIALS });
  }

  UserService.registerLogin(user.id);
  const { token, expiresAt } = AuthService.issueToken(user);

  res.json({
    success: true,
    data: { user: UserService.toPublic(user), token, expiresAt }
  });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, data: { user: UserService.toPublic(req.user!) } });
});

/** Troca da própria senha — também é o fluxo da senha provisória. */
authRouter.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Informe a senha atual e a nova senha.' });
  }

  const error = UserService.changeOwnPassword(req.user!.id, currentPassword, newPassword);
  if (error) {
    return res.status(400).json({ success: false, error });
  }

  const updated = UserService.getById(req.user!.id)!;
  res.json({ success: true, data: { user: UserService.toPublic(updated) } });
});
