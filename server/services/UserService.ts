import crypto from 'crypto';
import { db } from '../db/database.js';
import { User, PublicUser, UserRole, UserStatus } from '../models/types.js';
import { createPasswordHash, verifyPassword } from './AuthService.js';

export const ROLES: UserRole[] = ['admin', 'editor', 'viewer'];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  editor: 'Editor',
  viewer: 'Visualizador'
};

/** Ordem de privilégio: usada para comparar "pelo menos este papel". */
const ROLE_RANK: Record<UserRole, number> = { viewer: 1, editor: 2, admin: 3 };

export function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export const MIN_PASSWORD_LENGTH = 10;

export class UserService {
  /** Remove o hash antes de qualquer coisa sair da API. */
  public static toPublic(user: User): PublicUser {
    const { passwordHash, updatedAt, ...safe } = user;
    return safe;
  }

  public static list(): PublicUser[] {
    return db.getUsers().map(u => this.toPublic(u));
  }

  public static getById(id: string): User | undefined {
    return db.getUserById(id);
  }

  public static getByEmail(email: string): User | undefined {
    return db.getUserByEmail(email);
  }

  /** Senha provisória legível, entregue uma única vez a quem criou o usuário. */
  public static generateTempPassword(): string {
    // Sem caracteres ambíguos (0/O, 1/l) para reduzir erro de digitação.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(14);
    return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
  }

  public static validatePassword(password: string): string | null {
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return 'A senha precisa combinar letras e números.';
    }
    return null;
  }

  public static create(input: {
    name: string;
    email: string;
    role: UserRole;
    clientIds: string[];
    password: string;
  }): { user: PublicUser } {
    const email = input.email.trim().toLowerCase();
    if (db.getUserByEmail(email)) {
      throw new Error('Já existe um usuário com este e-mail.');
    }

    const created = db.createUser({
      name: input.name.trim(),
      email,
      role: input.role,
      status: 'active',
      // Admin enxerga tudo, então não faz sentido guardar escopo para ele.
      clientIds: input.role === 'admin' ? [] : this.sanitizeClientIds(input.clientIds),
      passwordHash: createPasswordHash(input.password),
      mustChangePassword: true
    });

    return { user: this.toPublic(created) };
  }

  public static update(
    id: string,
    updates: { name?: string; role?: UserRole; clientIds?: string[]; status?: UserStatus }
  ): PublicUser | null {
    const current = db.getUserById(id);
    if (!current) return null;

    const role = updates.role ?? current.role;
    const patch: Partial<User> = {};

    if (updates.name !== undefined) patch.name = updates.name.trim();
    if (updates.role !== undefined) patch.role = role;
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.role !== undefined || updates.clientIds !== undefined) {
      const ids = updates.clientIds ?? current.clientIds;
      patch.clientIds = role === 'admin' ? [] : this.sanitizeClientIds(ids);
    }

    const updated = db.updateUser(id, patch);
    return updated ? this.toPublic(updated) : null;
  }

  public static delete(id: string): boolean {
    return db.deleteUser(id);
  }

  /** Troca de senha pelo próprio usuário: exige a senha atual. */
  public static changeOwnPassword(id: string, currentPassword: string, newPassword: string): string | null {
    const user = db.getUserById(id);
    if (!user) return 'Usuário não encontrado.';
    if (!verifyPassword(currentPassword, user.passwordHash)) return 'Senha atual incorreta.';

    const invalid = this.validatePassword(newPassword);
    if (invalid) return invalid;
    if (verifyPassword(newPassword, user.passwordHash)) {
      return 'A nova senha precisa ser diferente da atual.';
    }

    db.updateUser(id, { passwordHash: createPasswordHash(newPassword), mustChangePassword: false });
    return null;
  }

  /** Reset feito por um admin: gera provisória e força troca no próximo acesso. */
  public static resetPassword(id: string): string | null {
    const user = db.getUserById(id);
    if (!user) return null;
    const temp = this.generateTempPassword();
    db.updateUser(id, { passwordHash: createPasswordHash(temp), mustChangePassword: true });
    return temp;
  }

  public static registerLogin(id: string): void {
    db.updateUser(id, { lastLoginAt: new Date().toISOString() });
  }

  /** Ids de cliente que realmente existem — evita escopo apontando para o vazio. */
  private static sanitizeClientIds(ids: string[]): string[] {
    const existing = new Set(db.getClients().map(c => c.id));
    return Array.from(new Set(ids.filter(id => existing.has(id))));
  }

  /** `null` significa "todos os clientes" (admin). */
  public static allowedClientIds(user: Pick<User, 'role' | 'clientIds'>): string[] | null {
    return user.role === 'admin' ? null : user.clientIds;
  }

  public static canAccessClient(user: Pick<User, 'role' | 'clientIds'>, clientId: string): boolean {
    const allowed = this.allowedClientIds(user);
    return allowed === null || allowed.includes(clientId);
  }

  public static countActiveAdmins(excludeId?: string): number {
    return db.getUsers().filter(u => u.role === 'admin' && u.status === 'active' && u.id !== excludeId).length;
  }
}
