/**
 * Conecta o Fernando ao WhatsApp por QR code (Baileys, NÃO-oficial) — só para TESTE.
 *   npm run whatsapp
 *
 * ⚠️  Conexão não-oficial: viola os termos do WhatsApp e pode BANIR o número.
 *     Use um número DESCARTÁVEL (nunca o do Marlon) e não faça disparos em massa.
 *
 * A sessão fica salva na pasta ./auth_whatsapp (não precisa reescanear toda vez).
 * Para trocar de número: apague essa pasta e rode de novo.
 */
import { makeWASocket, DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { buildApp } from "../app.js";
import { BaileysMessenger } from "../channels/baileys.js";
import { MemoryStore } from "../store/MemoryStore.js";
import { MemoryScheduler } from "../queue/scheduler.js";

const AUTH_DIR = "auth_whatsapp";

// Logger silencioso: o Baileys é verboso por padrão; aqui só queremos ver o QR e as mensagens.
const silentLogger = {
  level: "silent",
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
  child() { return silentLogger; },
} as unknown as Parameters<typeof makeWASocket>[0]["logger"];

// Messenger começa com um socket "vazio"; é substituído assim que a conexão abre.
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
      console.log("📱 No celular do número de TESTE: WhatsApp → Aparelhos conectados → Conectar aparelho → escaneie:\n");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      console.log("\n✅ Conectado! O Fernando já responde as mensagens que chegarem neste número.");
      console.log("   (deixe esta janela aberta — se fechar, ele para de responder)\n");
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log(`\n❌ Sessão encerrada (logout). Apague a pasta "${AUTH_DIR}" e rode de novo para um novo QR.`);
        process.exit(0);
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

connect().catch((e) => {
  console.error("Falha ao iniciar:", (e as Error).message);
  process.exit(1);
});
