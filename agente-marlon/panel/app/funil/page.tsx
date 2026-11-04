"use client";
import { useEffect, useState } from "react";
import { api, subscribe } from "../../lib/api";

interface Metrics {
  funil: Record<"whatsapp" | "voz" | "total", Record<string, number>>;
  objecoes: Array<{ tipo: string; total: number }>;
  taxaTransferencia: number;
  transferencias: number;
  ligacoes: { total: number; atendidas: number; tempoMedioSeg: number };
  optouts: number;
  receitaAtribuida: number;
  vendasAtribuidas: number;
}

const LABELS: Record<string, string> = {
  contatos: "Contatos",
  conversas: "Conversas",
  recomendacao: "Recomendação",
  link_enviado: "Link enviado",
  compra: "Compra (sck=f4-ia)",
  consulta_agendada: "Consulta agendada",
  comparecimento: "Comparecimento",
};
const OBJ: Record<string, string> = {
  preco: "Preço",
  funciona_pra_mim: "Funciona pra mim?",
  sigilo: "Sigilo",
  remedio: "Prefere remédio",
  vergonha: "Vergonha",
  tempo: "Falta de tempo",
  vou_pensar: "Vou pensar",
  confianca: "Confiança",
  outro: "Outra",
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function Funil() {
  const [days, setDays] = useState(30);
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    const load = () => api<Metrics>(`/api/metrics?from=${new Date(Date.now() - days * 86400000).toISOString()}`).then(setM);
    void load();
    return subscribe((ev) => ev.type === "poll" && void load());
  }, [days]);
  if (!m) return <div className="wrap muted">Carregando…</div>;
  const max = Math.max(1, ...Object.values(m.funil.total));
  const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return (
    <div className="wrap" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {[1, 7, 30, 90].map((d) => (
          <button key={d} className={d === days ? "primary" : ""} onClick={() => setDays(d)}>
            {d === 1 ? "Hoje" : `${d} dias`}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <a href={`/api/metrics/csv?date=${ontem}`}>
          <button>Baixar CSV de ontem</button>
        </a>
      </div>

      <div className="grid">
        <div className="card kpi"><div className="muted small">Receita atribuída</div><div className="v">{brl(m.receitaAtribuida)}</div><div className="small muted">{m.vendasAtribuidas} vendas com sck=f4-ia</div></div>
        <div className="card kpi"><div className="muted small">Transferência para humano</div><div className="v">{(m.taxaTransferencia * 100).toFixed(1)}%</div><div className="small muted">{m.transferencias} contatos</div></div>
        <div className="card kpi"><div className="muted small">Ligações atendidas</div><div className="v">{m.ligacoes.atendidas}/{m.ligacoes.total}</div><div className="small muted">tempo médio {Math.round(m.ligacoes.tempoMedioSeg / 60)} min</div></div>
        <div className="card kpi"><div className="muted small">Opt-outs</div><div className="v">{m.optouts}</div></div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Funil por canal</h3>
        <table>
          <thead>
            <tr><th>Etapa</th><th style={{ width: "40%" }}></th><th>WhatsApp</th><th>Voz</th><th>Total</th></tr>
          </thead>
          <tbody>
            {Object.keys(LABELS).map((k) => (
              <tr key={k}>
                <td>{LABELS[k]}</td>
                <td><div className="bar" style={{ width: `${(100 * (m.funil.total[k] ?? 0)) / max}%`, minWidth: 2 }} /></td>
                <td>{m.funil.whatsapp[k] ?? 0}</td>
                <td>{m.funil.voz[k] ?? 0}</td>
                <td><b>{m.funil.total[k] ?? 0}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Objeções mais comuns</h3>
        {m.objecoes.length ? (
          <table>
            <tbody>
              {m.objecoes.map((o) => (
                <tr key={o.tipo}><td>{OBJ[o.tipo] ?? o.tipo}</td><td style={{ width: "50%" }}><div className="bar" style={{ width: `${(100 * o.total) / m.objecoes[0].total}%`, opacity: 0.7 }} /></td><td>{o.total}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="muted">Sem objeções registradas no período.</div>
        )}
      </div>
    </div>
  );
}
