import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/AuthService.js';
import { UserService, roleAtLeast } from '../services/UserService.js';
import { User, UserRole } from '../models/types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

function readToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value : undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const status = AuthService.configStatus();
  if (!status.configured) {
    return res.status(503).json({
      success: false,
      error: `Login não configurado no servidor. Pendente: ${status.missing.join(', ')}.`,
      code: 'AUTH_NOT_CONFIGURED'
    });
  }

  const user = AuthService.verifyToken(readToken(req));
  if (!user) {
    return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.', code: 'UNAUTHORIZED' });
  }

  req.user = user;
  next();
}

/**
 * Exige um papel mínimo. Rodar sempre no servidor: esconder um botão na
 * interface não impede ninguém de chamar a rota direto.
 */
export function requireRole(minimum: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Sessão inválida.', code: 'UNAUTHORIZED' });
    }
    if (!roleAtLeast(req.user.role, minimum)) {
      return res.status(403).json({
        success: false,
        error: 'Seu nível de acesso não permite esta ação.',
        code: 'FORBIDDEN'
      });
    }
    next();
  };
}

/**
 * Bloqueia acesso a um cliente fora do escopo do usuário. Responde 404 em vez
 * de 403 para não confirmar a existência de clientes de terceiros.
 */
export function requireClientAccess(getClientId: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Sessão inválida.', code: 'UNAUTHORIZED' });
    }

    const clientId = getClientId(req);
    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId é obrigatório.' });
    }

    if (!UserService.canAccessClient(req.user, clientId)) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado.', code: 'NOT_FOUND' });
    }

    next();
  };
}
