"use client";
import { useState } from "react";
import { api } from "../../lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  return (
    <form
      className="card login"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        try {
          await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
          location.href = "/";
        } catch (x) {
          setErr((x as Error).message);
        }
      }}
    >
      <h2 style={{ margin: 0 }}>Painel da equipe</h2>
      <p className="muted small" style={{ margin: 0 }}>Acesso restrito. Conversas com dados sensíveis: não compartilhe a tela.</p>
      <input placeholder="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      <input placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      {err && <div className="badge danger">{err}</div>}
      <button className="primary" type="submit">Entrar</button>
    </form>
  );
}
