import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { config } from "../../src/config.js";
import { createHarness } from "../../src/sim/harness.js";
import { buildServer } from "../../src/server.js";

config.WA_APP_SECRET = "app-secret";
config.WA_VERIFY_TOKEN = "verify";
config.HOTMART_HOTTOK = "hottok-123";
config.LEAD_WEBHOOK_SECRET = "lead-secret";

async function setup() {
  const h = createHarness();
  const server = await buildServer(h.app);
  return { h, server };
}

const waBody = (from: string, text: string) => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name: "Carlos" } }], messages: [{ id: `wamid.${Math.random()}`, from, type: "text", text: { body: text } }] } }] }],
});

test("webhook do WhatsApp: verificação, assinatura e resposta do agente", async () => {
  const { h, server } = await setup();
  const v = await server.inject({ method: "GET", url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=42" });
  assert.equal(v.body, "42");

  const payload = JSON.stringify(waBody("5511911112222", "Oi, quanto custa?"));
  const bad = await server.inject({ method: "POST", url: "/webhooks/whatsapp", payload, headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=00" } });
  assert.equal(bad.statusCode, 401);

  const sig = `sha256=${createHmac("sha256", "app-secret").update(payload).digest("hex")}`;
  const ok = await server.inject({ method: "POST", url: "/webhooks/whatsapp", payload, headers: { "content-type": "application/json", "x-hub-signature-256": sig } });
  assert.equal(ok.statusCode, 200);
  await new Promise((r) => setTimeout(r, 300));
  const sent = h.messenger.sent.filter((s) => s.to === "5511911112222");
  assert.ok(sent.length >= 1, "agente respondeu");
  assert.match(sent[0].kind === "template" ? sent[0].rendered : sent[0].text, /assistente virtual/);
  await server.close();
});

test("webhook da Hotmart valida hottok e registra compra atribuída", async () => {
  const { h, server } = await setup();
  const body = {
    event: "PURCHASE_APPROVED",
    data: { buyer: { name: "Carlos", email: "c@example.com", checkout_phone: "11933334444" }, product: { name: "Controle Express" }, purchase: { transaction: "HPX1", price: { value: 47 }, origin: { sck: "f4-ia" } } },
  };
  const bad = await server.inject({ method: "POST", url: "/webhooks/hotmart", payload: body, headers: { "x-hotmart-hottok": "errado" } });
  assert.equal(bad.statusCode, 401);
  const ok = await server.inject({ method: "POST", url: "/webhooks/hotmart", payload: body, headers: { "x-hotmart-hottok": "hottok-123" } });
  assert.equal(ok.json().handled, true);
  const lead = await h.store.getLeadByPhone("5511933334444");
  assert.deepEqual(lead?.purchases, ["controle_express"]);
  assert.equal((await h.store.listPurchases())[0].sck, "f4-ia");
  assert.equal((await h.scheduler.list(lead!.id)).filter((j) => j.type === "pos_venda").length, 3);
  await server.close();
});

test("captura de lead guarda consentimento de ligação com data, origem e texto", async () => {
  const { h, server } = await setup();
  const r = await server.inject({
    method: "POST",
    url: "/webhooks/lead",
    headers: { "x-webhook-secret": "lead-secret" },
    payload: { nome: "Pedro", telefone: "(21) 98888-7777", origem: "quiz", aceita_ligacao: true, texto_consentimento_ligacao: "Aceito receber ligação da equipe do Marlon Mattedi" },
  });
  assert.equal(r.json().ok, true);
  const lead = await h.store.getLeadByPhone("5521988887777");
  assert.equal(lead?.callConsent?.origin, "quiz");
  assert.equal(lead?.callConsent?.text, "Aceito receber ligação da equipe do Marlon Mattedi");
  assert.ok(lead?.callConsent?.at);
  assert.equal(h.store.consents.filter((c) => c.kind === "ligacao").length, 1);
  await server.close();
});

test("painel: login, assumir conversa e responder como humano", async () => {
  const { h, server } = await setup();
  await h.store.createUser({ email: "equipe@exemplo.com", name: "Equipe", passwordHash: await bcrypt.hash("senha-super-forte", 4) });
  const denied = await server.inject({ method: "GET", url: "/api/leads" });
  assert.equal(denied.statusCode, 401);
  const login = await server.inject({ method: "POST", url: "/api/auth/login", payload: { email: "equipe@exemplo.com", password: "senha-super-forte" } });
  assert.equal(login.statusCode, 200);
  const cookie = String(login.headers["set-cookie"]).split(";")[0];

  await h.app.engine.handleWhatsApp({ from: "5511955556666", name: "Rafa", text: "Oi" });
  const lead = (await h.store.getLeadByPhone("5511955556666"))!;
  const take = await server.inject({ method: "POST", url: `/api/leads/${lead.id}/takeover`, headers: { cookie } });
  assert.equal(take.json().aiPaused, true);

  const before = h.messenger.sent.length;
  await h.app.engine.handleWhatsApp({ from: "5511955556666", text: "Tem alguém aí?" });
  assert.equal(h.messenger.sent.length, before, "IA pausada não responde");

  const send = await server.inject({ method: "POST", url: `/api/leads/${lead.id}/messages`, headers: { cookie }, payload: { text: "Oi Rafa, aqui é o Pedro da equipe." } });
  assert.equal(send.statusCode, 200);
  const msgs = await h.store.listMessages(lead.id);
  assert.equal(msgs[msgs.length - 1].author, "human");

  const metrics = await server.inject({ method: "GET", url: "/api/metrics", headers: { cookie } });
  assert.ok(metrics.json().funil.total.conversas >= 1);
  const csv = await server.inject({ method: "GET", url: "/api/metrics/csv", headers: { cookie } });
  assert.match(csv.body, /^secao,chave,whatsapp,voz,total/);
  await server.close();
});
