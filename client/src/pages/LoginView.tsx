import React, { useState } from 'react';
import { BarChart3, Eye, EyeOff, Loader2, LogIn, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const LoginView: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível entrar.');
      setPassword('');
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
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '22px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              backgroundColor: 'var(--accent-blue)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <BarChart3 size={20} color="#fff" />
          </div>
          <div style={{ lineHeight: 1.25 }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--ink)' }}>ScaleAds</div>
            <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Performance Hub · Meta Ads</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h1 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--ink)', marginBottom: '4px' }}>
              Entrar no painel
            </h1>
            <p style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
              Acesso restrito ao administrador da conta.
            </p>
          </div>

          <div>
            <label htmlFor="login-email" style={labelStyle}>E-mail</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              disabled={submitting}
              placeholder="voce@exemplo.com"
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor="login-password" style={labelStyle}>Senha</label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={submitting}
                placeholder="••••••••"
                style={{ ...inputStyle, paddingRight: '40px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--muted)',
                  display: 'inline-flex',
                  padding: '4px'
                }}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '9px 11px',
                borderRadius: '8px',
                border: '1px solid var(--bad)',
                backgroundColor: 'rgba(220, 38, 38, 0.08)',
                color: 'var(--bad)',
                fontSize: '12.5px',
                fontWeight: 600
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            style={{ justifyContent: 'center', gap: '7px', padding: '10px' }}
          >
            {submitting ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />}
            <span>{submitting ? 'Entrando...' : 'Entrar'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
