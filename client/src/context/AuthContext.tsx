import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AuthUser } from '../types';
import { api, setAuthToken, getAuthToken, onUnauthorized } from '../services/api';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
  }, []);

  // Um 401 vindo de qualquer chamada derruba a sessão na hora.
  useEffect(() => onUnauthorized(() => logout()), [logout]);

  // Revalida o token guardado: sessão expirada não deve abrir o painel.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getAuthToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.me();
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) setAuthToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const { user: logged, token } = await api.login(email, password);
      setAuthToken(token);
      setUser(logged);
    } catch (err: any) {
      const message = err?.message || 'Não foi possível entrar.';
      setError(message);
      throw new Error(message);
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const updated = await api.changePassword(currentPassword, newPassword);
    setUser(updated);
  }, []);

  /** Relê o usuário do servidor — papel e escopo podem ter mudado. */
  const refreshUser = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      logout();
    }
  }, [logout]);

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout, changePassword, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
};
