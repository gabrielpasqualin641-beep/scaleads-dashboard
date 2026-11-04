"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmt, subscribe } from "../lib/api";

interface Lead {
  id: string;
  phone: string;
  name: string | null;
  stage: string;
  aiPaused: boolean;
  pausedBy: string | null;
  optOutWhatsapp: boolean;
  optOutVoz: boolean;
  blockedMinor: boolean;
  callConsent: { origin: string; at: string; text: string } | null;
  purchases: string[];
  summary: string;
  updatedAt: string;
  lastMessage?: { text: string; author: string; at: string } | null;
}
interface Msg { id: string; author: "lead" | "ai" | "human" | "system"; text: string; createdAt: string; channel: string }
interface Detail {
  lead: Lead;
  messages: Msg[];
  calls: Array<{ id: string; status: string; reason: string; summary: string | null; durationSec: number | null; createdAt: string }>;
  janela24hAberta: boolean;
  jobs: Array<{ type: string; runAt: string; step?: string }>;
}
interface Task { id: string; leadId: string; reason: string; urgency: string; status: string; createdAt: string; lead: { name: string | null } | null }

const AUTHOR: Record<string, string> = { lead: "Lead", ai: "IA", human: "Equipe", system: "Contexto interno" };

export default function Conversas() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const selRef = useRef(sel);
  selRef.current = sel;

  const loadList = useCallback(async () => {
    setLeads(await api<Lead[]>(`/api/leads${search ? `?search=${encodeURIComponent(search)}` : ""}`));
    setTasks((await api<Task[]>("/api/tasks")).filter((t) => t.status !== "concluida"));
  }, [search]);
  const loadDetail = useCallback(async (id: string) => setDetail(await api<Detail>(`/api/leads/${id}`)), []);

  useEffect(() => {
    void loadList();
  }, [loadList]);
  useEffect(() => {
    if (sel) void loadDetail(sel);
  }, [sel, loadDetail]);
  useEffect(
    () =>
      subscribe((ev) => {
        void loadList();
        if (selRef.current && (ev.leadId === selRef.current || ev.type === "poll")) void loadDetail(selRef.current);
      }),
    [loadList, loadDetail],
  );

  const act = async (fn: () => Promise<unknown>) => {
    setErr("");
    try {
      await fn();
      if (sel) await loadDetail(sel);
      await loadList();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const l = detail?.lead;
  return (
    <div className="split">
      <div className="card list">
        <div style={{ padding: 12 }}>
          <input placeholder="Buscar por nome ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {tasks.length > 0 && (
          <div style={{ padding: "0 12px 8px" }}>
            {tasks.map((t) => (
              <div key={t.id} className="item" onClick={() => setSel(t.leadId)} style={{ borderRadius: 8, background: t.urgency === "alta" ? "var(--danger-soft)" : "var(--warn-soft)" }}>
                <b>{t.urgency === "alta" ? "URGENTE · " : ""}Transferência</b> · {t.lead?.name ?? "contato"}
                <div className="small">{t.reason}</div>
                <button className="small" style={{ marginTop: 4 }} onClick={(e) => (e.stopPropagation(), act(() => api(`/api/tasks/${t.id}`, { method: "POST", body: JSON.stringify({ status: "concluida" }) })))}>
                  Marcar como resolvida
                </button>
              </div>
            ))}
          </div>
        )}
        {leads.map((x) => (
          <div key={x.id} className={`item ${x.id === sel ? "sel" : ""}`} onClick={() => setSel(x.id)}>
            <div>
              <b>{x.name ?? x.phone}</b>
              {x.aiPaused && <span className="badge warn">IA pausada</span>}
              {x.optOutWhatsapp && <span className="badge danger">opt-out</span>}
              {x.blockedMinor && <span className="badge danger">menor</span>}
              <span className="badge">{x.stage}</span>
            </div>
            <div className="small muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {x.lastMessage ? `${AUTHOR[x.lastMessage.author]}: ${x.lastMessage.text}` : "sem mensagens"}
            </div>
          </div>
        ))}
      </div>

      <div className="card chat">
        {!l ? (
          <div className="wrap muted">Selecione uma conversa.</div>
        ) : (
          <>
            <div className="chat-head">
              <div style={{ flex: 1 }}>
                <b>{l.name ?? "Sem nome"}</b> <span className="muted">+{l.phone}</span>
                <div className="small muted">
                  Etapa: {l.stage} · Compras: {l.purchases.join(", ") || "nenhuma"} · Ligação: {l.callConsent ? `consentiu (${l.callConsent.origin}, ${fmt(l.callConsent.at)})` : "sem consentimento"}
                  {l.optOutVoz && " · não ligar"}
                </div>
              </div>
              {l.aiPaused ? (
                <button className="primary" onClick={() => act(() => api(`/api/leads/${l.id}/release`, { method: "POST" }))}>Reativar IA</button>
              ) : (
                <button className="danger" onClick={() => act(() => api(`/api/leads/${l.id}/takeover`, { method: "POST" }))}>Assumir conversa</button>
              )}
            </div>
            {l.summary && <div className="small muted" style={{ padding: "8px 16px", borderBottom: "1px solid var(--line)" }}>Resumo: {l.summary}</div>}
            <div className="msgs">
              {detail!.messages.map((m) => (
                <div key={m.id} className={`msg ${m.author}`}>
                  <div className="small muted">{AUTHOR[m.author]} · {fmt(m.createdAt)}</div>
                  {m.text}
                </div>
              ))}
              {detail!.calls.map((c) => (
                <div key={c.id} className="msg system">
                  Ligação {c.status} · {fmt(c.createdAt)} · {c.reason}
                  {c.summary ? ` · Resumo: ${c.summary}` : ""}
                </div>
              ))}
            </div>
            {detail!.jobs.length > 0 && (
              <div className="small muted" style={{ padding: "6px 16px" }}>
                Próximos contatos: {detail!.jobs.map((j) => `${j.type}${j.step ? ` ${j.step}` : ""} (${fmt(j.runAt)})`).join(" · ")}
              </div>
            )}
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                void act(async () => {
                  await api(`/api/leads/${l.id}/messages`, { method: "POST", body: JSON.stringify({ text }) });
                  setText("");
                });
              }}
            >
              <input
                placeholder={detail!.janela24hAberta ? "Responder como equipe (a IA pausa neste contato)" : "Janela de 24h fechada: só template aprovado"}
                value={text}
                disabled={!detail!.janela24hAberta || l.optOutWhatsapp}
                onChange={(e) => setText(e.target.value)}
              />
              <button className="primary" disabled={!detail!.janela24hAberta || l.optOutWhatsapp}>Enviar</button>
            </form>
            {err && <div className="badge danger" style={{ margin: "0 12px 12px" }}>{err}</div>}
          </>
        )}
      </div>
    </div>
  );
}
