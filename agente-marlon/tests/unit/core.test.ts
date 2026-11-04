import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { checkOutput, detectCrisis, detectMinor, detectOptout, detectRefund, detectRobotQuestion, isNeutral } from "../../src/agent/guardrails.js";
import { loadProducts } from "../../src/agent/knowledge.js";
import { buildCheckoutUrl, hasRequiredTracking } from "../../src/agent/links.js";
import { renderTemplate, verifyMetaSignature, loadTemplates } from "../../src/channels/whatsapp.js";
import { isWithinContactWindow, nextContactWindow } from "../../src/compliance/rules.js";
import { normalizePhone } from "../../src/integrations/hotmart.js";
import { pickCallerId } from "../../src/voice/sessions.js";

test("produtos.md é a fonte única: preços e checkouts", () => {
  const p = loadProducts();
  assert.equal(p.controle_express.checkoutBase, "https://pay.hotmart.com/T107019512C?off=pvd2dwrj");
  assert.equal(p.controle_2.checkoutBase, "https://pay.hotmart.com/F10074400O?off=kpcg923o&checkoutMode=10");
  assert.match(p.controle_2.priceText, /12x de R\$33,08/);
  assert.match(p.consulta.priceText, /R\$900/);
});

test("todo link de checkout leva sck=f4-ia e UTMs do canal", () => {
  for (const prod of ["controle_express", "controle_2"] as const) {
    for (const ch of ["whatsapp", "voz"] as const) {
      const u = new URL(buildCheckoutUrl(prod, ch));
      assert.equal(u.searchParams.get("sck"), "f4-ia");
      assert.equal(u.searchParams.get("utm_source"), "agente");
      assert.equal(u.searchParams.get("utm_medium"), ch);
      assert.ok(u.searchParams.get("off"), "mantém o parâmetro off original");
      assert.ok(hasRequiredTracking(u.toString()));
    }
  }
  assert.equal(new URL(buildCheckoutUrl("controle_2", "whatsapp")).searchParams.get("checkoutMode"), "10");
});

test("opt-out: para, sai, não quero, não me liga mais", () => {
  assert.equal(detectOptout("Para", "whatsapp"), "todos");
  assert.equal(detectOptout("sai", "whatsapp"), "todos");
  assert.equal(detectOptout("Não quero", "whatsapp"), "todos");
  assert.equal(detectOptout("não quero mais receber mensagem", "whatsapp"), "todos");
  assert.equal(detectOptout("Não me liga mais", "whatsapp"), "voz");
  assert.equal(detectOptout("para de me ligar", "voz"), "voz");
  assert.equal(detectOptout("me tira da lista", "whatsapp"), "todos");
  // Não confunde com conversa normal
  assert.equal(detectOptout("para que serve o treino?", "whatsapp"), null);
  assert.equal(detectOptout("não quero o express, quero o 2.0", "whatsapp"), null);
  assert.equal(detectOptout("não quero gastar muito", "whatsapp"), null);
});

test("risco, menor de idade, reembolso e 'é robô?'", () => {
  assert.ok(detectCrisis("às vezes penso em me matar"));
  assert.ok(detectCrisis("não aguento mais viver assim"));
  assert.ok(!detectCrisis("termino rápido e isso me mata de vergonha"));
  assert.ok(detectMinor("tenho 17 anos"));
  assert.ok(detectMinor("sou menor de idade"));
  assert.ok(!detectMinor("tenho 35 anos"));
  assert.ok(!detectMinor("isso acontece há 3 anos"));
  assert.ok(detectRefund("quero o reembolso"));
  assert.ok(detectRefund("quero meu dinheiro de volta"));
  assert.ok(detectRobotQuestion("você é um robô?"));
  assert.ok(detectRobotQuestion("é robô?"));
  assert.ok(!detectRobotQuestion("quero saber do treino"));
});

test("filtro de saída bloqueia promessas, remédios, urgência falsa e links sem rastreio", () => {
  assert.ok(checkOutput("Com o treino você vai ter a cura definitiva", "whatsapp").some((v) => v.rule === "promessa de cura"));
  assert.ok(checkOutput("Eu garanto que funciona", "whatsapp").length);
  assert.ok(checkOutput("Tome sildenafila 50mg", "whatsapp").some((v) => v.rule === "medicamento"));
  assert.ok(checkOutput("Últimas vagas, só hoje!", "whatsapp").some((v) => v.rule === "urgencia falsa"));
  assert.ok(checkOutput("Link: https://pay.hotmart.com/T107019512C?off=pvd2dwrj", "whatsapp").some((v) => v.rule === "link sem sck=f4-ia"));
  assert.ok(checkOutput("Te mando https://pay.hotmart.com/x", "voz").some((v) => v.rule === "link falado na ligacao"));
  // Permitidos
  assert.deepEqual(checkOutput("Os resultados variam de pessoa para pessoa e há garantia de 7 dias.", "whatsapp"), []);
  assert.deepEqual(checkOutput("Sobre remédios eu não falo, porque isso é com um médico.", "whatsapp"), []);
  assert.deepEqual(checkOutput("Não dá pra prometer cura, mas dá pra treinar.", "whatsapp"), []);
});

test("templates fora da janela de 24h são neutros", () => {
  for (const t of loadTemplates()) {
    const rendered = renderTemplate({ name: t.name, params: t.example });
    if (t.name === "alerta_equipe" || t.name === "resumo_diario") continue; // internos
    assert.ok(isNeutral(rendered), `template ${t.name} cita o assunto: ${rendered}`);
  }
});

test("janela de contato: 9h-20h, seg-sáb (Brasília)", () => {
  assert.ok(isWithinContactWindow(new Date("2026-11-10T10:00:00-03:00"))); // terça
  assert.ok(!isWithinContactWindow(new Date("2026-11-10T20:00:00-03:00")));
  assert.ok(!isWithinContactWindow(new Date("2026-11-10T08:59:00-03:00")));
  assert.ok(!isWithinContactWindow(new Date("2026-11-08T11:00:00-03:00"))); // domingo
  assert.equal(nextContactWindow(new Date("2026-11-10T22:00:00-03:00")).toISOString(), new Date("2026-11-11T09:00:00-03:00").toISOString());
  assert.equal(nextContactWindow(new Date("2026-11-07T21:00:00-03:00")).toISOString(), new Date("2026-11-09T09:00:00-03:00").toISOString()); // sáb → seg
});

test("assinatura do webhook da Meta (X-Hub-Signature-256)", () => {
  const body = Buffer.from('{"a":1}');
  const sig = `sha256=${createHmac("sha256", "segredo").update(body).digest("hex")}`;
  assert.ok(verifyMetaSignature(body, sig, "segredo"));
  assert.ok(!verifyMetaSignature(body, sig, "outro"));
  assert.ok(!verifyMetaSignature(body, undefined, "segredo"));
});

test("ligação de oferta exige número 0303", () => {
  assert.throws(() => pickCallerId("oferta", "+5511400000000", ""), /0303/);
  assert.equal(pickCallerId("oferta", "+5511400000000", "03031234567"), "03031234567");
  assert.equal(pickCallerId("servico", "+5511400000000", ""), "+5511400000000");
});

test("telefone normalizado para E.164 brasileiro", () => {
  assert.equal(normalizePhone("(11) 99999-0001"), "5511999990001");
  assert.equal(normalizePhone("+55 11 99999-0001"), "5511999990001");
  assert.equal(normalizePhone("123"), null);
});
