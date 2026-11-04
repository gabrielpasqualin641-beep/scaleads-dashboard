"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";

type Saida =
  | { tipo: "texto"; texto: string }
  | { tipo: "template"; nome: string; texto: string }
  | { tipo: "botoes"; texto: string; botoes: Array<{ id: string; title: string }> }
  | { tipo: "lista"; texto: string; opcoes: Array<{ id: string; title: string }> };

interface Bolha {
  de: "lead" | "ia" | "sistema";
  texto: string;
  extra?: Saida;
  nota?: string;
}
interface Tool { nome: string; entrada: unknown; resultado: unknown }
interface Estado {
  etapa: string;
  iaPausada: boolean;
  optOutWhatsapp: boolean;
  optOutVoz: boolean;
  bloqueadoMenor: boolean;
  consentimentoLigacao: boolean;
  compras: string[];
  transferencias: Array<{ motivo: string; urgencia: string }>;
  proximosContatos: Array<{ tipo: string; etapa?: string; quando: string }>;
  ligacoesDiscadas: number;
}

const SUGESTOES_WA = ["Oi, quero saber do treino", "Quanto custa?", "Funciona pra mim?", "É sigiloso?", "Tá caro", "Vou pensar", "Você é um robô?", "Quero marcar uma consulta", "Quero o link do CONTROLE 2.0", "Para"];
const SUGESTOES_VOZ = ["Alô?", "Sou eu", "Não, aqui é a esposa dele", "Pode falar, estou sozinho", "Agora não, estou no trabalho", "Quanto custa?", "É robô?", "Não me liga mais"];

const linkify = (t: string) =>
  t.split(/(https?:\/\/\S+)/g).map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all", textDecoration: "underline" }}>
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );

export default function Simulador() {
  const [canal, setCanal] = useState<"whatsapp" | "voz">("whatsapp");
  const [nome, setNome] = useState("João Teste");
  const [telefone, setTelefone] = useState("");
  const [bolhas, setBolhas] = useState<Bolha[]>([]);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [tools, setTools] = useState<Tool[]>([]);
  const [regra, setRegra] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [info, setInfo] = useState<{ cerebro: string; modelo: string | null; agente: string; relogio: string } | null>(null);
  const [ligacao, setLigacao] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Gerado só no navegador (evita divergência de hidratação).
    setTelefone(`55119${Math.floor(10000000 + Math.random() * 89999999)}`);
    api<typeof info>("/api/sim/info")
      .then(setInfo)
      .catch((e) => setErro(String(e.message)));
  }, []);
  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth" });
  }, [bolhas]);

  const add = (b: Bolha[]) => setBolhas((x) => [...x, ...b]);
  const saidas = (r: Saida[]): Bolha[] => r.map((s) => ({ de: "ia", texto: s.texto, extra: s, nota: s.tipo === "template" ? `template ${s.nome} (fora da janela de 24h)` : undefined }));

  async function run<T>(fn: () => Promise<T>) {
    setOcupado(true);
    setErro("");
    try {
      return await fn();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function enviarWhatsApp(msg: string, botao?: { id: string; title: string }) {
    add([{ de: "lead", texto: botao ? `[${botao.title}]` : msg }]);
    const r = await run(() =>
      api<{ respostas: Saida[]; regra: string | null; tools: Tool[]; estado: Estado; relogio: string; bloqueios: string[] }>("/api/sim/whatsapp", {
        method: "POST",
        body: JSON.stringify({ telefone, nome, texto: msg, botao: botao?.id, tituloBotao: botao?.title }),
      }),
    );
    if (!r) return;
    add(r.respostas.length ? saidas(r.respostas) : [{ de: "sistema", texto: r.estado?.iaPausada ? "A IA está pausada neste contato (transferido para a equipe). Ninguém responde automaticamente." : "Sem resposta." }]);
    if (r.bloqueios.length) add([{ de: "sistema", texto: `Resposta do modelo bloqueada pelo filtro: ${r.bloqueios.join(", ")}` }]);
    setTools(r.tools);
    setRegra(r.regra);
    setEstado(r.estado);
    setInfo((i) => (i ? { ...i, relogio: r.relogio } : i));
  }

  async function iniciarLigacao() {
    const r = await run(() => api<{ ligacaoId: string; fala: string; estado: Estado }>("/api/sim/ligacao", { method: "POST", body: JSON.stringify({ telefone, nome }) }));
    if (!r) return;
    setLigacao(r.ligacaoId);
    add([{ de: "sistema", texto: "Ligação iniciada (simulada). A IA fala primeiro." }, { de: "ia", texto: r.fala }]);
    setEstado(r.estado);
  }

  async function falar(msg: string) {
    if (!ligacao) return;
    add([{ de: "lead", texto: msg }]);
    const r = await run(() =>
      api<{ fala: string; desligou: boolean; regra: string | null; tools: Tool[]; estado: Estado }>(`/api/sim/ligacao/${ligacao}`, { method: "POST", body: JSON.stringify({ texto: msg, telefone }) }),
    );
    if (!r) return;
    add([{ de: "ia", texto: r.fala }]);
    if (r.desligou) {
      add([{ de: "sistema", texto: "A IA encerrou a ligação. Fica salvo só um resumo (a transcrição é descartada)." }]);
      setLigacao(null);
    }
    setTools(r.tools);
    setRegra(r.regra);
    setEstado(r.estado);
  }

  async function avancar(t: string) {
    const r = await run(() => api<{ executadas: number; respostas: Saida[]; ligacoesNovas: number; estado: Estado; relogio: string }>("/api/sim/tempo", { method: "POST", body: JSON.stringify({ avancar: t, telefone }) }));
    if (!r) return;
    add([{ de: "sistema", texto: `Relógio avançado ${t} → ${r.relogio}. ${r.executadas} cadência(s) executada(s)${r.ligacoesNovas ? `, ${r.ligacoesNovas} ligação(ões) discada(s)` : ""}.` }, ...saidas(r.respostas)]);
    setEstado(r.estado);
    setInfo((i) => (i ? { ...i, relogio: r.relogio } : i));
  }

  async function hotmart(evento: string, produto: "express" | "controle2") {
    const r = await run(() => api<{ resultado: { handled: boolean; event: string }; estado: Estado }>("/api/sim/hotmart", { method: "POST", body: JSON.stringify({ telefone, nome, evento, produto }) }));
    if (!r) return;
    add([{ de: "sistema", texto: `Hotmart: ${evento} (${produto === "express" ? "Controle Express" : "CONTROLE 2.0"}) ${r.resultado.handled ? "registrado" : "ignorado"}.` }]);
    setEstado(r.estado);
  }

  async function consentir() {
    const r = await run(() => api<{ estado: Estado }>("/api/sim/consentimento", { method: "POST", body: JSON.stringify({ telefone, nome }) }));
    if (!r) return;
    add([{ de: "sistema", texto: "Consentimento de ligação registrado (como o checkbox do quiz)." }]);
    setEstado(r.estado);
  }

  async function novoContato() {
    if (ligacao) await api(`/api/sim/ligacao/${ligacao}/encerrar`, { method: "POST" }).catch(() => undefined);
    await api("/api/sim/reset", { method: "POST", body: JSON.stringify({ telefone }) }).catch(() => undefined);
    setTelefone(`55119${Math.floor(10000000 + Math.random() * 89999999)}`);
    setBolhas([]);
    setTools([]);
    setRegra(null);
    setEstado(null);
    setLigacao(null);
  }

  function enviar() {
    const t = texto.trim();
    if (!t || ocupado) return;
    setTexto("");
    if (canal === "voz") void falar(t);
    else void enviarWhatsApp(t);
  }

  const sugestoes = canal === "voz" ? SUGESTOES_VOZ : SUGESTOES_WA;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 16, padding: "16px 20px", height: "calc(100vh - 52px)" }}>
      <div className="card chat">
        <div className="chat-head">
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>Fale com o agente como se fosse o lead</b>
            <div className="small muted">
              Cérebro: {info ? (info.cerebro === "claude" ? `Claude (${info.modelo})` : "offline (roteiro, sem IA). Coloque ANTHROPIC_API_KEY no .env para usar o Claude") : "…"} · relógio simulado: {info?.relogio ?? "…"}
            </div>
          </div>
          <button className={canal === "whatsapp" ? "primary" : ""} onClick={() => setCanal("whatsapp")}>WhatsApp</button>
          <button className={canal === "voz" ? "primary" : ""} onClick={() => setCanal("voz")}>Ligação</button>
          <button onClick={novoContato}>Novo contato</button>
        </div>

        <div className="msgs" style={{ background: "var(--bg)" }}>
          {!bolhas.length && (
            <div className="muted small" style={{ margin: "auto", textAlign: "center", maxWidth: 420 }}>
              {canal === "whatsapp" ? "Escreva como se você fosse um lead chegando no WhatsApp. Ex.: “Oi, quero saber do treino”." : "Clique em “Iniciar ligação”. A IA liga para o lead e fala primeiro; responda como se tivesse atendido."}
            </div>
          )}
          {bolhas.map((b, i) =>
            b.de === "sistema" ? (
              <div key={i} className="msg system">{b.texto}</div>
            ) : (
              <div key={i} className={`msg ${b.de === "lead" ? "ai" : "lead"}`} style={b.de === "lead" ? { alignSelf: "flex-end" } : { alignSelf: "flex-start" }}>
                <div className="small muted">{b.de === "lead" ? "Você (lead)" : canal === "voz" && !b.extra ? "IA (falando)" : "IA"}{b.nota ? ` · ${b.nota}` : ""}</div>
                {linkify(b.texto)}
                {b.extra?.tipo === "botoes" && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {b.extra.botoes.map((x) => (
                      <button key={x.id} disabled={ocupado} onClick={() => enviarWhatsApp(x.title, x)}>{x.title}</button>
                    ))}
                  </div>
                )}
                {b.extra?.tipo === "lista" && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {b.extra.opcoes.map((x) => (
                      <button key={x.id} disabled={ocupado} onClick={() => enviarWhatsApp(x.title, x)}>{x.title}</button>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
          {ocupado && <div className="msg system">a IA está respondendo…</div>}
          <div ref={fim} />
        </div>

        <div style={{ padding: "8px 12px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {sugestoes.map((s) => (
            <button key={s} className="small" disabled={ocupado || (canal === "voz" && !ligacao)} onClick={() => (canal === "voz" ? falar(s) : enviarWhatsApp(s))}>{s}</button>
          ))}
        </div>
        {canal === "voz" && !ligacao ? (
          <div className="composer">
            <button className="primary" disabled={ocupado} onClick={iniciarLigacao}>Iniciar ligação</button>
            <span className="small muted" style={{ alignSelf: "center" }}>Na vida real a ligação só acontece com consentimento; aqui é um teste de conversa.</span>
          </div>
        ) : (
          <form className="composer" onSubmit={(e) => (e.preventDefault(), enviar())}>
            <input placeholder={canal === "voz" ? "O que você responde na ligação…" : "Mensagem do lead…"} value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
            <button className="primary" disabled={ocupado}>Enviar</button>
            {canal === "voz" && ligacao && (
              <button type="button" onClick={async () => (await api(`/api/sim/ligacao/${ligacao}/encerrar`, { method: "POST" }), setLigacao(null), add([{ de: "sistema", texto: "Você desligou." }]))}>Desligar</button>
            )}
          </form>
        )}
        {erro && <div className="badge danger" style={{ margin: "0 12px 12px" }}>{erro}</div>}
      </div>

      <div className="card" style={{ overflow: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <b>Nome do lead</b>
          <input value={nome} onChange={(e) => setNome(e.target.value)} style={{ marginTop: 6 }} />
          <div className="small muted" style={{ marginTop: 4 }}>Telefone simulado: +{telefone}</div>
        </div>

        <div>
          <b>Por dentro do agente</b>
          <div className="small" style={{ marginTop: 6 }}>
            Regra fixa ativada: {regra ? <span className="badge warn">{regra}</span> : <span className="muted">nenhuma</span>}
          </div>
          <div className="small" style={{ marginTop: 6 }}>Ferramentas usadas na última resposta:</div>
          {tools.length ? (
            tools.map((t, i) => (
              <details key={i} style={{ marginTop: 4 }}>
                <summary className="small"><code>{t.nome}</code></summary>
                <pre className="small" style={{ whiteSpace: "pre-wrap", margin: "4px 0", color: "var(--muted)" }}>{JSON.stringify({ entrada: t.entrada, resultado: t.resultado }, null, 2)}</pre>
              </details>
            ))
          ) : (
            <div className="small muted">nenhuma</div>
          )}
        </div>

        {estado && (
          <div className="small" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <b style={{ fontSize: 14 }}>Estado do lead</b>
            <div>Etapa do funil: <span className="badge">{estado.etapa}</span></div>
            <div>Compras: {estado.compras.join(", ") || "nenhuma"}</div>
            <div>Consentimento de ligação: {estado.consentimentoLigacao ? "sim" : "não"}</div>
            {estado.iaPausada && <div><span className="badge warn">IA pausada (com a equipe)</span></div>}
            {estado.optOutWhatsapp && <div><span className="badge danger">opt-out WhatsApp</span></div>}
            {estado.optOutVoz && <div><span className="badge danger">opt-out ligação</span></div>}
            {estado.bloqueadoMenor && <div><span className="badge danger">bloqueado (menor de idade)</span></div>}
            {estado.transferencias.map((t, i) => (
              <div key={i}><span className={`badge ${t.urgencia === "alta" ? "danger" : "warn"}`}>transferência {t.urgencia}</span> {t.motivo}</div>
            ))}
            <div style={{ marginTop: 4 }}>Próximos contatos automáticos:</div>
            {estado.proximosContatos.length ? estado.proximosContatos.map((j, i) => <div key={i} className="muted">· {j.tipo}{j.etapa ? ` ${j.etapa}` : ""} em {j.quando}</div>) : <div className="muted">nenhum</div>}
          </div>
        )}

        <div>
          <b>Testar o tempo e eventos</b>
          <div className="small muted" style={{ margin: "4px 0 6px" }}>Adianta o relógio para ver lembretes, retomadas e pós-venda saindo.</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["+30m", "+3h", "+1d", "+3d"].map((t) => (
              <button key={t} className="small" disabled={ocupado} onClick={() => avancar(t)}>Avançar {t}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <button className="small" disabled={ocupado} onClick={consentir}>Dar consentimento de ligação</button>
            <button className="small" disabled={ocupado} onClick={() => hotmart("PURCHASE_OUT_OF_SHOPPING_CART", "controle2")}>Abandonou carrinho</button>
            <button className="small" disabled={ocupado} onClick={() => hotmart("PURCHASE_APPROVED", "controle2")}>Comprou CONTROLE 2.0</button>
            <button className="small" disabled={ocupado} onClick={() => hotmart("PURCHASE_APPROVED", "express")}>Comprou Express</button>
          </div>
        </div>
      </div>
    </div>
  );
}
