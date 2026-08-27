import React, { useState } from 'react';
import { KeyRound, Loader2, AlertCircle, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const MIN_LENGTH = 10;

/**
 * Exigida quando o usuário entra com senha provisória. Fica antes do painel:
 * sem trocar a senha, nada do dashboard é montado.
 */
export const ChangePasswordView: React.FC = () => {
  const { user, changePassword, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const localError = (): string | null => {
    if (next.length < MIN_LENGTH) return `A nova senha precisa ter ao menos ${MIN_LENGTH} caracteres.`;
    if (!/[a-zA-Z]/.test(next) || !/[0-9]/.test(next)) return 'A nova senha precisa combinar letras e números.';
    if (next !== confirm) return 'A confirmação não confere com a nova senha.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const invalid = localError();
    if (invalid) {
      setError(invalid);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await changePassword(current, next);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível trocar a senha.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '9px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg)',
    color: 'var(--ink)',
    fontSize: '13.5px',
    outline: 'none'
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '11.5px',
    fontWeight: 700,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    marginBottom: '6px'
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        backgroundColor: 'var(--bg)'
      }}
    >
      <form onSubmit={handleSubmit} className="card" style={{ width: '100%', maxWidth: '400px', padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <KeyRound size={18} style={{ color: 'var(--accent-blue)' }} />
          <div style={{ lineHeight: 1.3 }}>
            <h1 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--ink)' }}>Defina uma nova senha</h1>
            <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
              {user?.email} · troca obrigatória no primeiro acesso
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="cp-current" style={labelStyle}>Senha provisória</label>
          <input id="cp-current" type="password" value={current} onChange={e => setCurrent(e.target.value)}
            autoComplete="current-password" required autoFocus disabled={submitting} style={inputStyle} />
        </div>

        <div>
          <label htmlFor="cp-next" style={labelStyle}>Nova senha</label>
          <input id="cp-next" type="password" value={next} onChange={e => setNext(e.target.value)}
            autoComplete="new-password" required disabled={submitting} style={inputStyle} />
          <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '5px' }}>
            Mínimo {MIN_LENGTH} caracteres, com letras e números.
          </p>
        </div>

        <div>
          <label htmlFor="cp-confirm" style={labelStyle}>Confirmar nova senha</label>
          <input id="cp-confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password" required disabled={submitting} style={inputStyle} />
        </div>

        {error && (
          <div role="alert" style={{
            display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '9px 11px', borderRadius: '8px',
            border: '1px solid var(--bad)', backgroundColor: 'rgba(220, 38, 38, 0.08)',
            color: 'var(--bad)', fontSize: '12.5px', fontWeight: 600
          }}>
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={submitting} style={{ justifyContent: 'center', gap: '7px', padding: '10px' }}>
          {submitting ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
          <span>{submitting ? 'Salvando...' : 'Salvar nova senha'}</span>
        </button>

        <button type="button" className="btn btn-sm" onClick={logout} style={{ justifyContent: 'center', gap: '6px' }}>
          <LogOut size={13} /> Sair
        </button>
      </form>
    </div>
  );
};
