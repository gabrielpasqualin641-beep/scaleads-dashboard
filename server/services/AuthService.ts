import crypto from 'crypto';
import { db } from '../db/database.js';
import { User } from '../models/types.js';

/**
 * Autenticação do painel.
 *
 * Senhas nunca são guardadas em texto puro: só o hash scrypt `salt:hash`.
 * O token de sessão é assinado com HMAC-SHA256 e carrega o id do usuário —
 * papel e escopo são sempre relidos do banco a cada requisição, para que
 * mudança de permissão valha na hora, sem esperar o token expirar.
 */

const SCRYPT_KEYLEN = 64;
const DEFAULT_SESSION_HOURS = 12;

export interface AuthConfigStatus {
  configured: boolean;
  missing: string[];
}

function scryptHash(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
}

export function createPasswordHash(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${scryptHash(password, salt)}`;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expected] = (storedHash || '').split(':');
  if (!salt || !expected) return false;
  return safeEqual(scryptHash(password || '', salt), expected);
}

export class AuthService {
  private static get secret(): string {
    return (process.env.AUTH_SECRET || '').trim();
  }

  public static configStatus(): AuthConfigStatus {
    const missing: string[] = [];
    if (!this.secret) missing.push('AUTH_SECRET');
    if (db.getUsers().length === 0) missing.push('ADMIN_EMAIL + ADMIN_PASSWORD_HASH (bootstrap)');
    return { configured: missing.length === 0, missing };
  }

  /**
   * Cria o administrador inicial a partir do .env quando o banco ainda não tem
   * nenhum usuário. Depois disso o .env deixa de ser consultado no login.
   */
  public static bootstrapAdminFromEnv(): { created: boolean; reason?: string } {
    if (db.getUsers().length > 0) return { created: false, reason: 'já existem usuários' };

    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const passwordHash = (process.env.ADMIN_PASSWORD_HASH || '').trim();
    const name = (process.env.ADMIN_NAME || 'Administrador').trim();

    if (!email || !passwordHash.includes(':')) {
      return { created: false, reason: 'ADMIN_EMAIL/ADMIN_PASSWORD_HASH ausentes ou inválidos no .env' };
    }

    db.createUser({
      name,
      email,
      role: 'admin',
      status: 'active',
      clientIds: [],
      passwordHash,
      // O admin inicial define a própria senha no .env, então não força troca.
      mustChangePassword: false
    });

    return { created: true };
  }

  public static verifyCredentials(email: string, password: string): { user: User | null; reason?: string } {
    const user = db.getUserByEmail((email || '').trim().toLowerCase());

    // Calcula um hash mesmo sem usuário, para o tempo de resposta não denunciar
    // quais e-mails existem.
    const hashToCheck = user?.passwordHash || `${'0'.repeat(32)}:${'0'.repeat(128)}`;
    const passwordOk = verifyPassword(password, hashToCheck);

    if (!user || !passwordOk) return { user: null };
    if (user.status !== 'active') return { user: null, reason: 'suspended' };
    return { user };
  }

  public static issueToken(user: User, hours: number = DEFAULT_SESSION_HOURS): { token: string; expiresAt: string } {
    const expiresAt = Date.now() + hours * 60 * 60 * 1000;
    const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: expiresAt }), 'utf-8').toString('base64url');
    const signature = crypto.createHmac('sha256', this.secret).update(payload).digest('hex');
    return { token: `${payload}.${signature}`, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Resolve o token para o usuário atual do banco, já revalidando status. */
  public static verifyToken(token: string | undefined): User | null {
    if (!token || !this.secret) return null;

    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expected = crypto.createHmac('sha256', this.secret).update(payload).digest('hex');
    if (!safeEqual(signature, expected)) return null;

    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { sub?: string; exp?: number };
      if (!data.exp || Date.now() > data.exp || !data.sub) return null;

      const user = db.getUserById(data.sub);
      if (!user || user.status !== 'active') return null;
      return user;
    } catch {
      return null;
    }
  }
}
