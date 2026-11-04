"use client";
import { useEffect, useState } from "react";
import { api, fmt, subscribe } from "../../lib/api";

interface Call {
  id: string;
  direction: string;
  status: string;
  reason: string;
  summary: string | null;
  durationSec: number | null;
  recorded: boolean;
  createdAt: string;
  scheduledFor: string | null;
  lead: { id: string; name: string | null; phone: string } | null;
}

export default function Ligacoes() {
  const [calls, setCalls] = useState<Call[]>([]);
  useEffect(() => {
    const load = () => api<Call[]>("/api/calls").then(setCalls);
    void load();
    return subscribe((ev) => (ev.type === "call" || ev.type === "poll") && void load());
  }, []);
  return (
    <div className="wrap">
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Contato</th>
              <th>Tipo</th>
              <th>Status</th>
              <th>Duração</th>
              <th>Motivo</th>
              <th>Resumo (a transcrição não é guardada)</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id}>
                <td>{fmt(c.scheduledFor ?? c.createdAt)}</td>
                <td>{c.lead?.name ?? c.lead?.phone ?? "—"}</td>
                <td>{c.direction === "inbound" ? "receptiva" : "ativa"}{c.recorded ? " · gravada" : ""}</td>
                <td><span className={`badge ${c.status === "concluida" ? "ok" : c.status === "falhou" ? "danger" : ""}`}>{c.status}</span></td>
                <td>{c.durationSec ? `${Math.floor(c.durationSec / 60)}m${String(c.durationSec % 60).padStart(2, "0")}s` : "—"}</td>
                <td>{c.reason}</td>
                <td className="small">{c.summary ?? "—"}</td>
              </tr>
            ))}
            {!calls.length && (
              <tr>
                <td colSpan={7} className="muted">Nenhuma ligação ainda.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
