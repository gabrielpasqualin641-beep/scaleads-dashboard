/**
 * Demo local sem nenhuma chave: backend em memória com conversas de exemplo (cérebro offline).
 *   npm run demo   →  http://localhost:3333  (painel: npm run panel:dev → http://localhost:3000)
 *   login: demo@equipe.local / demo-senha-123
 */
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { handleHotmart } from "../integrations/hotmart.js";
import { createHarness } from "../sim/harness.js";
import { buildServer } from "../server.js";

const h = createHarness({ start: new Date().toISOString(), live: Boolean(config.ANTHROPIC_API_KEY) });
// O relógio do demo anda junto com o real, e o simulador pode adiantá-lo (/api/sim/tempo) para ver as cadências.
h.clock.now = new Date();
setInterval(() => (h.clock.now = new Date(h.clock.now.getTime() + 1000)), 1000).unref();

await h.store.createUser({ email: "demo@equipe.local", name: "Equipe (demo)", passwordHash: await bcrypt.hash("demo-senha-123", 10) });
const e = h.app.engine;

const convs: Array<[string, string, string[]]> = [
  ["5511990000001", "João Silva", ["Oi, quero saber do treino", "Termino muito rápido, acho que é ansiedade", "Uns 3 anos", "Nunca tentei nada", "Pode mandar o link"]],
  ["5511990000002", "Carlos Souza", ["Boa tarde", "Achei caro", "Vou pensar"]],
  ["5511990000003", "Rafael Lima", ["Oi", "Quero marcar uma consulta individual", "2"]],
  ["5511990000004", "André Costa", ["Oi", "É sigiloso? Minha esposa não pode saber", "Prefiro remédio, não é mais fácil?"]],
  ["5511990000005", "Paulo Mendes", ["Oi", "Com que nome aparece na fatura do cartão?"]],
  ["5511990000006", "Marcos Dias", ["Oi", "Para"]],
];
for (const [phone, name, msgs] of convs) for (const text of msgs) await e.handleWhatsApp({ from: phone, name, text });

const purchase = (phone: string, name: string, tx: string) =>
  handleHotmart(h.app.deps, { event: "PURCHASE_APPROVED", data: { buyer: { name, checkout_phone: phone }, product: { name: "Treino CONTROLE 2.0" }, purchase: { transaction: tx, price: { value: 397 }, origin: { sck: "f4-ia" } } } });
await purchase("5511990000001", "João Silva", "HP-DEMO-1");

const lead = (await h.store.getLeadByPhone("5511990000004"))!;
await h.store.updateLead(lead.id, { callConsent: { given: true, at: new Date().toISOString(), origin: "quiz", text: "Aceito receber ligação da equipe do Marlon Mattedi" } });
const { session } = await h.startCall((await h.store.getLead(lead.id))!, "lead pediu informações sobre o treino");
for (const t of ["Sou eu", "Pode falar", "Quanto custa?"]) await e.handleVoiceTurn(session, t);
await h.endCall(session);

const server = await buildServer(h.app, { sim: h });
await server.listen({ port: config.PORT, host: "0.0.0.0" });
console.log(`Demo no ar: http://localhost:${config.PORT} · cérebro: ${h.app.engine.brain.name} · login demo@equipe.local / demo-senha-123`);
console.log("Converse com o agente no painel: http://localhost:3000/simulador");
