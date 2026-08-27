import React, { useEffect, useState } from 'react';
import { Save, Check, AlertCircle, Loader2, Target } from 'lucide-react';
import { ProjectBrief } from '../types';
import { api } from '../services/api';
import { useClient } from '../context/ClientContext';
import { useAuth } from '../context/AuthContext';
import { can } from '../utils/permissions';
import { TableSkeleton } from '../components/common/Skeletons';
import { ErrorState } from '../components/common/ErrorState';
import { ResearchPanel } from '../components/common/ResearchPanel';

const EMPTY: Partial<ProjectBrief> = {
  description: '',
  offer: '',
  audience: '',
  targetCpl: null,
  targetCpa: null,
  targetRoas: null,
  averageTicket: null,
  monthlyBudget: null,
  constraints: ''
};

export const ProjectView: React.FC = () => {
  const { selectedClient } = useClient();
  const { user } = useAuth();
  const editable = can.editData(user);

  const [form, setForm] = useState<Partial<ProjectBrief>>(EMPTY);
  const [saved, setSaved] = useState<ProjectBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = async () => {
    if (!selectedClient) return;
    try {
      setLoading(true);
      setError(null);
      const brief = await api.getBrief(selectedClient.id);
      setSaved(brief);
      setForm(brief ? { ...brief } : EMPTY);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar o briefing');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [selectedClient]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || saving) return;
    setSaving(true);
    setError(null);
    try {
      const brief = await api.saveBrief(selectedClient.id, form);
      setSaved(brief);
      setForm({ ...brief });
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <TableSkeleton />;
  if (error && !saved) return <ErrorState message={error} onRetry={load} />;

  const input: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '9px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg)',
    color: 'var(--ink)',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none'
  };

  const label: React.CSSProperties = {
    display: 'block',
    fontSize: '11.5px',
    fontWeight: 700,
    color: 'var(--muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    marginBottom: '6px'
  };

  const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  const setNum = (key: keyof ProjectBrief) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value === '' ? null : Number(e.target.value) }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">Projeto</h2>
          <p className="page-description">
            O que o cliente vende e quais são as metas. As metas daqui viram a referência da análise de campanhas.
          </p>
        </div>
        {saved && (
          <div style={{ fontSize: '11.5px', color: 'var(--muted)', textAlign: 'right' }}>
            Atualizado em {new Date(saved.updatedAt).toLocaleString('pt-BR')}
            <br />
            por {saved.updatedBy}
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="card" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label htmlFor="pb-desc" style={label}>Descrição do projeto</label>
          <textarea
            id="pb-desc"
            value={form.description || ''}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={3}
            disabled={!editable}
            placeholder="O que o cliente vende, para quem, e qual o diferencial."
            style={{ ...input, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
          <div>
            <label htmlFor="pb-offer" style={label}>Oferta / funil</label>
            <textarea
              id="pb-offer"
              value={form.offer || ''}
              onChange={e => setForm(f => ({ ...f, offer: e.target.value }))}
              rows={2}
              disabled={!editable}
              placeholder="Ex.: webinário gratuito que converte para mentoria."
              style={{ ...input, resize: 'vertical' }}
            />
          </div>
          <div>
            <label htmlFor="pb-aud" style={label}>Público-alvo</label>
            <textarea
              id="pb-aud"
              value={form.audience || ''}
              onChange={e => setForm(f => ({ ...f, audience: e.target.value }))}
              rows={2}
              disabled={!editable}
              placeholder="Faixa etária, perfil, momento de compra."
              style={{ ...input, resize: 'vertical' }}
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
            <Target size={15} style={{ color: 'var(--accent-blue)' }} />
            <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--ink)' }}>Metas</span>
            <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
              — o CPL alvo é o que a análise usa para separar escalar de cortar
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
            <div>
              <label htmlFor="pb-cpl" style={label}>CPL alvo (R$)</label>
              <input id="pb-cpl" type="number" step="0.01" min="0" value={num(form.targetCpl)} onChange={setNum('targetCpl')} disabled={!editable} style={input} />
            </div>
            <div>
              <label htmlFor="pb-cpa" style={label}>CAC alvo (R$)</label>
              <input id="pb-cpa" type="number" step="0.01" min="0" value={num(form.targetCpa)} onChange={setNum('targetCpa')} disabled={!editable} style={input} />
            </div>
            <div>
              <label htmlFor="pb-roas" style={label}>ROAS alvo</label>
              <input id="pb-roas" type="number" step="0.1" min="0" value={num(form.targetRoas)} onChange={setNum('targetRoas')} disabled={!editable} style={input} />
            </div>
            <div>
              <label htmlFor="pb-ticket" style={label}>Ticket médio (R$)</label>
              <input id="pb-ticket" type="number" step="0.01" min="0" value={num(form.averageTicket)} onChange={setNum('averageTicket')} disabled={!editable} style={input} />
            </div>
            <div>
              <label htmlFor="pb-budget" style={label}>Verba mensal (R$)</label>
              <input id="pb-budget" type="number" step="0.01" min="0" value={num(form.monthlyBudget)} onChange={setNum('monthlyBudget')} disabled={!editable} style={input} />
            </div>
          </div>

          <p style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '8px' }}>
            Ticket médio e CAC não vêm da Meta — só existem se você informar aqui.
          </p>
        </div>

        <div>
          <label htmlFor="pb-constraints" style={label}>Restrições e observações</label>
          <textarea
            id="pb-constraints"
            value={form.constraints || ''}
            onChange={e => setForm(f => ({ ...f, constraints: e.target.value }))}
            rows={2}
            disabled={!editable}
            placeholder="Sazonalidade, limites de criativo, políticas do nicho, o que já foi testado."
            style={{ ...input, resize: 'vertical' }}
          />
        </div>

        {error && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--bad)', fontSize: '12.5px', fontWeight: 600 }}>
            <AlertCircle size={15} /> {error}
          </div>
        )}

        {editable && (
          <div>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ gap: '7px' }}>
              {saving ? <Loader2 size={14} className="spin" /> : done ? <Check size={14} /> : <Save size={14} />}
              <span>{saving ? 'Salvando...' : done ? 'Salvo' : 'Salvar projeto'}</span>
            </button>
          </div>
        )}
      </form>

      <ResearchPanel />
    </div>
  );
};
