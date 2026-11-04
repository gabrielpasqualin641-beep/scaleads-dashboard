export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  if (r.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
    location.href = "/login";
    throw new Error("não autenticado");
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `erro ${r.status}`);
  return body as T;
}

/** Atualiza em tempo real (SSE) com polling de reserva. */
export function subscribe(onEvent: (ev: { type: string; leadId: string }) => void) {
  let es: EventSource | null = null;
  try {
    es = new EventSource("/api/stream", { withCredentials: true });
    es.onmessage = (m) => onEvent(JSON.parse(m.data));
  } catch {
    /* sem SSE */
  }
  const poll = setInterval(() => onEvent({ type: "poll", leadId: "" }), 8000);
  return () => {
    es?.close();
    clearInterval(poll);
  };
}

export const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—";
