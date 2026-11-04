"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "../lib/api";

export function Nav() {
  const path = usePathname();
  if (path.startsWith("/login")) return null;
  const link = (href: string, label: string) => (
    <Link href={href} className={path === href ? "active" : ""}>
      {label}
    </Link>
  );
  return (
    <nav className="nav">
      <b>Agente comercial</b>
      {link("/simulador", "Falar com o agente")}
      {link("/", "Conversas")}
      {link("/ligacoes", "Ligações")}
      {link("/funil", "Funil e métricas")}
      <span style={{ flex: 1 }} />
      <button
        onClick={async () => {
          await api("/api/auth/logout", { method: "POST" });
          location.href = "/login";
        }}
      >
        Sair
      </button>
    </nav>
  );
}
