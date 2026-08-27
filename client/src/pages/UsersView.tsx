import React, { useEffect, useState } from 'react';
import { UserPlus, Trash2, KeyRound, Copy, Check, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { AuthUser, AssignableClient, UserRole } from '../types';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, ROLE_DESCRIPTIONS } from '../utils/permissions';
import { TableSkeleton } from '../components/common/Skeletons';
import { ErrorState } from '../components/common/ErrorState';

const ROLES: UserRole[] = ['viewer', 'editor', 'admin'];

export const UsersView: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [clients, setClients] = useState<AssignableClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Senha provisória: só existe nesta tela, logo após criar/redefinir.
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [userList, clientList] = await Promise.all([api.listUsers(), api.assignableClients()]);
      setUsers(userList);
      setClients(clientList);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setName('');
    setEmail('');
    setRole('viewer');
    setClientIds([]);
    setShowForm(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setActionError(null);
    setSubmitting(true);
    try {
      const result = await api.createUser({ name, email, role, clientIds });
      if (result.temporaryPassword) {
        setTempPassword({ email: result.user.email, password: result.temporaryPassword });
        setCopied(false);
      }
      resetForm();
      await load();
    } catch (err: any) {
      setActionError(err.message || 'Erro ao criar usuário');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (target: AuthUser, nextRole: UserRole) => {
    setActionError(null);
    try {
      await api.updateUser(target.id, { role: nextRole });
      await load();
    } catch (err: any) {
      setActionError(err.message || 'Erro ao alterar o papel');
    }
  };

  const handleScopeToggle = async (target: AuthUser, clientId: string) => {
    setActionError(null);
    const next = target.clientIds.includes(clientId)
      ? target.clientIds.filter(id => id !== clientId)
      : [...target.clientIds, clientId];
    try {
      await api.updateUser(target.id, { clientIds: next });
      await load();
    } catch (err: any) {
      setActionError(err.message || 'Erro ao alterar o escopo');
    }
  };

  const handleStatusToggle = async (target: AuthUser) => {
    setActionError(null);
    try {
      await api.updateUser(target.id, { status: target.status === 'active' ? 'suspended' : 'active' });
      await load();
    } catch (err: any) {
      setActionError(err.message || 'Erro ao alterar o status');
    }
  };

  const handleReset = async (target: AuthUser) => {
    setActionError(null);
    try {
      const result = await api.resetUserPassword(target.id);
      setTempPassword({ email: target.email, password: result.temporaryPassword });
      setCopied(false);
      await load();
    } catch (err: any) {
      setActionError(err.message || 'Erro ao redefinir a senha');
    }
  };

  const handleDelete = async (target: AuthUser) => {
    if (!window.confirm(`Excluir o acesso de ${target.name} (${target.email})? Esta ação não pode ser desfeita.`)) return;
    setActionError(null);
    try {
      await api.deleteUser(target.id);
      await load();
    } catch (err: any) {
      setActionError(err.message || 'Erro ao excluir usuário');
    }
  };

  if (loading && users.length === 0) return <TableSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 11px',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg)',
    color: 'var(--ink)',
    fontSize: '13px',
    outline: 'none'
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    marginBottom: '5px'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">Usuários & Acessos</h2>
          <p className="page-description">
            Defina quem entra no painel, com qual nível de permissão e quais clientes cada pessoa enxerga.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowForm(v => !v)} style={{ gap: '6px' }}>
          <UserPlus size={14} /> Novo acesso
        </button>
      </div>

      {tempPassword && (
        <div className="card" style={{ padding: '14px 16px', borderColor: 'var(--accent-blue)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '13px', color: 'var(--accent-blue)' }}>
            <ShieldCheck size={15} /> Senha provisória de {tempPassword.email}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <code style={{ fontSize: '15px', fontWeight: 700, padding: '7px 12px', borderRadius: '8px', backgroundColor: 'var(--bg)', border: '1px solid var(--border)', letterSpacing: '0.04em' }}>
              {tempPassword.password}
            </code>
            <button type="button" className="btn btn-sm" style={{ gap: '5px' }}
              onClick={() => { navigator.clipboard?.writeText(tempPassword.password); setCopied(true); }}>
              {copied ? <Check size={13} style={{ color: 'var(--good)' }} /> : <Copy size={13} />}
              {copied ? 'Copiada' : 'Copiar'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setTempPassword(null)}>Fechar</button>
          </div>
          <p style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
            Ela aparece só agora e não fica recuperável depois. Envie por um canal seguro — a pessoa troca a senha no primeiro acesso.
          </p>
        </div>
      )}

      {actionError && (
        <div role="alert" className="card" style={{ padding: '10px 13px', borderColor: 'var(--bad)', color: 'var(--bad)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', fontWeight: 600 }}>
          <AlertCircle size={15} /> {actionError}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div>
              <label htmlFor="nu-name" style={labelStyle}>Nome</label>
              <input id="nu-name" value={name} onChange={e => setName(e.target.value)} required disabled={submitting} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="nu-email" style={labelStyle}>E-mail</label>
              <input id="nu-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={submitting} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="nu-role" style={labelStyle}>Nível de acesso</label>
              <select id="nu-role" value={role} onChange={e => setRole(e.target.value as UserRole)} disabled={submitting} style={inputStyle}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
          </div>

          <p style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '-6px' }}>{ROLE_DESCRIPTIONS[role]}</p>

          {role !== 'admin' && (
            <div>
              <label style={labelStyle}>Clientes que este usuário enxerga</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
                {clients.map(c => {
                  const selected = clientIds.includes(c.id);
                  return (
                    <button key={c.id} type="button"
                      onClick={() => setClientIds(prev => selected ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                      style={{
                        padding: '6px 11px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                        border: `1px solid ${selected ? 'var(--accent-blue)' : 'var(--border)'}`,
                        backgroundColor: selected ? 'var(--accent-blue-light)' : 'transparent',
                        color: selected ? 'var(--accent-blue)' : 'var(--ink)'
                      }}>
                      {selected && <Check size={11} style={{ marginRight: '4px', verticalAlign: '-1px' }} />}
                      {c.name}
                    </button>
                  );
                })}
              </div>
              {clientIds.length === 0 && (
                <p style={{ fontSize: '11.5px', color: 'var(--bad)', marginTop: '6px' }}>
                  Sem nenhum cliente marcado, a pessoa entra no painel e não vê dado nenhum.
                </p>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ gap: '6px' }}>
              {submitting ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />}
              {submitting ? 'Criando...' : 'Criar acesso'}
            </button>
            <button type="button" className="btn btn-sm" onClick={resetForm} disabled={submitting}>Cancelar</button>
          </div>
        </form>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {users.map(u => {
          const isSelf = u.id === currentUser?.id;
          return (
            <div key={u.id} className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--ink)' }}>
                    {u.name}
                    {isSelf && <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 500 }}> · você</span>}
                    {u.mustChangePassword && (
                      <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--warn, #b45309)', marginLeft: '8px' }}>
                        senha provisória
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                    {u.email}
                    {u.lastLoginAt && ` · último acesso ${new Date(u.lastLoginAt).toLocaleString('pt-BR')}`}
                  </div>
                </div>

                <select
                  value={u.role}
                  onChange={e => handleRoleChange(u, e.target.value as UserRole)}
                  disabled={isSelf}
                  title={isSelf ? 'Você não pode alterar o seu próprio nível' : 'Alterar nível de acesso'}
                  style={{ ...inputStyle, width: 'auto', minWidth: '150px' }}
                >
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>

                <button type="button" className="btn btn-sm" onClick={() => handleStatusToggle(u)} disabled={isSelf}
                  style={{ color: u.status === 'active' ? 'var(--good)' : 'var(--muted)', fontWeight: 700 }}>
                  {u.status === 'active' ? 'Ativo' : 'Suspenso'}
                </button>

                <button type="button" className="btn btn-sm" onClick={() => handleReset(u)} style={{ gap: '5px' }} title="Gerar nova senha provisória">
                  <KeyRound size={13} /> Redefinir
                </button>

                <button type="button" className="btn btn-sm" onClick={() => handleDelete(u)} disabled={isSelf}
                  style={{ color: isSelf ? 'var(--muted)' : 'var(--bad)' }} title={isSelf ? 'Você não pode excluir o seu próprio acesso' : 'Excluir acesso'}>
                  <Trash2 size={13} />
                </button>
              </div>

              {u.role !== 'admin' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>Enxerga:</span>
                  {clients.map(c => {
                    const selected = u.clientIds.includes(c.id);
                    return (
                      <button key={c.id} type="button" onClick={() => handleScopeToggle(u, c.id)}
                        style={{
                          padding: '4px 9px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 600, cursor: 'pointer',
                          border: `1px solid ${selected ? 'var(--accent-blue)' : 'var(--border)'}`,
                          backgroundColor: selected ? 'var(--accent-blue-light)' : 'transparent',
                          color: selected ? 'var(--accent-blue)' : 'var(--muted)'
                        }}>
                        {c.name}
                      </button>
                    );
                  })}
                  {u.clientIds.length === 0 && (
                    <span style={{ fontSize: '11px', color: 'var(--bad)', fontWeight: 600 }}>nenhum cliente atribuído</span>
                  )}
                </div>
              )}

              {u.role === 'admin' && (
                <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                  Administrador enxerga todos os clientes e gerencia acessos.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
