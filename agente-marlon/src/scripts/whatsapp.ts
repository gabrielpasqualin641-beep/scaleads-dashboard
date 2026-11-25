/**
 * Conecta o Fernando ao WhatsApp por QR code (Baileys, NÃO-oficial).
 *   Local:      npm run whatsapp        (QR aparece no terminal)
 *   Hospedado:  defina PORT (o Render faz isso) → QR numa página web protegida por senha.
 *
 * ⚠️  Conexão não-oficial: viola os termos do WhatsApp e pode BANIR o número.
 *     Use um número DESCARTÁVEL (nunca o do Marlon) e não faça disparos em massa.
 *
 * Variáveis:
 *   AUTH_DIR               pasta da sessão (padrão ./auth_whatsapp; no Render use /data/auth_whatsapp num disco)
 *   PORT                   se definido, sobe a página web do QR (/) e o health check (/health)
 *   WHATSAPP_ADMIN_TOKEN   senha da página do QR (obrigatória quando há PORT) — abra com /?token=SENHA
 */
import http from "node:http";
import { makeWASocket, DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import { buildApp } from "../app.js";
import { BaileysMessenger } from "../channels/baileys.js";
import { MemoryStore } from "../store/MemoryStore.js";
import { MemoryScheduler } from "../queue/scheduler.js";

const AUTH_DIR = process.env.AUTH_DIR || "auth_whatsapp";
const PORT = process.env.PORT ? Number(process.env.PORT) : null;
const ADMIN_TOKEN = process.env.WHATSAPP_ADMIN_TOKEN || "";

// Logger silencioso: o Baileys é verboso por padrão; aqui só queremos ver o QR e as mensagens.
const silentLogger = {
  level: "silent",
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
  child() { return silentLogger; },
} as unknown as Parameters<typeof makeWASocket>[0]["logger"];

// Estado compartilhado com a página web do QR.
let currentQR: string | null = null;
let status: "iniciando" | "aguardando_qr" | "conectado" | "desconectado" = "iniciando";
let connectedAs: string | null = null;

const messenger = new BaileysMessenger({ sendMessage: async () => undefined });
const app = buildApp({ messenger, store: new MemoryStore(), scheduler: new MemoryScheduler() });

console.log("====================================================================");
console.log(`  Fernando no WhatsApp (Baileys) · cérebro: ${app.engine.brain.name}`);
console.log("  ⚠️  Conexão NÃO-oficial. Use um número DESCARTÁVEL. Risco de ban.");
console.log("====================================================================\n");

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({ auth: state, markOnlineOnConnect: false, syncFullHistory: false, logger: silentLogger });
  messenger.sock = sock;
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      currentQR = qr;
      status = "aguardando_qr";
      if (PORT) {
        console.log("📱 Abra a página do QR (link do Render) com ?token=SUA_SENHA e escaneie.");
      } else {
        console.log("📱 No celular do número de TESTE: WhatsApp → Aparelhos conectados → Conectar aparelho → escaneie:\n");
        qrcodeTerminal.generate(qr, { small: true });
      }
    }
    if (connection === "open") {
      currentQR = null;
      status = "conectado";
      connectedAs = sock.user?.id ?? null;
      console.log(`\n✅ Conectado${connectedAs ? ` como ${connectedAs}` : ""}! O Fernando já responde as mensagens deste número.\n`);
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        status = "desconectado";
        currentQR = null;
        console.log(`\n❌ Sessão encerrada (logout). Apague a pasta "${AUTH_DIR}" (ou o disco no Render) e reinicie para um novo QR.`);
        if (!PORT) process.exit(0);
      } else {
        console.log("🔄 Conexão caiu, reconectando...");
        connect().catch((e) => console.error("[whatsapp] erro ao reconectar:", (e as Error).message));
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      const remote = msg.key.remoteJid;
      if (!msg.message || msg.key.fromMe || !remote) continue;
      if (remote.endsWith("@g.us") || remote.endsWith("@newsletter") || remote === "status@broadcast") continue; // ignora grupos/canais/status

      const phone = remote.split("@")[0].split(":")[0].replace(/\D/g, "");
      const name = msg.pushName ?? undefined;
      const text =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        msg.message.buttonsResponseMessage?.selectedButtonId ??
        msg.message.listResponseMessage?.title ??
        "";

      if (!text.trim()) {
        if (msg.message.audioMessage || msg.message.imageMessage || msg.message.videoMessage) {
          await messenger.sendText(phone, "Por enquanto consigo te ajudar melhor por texto 🙂 Pode me escrever?").catch(() => {});
        }
        continue;
      }

      console.log(`← ${phone}${name ? ` (${name})` : ""}: ${text}`);
      try {
        await messenger.typing(phone);
        await app.engine.handleWhatsApp({ from: phone, name, text });
      } catch (e) {
        console.error("[whatsapp] erro ao responder:", (e as Error).message);
      }
    }
  });
}

/** Página web do QR (só quando hospedado, com PORT). Protegida por WHATSAPP_ADMIN_TOKEN. */
function startWebServer(port: number) {
  const page = (body: string) =>
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="12"><title>Fernando · WhatsApp</title><style>body{font-family:system-ui,sans-serif;background:#0b141a;color:#e9edef;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center}.card{background:#111b21;padding:32px;border-radius:16px;max-width:420px;box-shadow:0 8px 30px rgba(0,0,0,.4)}img{width:280px;height:280px;background:#fff;border-radius:8px;padding:8px}h1{font-size:18px}small{color:#8696a0}</style></head><body><div class="card">${body}</div></body></html>`;

  http
    .createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("ok");
      }
      // Autenticação por token (obrigatória quando hospedado).
      if (!ADMIN_TOKEN) {
        res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
        return res.end(page("<h1>⚙️ Falta configurar</h1><p>Defina a variável <b>WHATSAPP_ADMIN_TOKEN</b> no Render e reinicie.</p>"));
      }
      if (url.searchParams.get("token") !== ADMIN_TOKEN) {
        res.writeHead(403, { "content-type": "text/html; charset=utf-8" });
        return res.end(page("<h1>🔒 Acesso restrito</h1><p>Abra o link com <code>?token=SUA_SENHA</code>.</p>"));
      }
      let body: string;
      if (status === "conectado") {
        body = `<h1>✅ Conectado</h1><p>O Fernando está no ar${connectedAs ? ` (<small>${connectedAs.split(":")[0]}</small>)` : ""} e respondendo no WhatsApp.</p>`;
      } else if (currentQR) {
        const dataUrl = await QRCode.toDataURL(currentQR, { margin: 1, width: 280 });
        body = `<h1>📱 Escaneie para conectar</h1><img src="${dataUrl}" alt="QR"><p><small>WhatsApp do número de teste → Aparelhos conectados → Conectar aparelho. A página atualiza sozinha.</small></p>`;
      } else {
        body = `<h1>⏳ Iniciando…</h1><p><small>Status: ${status}. A página atualiza sozinha em instantes.</small></p>`;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page(body));
    })
    .listen(port, "0.0.0.0", () => console.log(`🌐 Página do QR em http://0.0.0.0:${port}/?token=SUA_SENHA (health: /health)`));
}

if (PORT) startWebServer(PORT);
connect().catch((e) => {
  console.error("Falha ao iniciar:", (e as Error).message);
  process.exit(1);
});
