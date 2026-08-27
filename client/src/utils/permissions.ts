import { AuthUser, UserRole } from '../types';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  editor: 'Editor',
  viewer: 'Visualizador'
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Acesso total, incluindo gerenciar usuários e todos os clientes.',
  editor: 'Vê os clientes atribuídos e pode sincronizar dados e manter contas.',
  viewer: 'Somente leitura dos dashboards dos clientes atribuídos.'
};

const ROLE_RANK: Record<UserRole, number> = { viewer: 1, editor: 2, admin: 3 };

export function roleAtLeast(role: UserRole | undefined, minimum: UserRole): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * Espelha as regras aplicadas no servidor. Serve só para esconder controles —
 * a autorização de verdade é a do backend.
 */
export const can = {
  editData: (user: AuthUser | null) => roleAtLeast(user?.role, 'editor'),
  manageUsers: (user: AuthUser | null) => roleAtLeast(user?.role, 'admin'),
  deleteClient: (user: AuthUser | null) => roleAtLeast(user?.role, 'admin')
};
