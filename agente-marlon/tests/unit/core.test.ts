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

test("v1.1: frases de risco novas", () => {
  for (const f of ["quero sumir", "queria sumir de tudo", "tô pensando em me matar", "não vale a pena viver", "não tenho motivo pra viver", "ninguém vai sentir minha falta"]) {
    assert.ok(detectCrisis(f), f);
  }
});

test("v1.1: segredos obrigatórios em produção", async () => {
  const { missingProdSecrets, config } = await import("../../src/config.js");
  const base = { ...config, WA_APP_SECRET: "a", WA_VERIFY_TOKEN: "b", HOTMART_HOTTOK: "c", LEAD_WEBHOOK_SECRET: "d" };
  assert.deepEqual(missingProdSecrets({ ...base, VOICE_PROVIDER: "none" }), []);
  assert.deepEqual(missingProdSecrets({ ...base, VOICE_PROVIDER: "vapi", VAPI_WEBHOOK_SECRET: "" }), ["VAPI_WEBHOOK_SECRET"]);
  assert.deepEqual(missingProdSecrets({ ...base, VOICE_PROVIDER: "retell", RETELL_LLM_SECRET: "", CRON_SECRET: "" }), ["RETELL_LLM_SECRET", "CRON_SECRET"]);
  assert.ok(missingProdSecrets({ ...base, HOTMART_HOTTOK: "" }).includes("HOTMART_HOTTOK"));
});

test("v1.2: só porcentagens da base científica passam", async () => {
  const rules = (t: string) => checkOutput(t, "whatsapp").map((v) => v.rule);
  assert.deepEqual(rules("Estima-se que afete 20% a 30% dos homens."), []);
  assert.deepEqual(rules("Num levantamento no Brasil, 30,3% relataram."), []);
  assert.deepEqual(rules("Num estudo, 82,5% ganharam controle; em outro, 54%."), []);
  assert.ok(rules("Cerca de 45% dos homens têm isso.").includes("numero nao autorizado"));
  assert.ok(rules("Mais de 90% melhoram.").includes("numero nao autorizado"));
});

test("v1.2: nenhum resultado ou prazo atribuído ao produto", () => {
  const rules = (t: string) => checkOutput(t, "whatsapp").map((v) => v.rule);
  assert.ok(rules("O CONTROLE 2.0 tem 82,5% de sucesso.").includes("resultado atribuido ao produto"));
  assert.ok(rules("O treino garante que você melhora.").includes("promessa de resultado"));
  assert.ok(rules("Em 3 semanas você vai estar melhor.").includes("prazo atribuido ao produto"));
  // Citar o estudo, sem atribuir ao produto, é permitido
  assert.deepEqual(rules("Um estudo de 2014 com treino de 12 semanas mostrou que 82,5% ganharam controle. Os resultados variam."), []);
  assert.deepEqual(rules("Ninguém garante resultado, porque cada pessoa responde de um jeito."), []);
});

test("v1.2: mensagens curtas e espera de digitação", async () => {
  const { splitParts, typingDelayMs } = await import("../../src/agent/outbound.js");
  assert.deepEqual(splitParts("Oi! ||| Tudo bem? ||| Me conta."), ["Oi!", "Tudo bem?", "Me conta."]);
  assert.deepEqual(splitParts("a|||b|||c|||d"), ["a", "b", "c d"]);
  assert.deepEqual(splitParts("só uma"), ["só uma"]);
  assert.equal(typingDelayMs("oi"), 1200);
  assert.equal(typingDelayMs("x".repeat(50)), 2000);
  assert.equal(typingDelayMs("x".repeat(500)), 4000);
});

test("v1.7: pergunta se é o Marlon / o doutor", async () => {
  const { detectMarlonQuestion, detectEntryOrigin } = await import("../../src/agent/guardrails.js");
  for (const f of ["É com o Dr. Marlon mesmo que estou falando?", "é o marlon?", "Falo com o doutor?", "é com o senhor mesmo?", "Quem está me respondendo?"]) assert.ok(detectMarlonQuestion(f), f);
  for (const f of ["Bom dia dr", "vi os vídeos do Marlon", "o Marlon atende online?"]) assert.ok(!detectMarlonQuestion(f), f);
  assert.equal(detectEntryOrigin("Olá, estou na página do Treino do LEÃO e preciso de ajuda."), "pagina_leao");
  assert.equal(detectEntryOrigin("Olá, gostaria de falar com o suporte do Treino CONTROLE 2.0."), "suporte_controle2");
  assert.equal(detectEntryOrigin("Olá, encontrei seu contato no site sexosemduvida.com e gostaria saber mais sobre as consultas online."), "consulta_site");
  assert.equal(detectEntryOrigin("Oi, quanto custa?"), null);
});

test("v1.9: qual parte vira áudio", async () => {
  const { escolherAudio } = await import("../../src/agent/outbound.js");
  const base = { modo: "auto" as const, leadMandouAudio: false, temVoz: true, parteComIntro: null };
  // Marcada pela IA → vira áudio, e a marca some
  let r = escolherAudio(["[[audio]]Poxa, imagino que isso pese.", "Isso sempre foi assim?"], base);
  assert.equal(r.audioIndex, 0);
  assert.deepEqual(r.parts, ["Poxa, imagino que isso pese.", "Isso sempre foi assim?"]);
  // Link nunca vira áudio
  r = escolherAudio(["[[audio]]Segue: https://pay.hotmart.com/x?sck=f4-ia"], base);
  assert.equal(r.audioIndex, -1);
  // Sem voz configurada → tudo texto
  r = escolherAudio(["[[audio]]Oi"], { ...base, temVoz: false });
  assert.equal(r.audioIndex, -1);
  assert.deepEqual(r.parts, ["Oi"]);
  // Modo off → nunca
  assert.equal(escolherAudio(["[[audio]]Oi"], { ...base, modo: "off" }).audioIndex, -1);
  // Lead mandou áudio → espelha na parte principal (sem link)
  r = escolherAudio(["Curta.", "Uma resposta bem mais longa e acolhedora.", "Link: https://x.com"], { ...base, leadMandouAudio: true });
  assert.equal(r.audioIndex, 1);
  // Modo espelhar ignora a marca se o lead não mandou áudio
  assert.equal(escolherAudio(["[[audio]]Oi"], { ...base, modo: "espelhar" }).audioIndex, -1);
  // A parte com a apresentação obrigatória não vira áudio
  assert.equal(escolherAudio(["[[audio]]Oi! Aqui é a Clara, assistente virtual."], { ...base, parteComIntro: 0 }).audioIndex, -1);
});

test("v1.9: texto ajustado para fala", async () => {
  const { textoParaFala } = await import("../../src/integrations/tts.js");
  assert.equal(textoParaFala("[[audio]]São 12x de R$33,08 ou R$397 😊"), "São 12 vezes de 33 reais e 8 centavos ou 397 reais");
  assert.equal(textoParaFala("O CONTROLE 2.0|||veja https://x.com"), "O Controle dois ponto zero veja");
});
