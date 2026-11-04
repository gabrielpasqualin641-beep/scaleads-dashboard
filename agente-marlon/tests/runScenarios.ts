/**
 * Suíte de cenários (tests/scenarios/*.yaml).
 *   npm run test:scenarios          → cérebro offline (determinístico, roda em CI)
 *   npm run test:scenarios:live     → Claude de verdade (precisa de ANTHROPIC_API_KEY)
 *   ... -- --only preco             → filtra por nome de arquivo
 *   ... -- --report docs/prints     → grava o relatório em texto e HTML
 *
 * Critérios globais aplicados a TODO cenário (seção 5): links com sck=f4-ia, identificação como assistente virtual,
 * nenhuma resposta com promessa/remédio/urgência falsa, templates neutros, nada enviado depois do opt-out,
 * nada fora da janela 9h-20h (seg-sáb), ligação só com consentimento e oferta só por 0303.
 */
process.env.STORE = "memory";
process.env.QUEUE_MODE = "memory";
process.env.NODE_ENV = "test";

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DateTime } from "luxon";
import YAML from "yaml";
import { checkOutput, isNeutral, mentionsVirtualAssistant, norm } from "../src/agent/guardrails.js";
import { extractUrls, hasRequiredTracking, isCheckoutUrl } from "../src/agent/links.js";
import { hasCallConsent, isWithinContactWindow } from "../src/compliance/rules.js";
import type { SentRecord } from "../src/channels/messenger.js";
import type { Lead } from "../src/domain/types.js";
import { handleHotmart } from "../src/integrations/hotmart.js";
import { captureLead } from "../src/integrations/leads.js";
import { createHarness, type Harness } from "../src/sim/harness.js";
import type { VoiceSession } from "../src/agent/engine.js";
import { config } from "../src/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const live = args.includes("--live");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const reportDir = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;

if (live && !config.ANTHROPIC_API_KEY) {
  console.error("--live precisa de ANTHROPIC_API_KEY");
  process.exit(2);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Expect {
  deve?: string[];
  nao_deve?: string[];
  deve_offline?: string[];
  tools?: string[];
  sem_tools?: string[];
  guard?: string;
  encerra?: boolean;
  neutra?: boolean;
  sem_resposta?: boolean;
  envios?: { templates?: string[]; nenhum?: boolean; minimo?: number };
  lead?: Partial<Record<keyof Lead, unknown>>;
  tarefa?: { urgencia?: string; motivo?: string };
  discou?: number;
  jobs?: string[];
  sem_jobs?: string[];
  consentimento_ligacao?: boolean;
}

interface Step {
  lead?: string; // mensagem do lead no WhatsApp
  voz?: string; // fala do lead na ligação
  ligacao?: { motivo?: string; direcao?: "inbound" | "outbound" };
  fim_ligacao?: boolean;
  botao?: string;
  hotmart?: { evento: string; produto: "express" | "controle2"; transacao?: string };
  captura?: Record<string, unknown>;
  tempo?: string;
  assumir?: boolean;
  atualizar_lead?: Record<string, unknown>;
  espera?: Expect;
}

interface Scenario {
  nome: string;
  descricao?: string;
  relogio?: string; // ISO, para cenários de horário
  sem_0303?: boolean;
  lead?: { nome?: string; consentimento_ligacao?: boolean; compras?: string[]; ja_conversou?: boolean };
  passos: Step[];
}

const PHONE = "5511977776666";
const lines: string[] = [];
const log = (s = "") => {
  lines.push(s);
  console.log(s);
};
const color = (code: number, s: string) => (reportDir ? s : `\x1b[${code}m${s}\x1b[0m`);

function sentText(s: SentRecord) {
  return s.kind === "template" ? s.rendered : s.text;
}

async function runScenario(file: string, sc: Scenario) {
  const h: Harness = createHarness({ live, start: sc.relogio, has0303: !sc.sem_0303 });
  let lead = await h.store.upsertLeadByPhone({
    phone: PHONE,
    name: sc.lead?.nome ?? "João Teste",
    source: "teste",
    purchases: (sc.lead?.compras ?? []) as Lead["purchases"],
    callConsent: sc.lead?.consentimento_ligacao ? { given: true, at: h.clock.now.toISOString(), origin: "quiz", text: "Aceito receber ligação da equipe do Marlon Mattedi" } : null,
  });
  let session: VoiceSession | null = null;
  const failures: string[] = [];
  const transcript: string[] = [];
  let optoutAt: { whatsapp?: number; voz?: number } = {};
  let lastInboundIdx = -1;

  for (const [i, step] of sc.passos.entries()) {
    const sentBefore = h.messenger.sent.length;
    const dialBefore = h.dialer.dialed.length;
    let reply = "";
    let result: any = null;
    const tag = `passo ${i + 1}`;

    if (step.captura) {
      await captureLead(h.app.deps, { nome: lead.name ?? "João", telefone: PHONE.slice(2), origem: "quiz", maior_de_18: true, aceita_whatsapp: true, aceita_ligacao: false, quer_ligacao_agora: false, ...step.captura } as any);
      transcript.push(`  [captura de lead] ${JSON.stringify(step.captura)}`);
    }
    if (step.atualizar_lead) lead = await h.store.updateLead(lead.id, step.atualizar_lead as Partial<Lead>);
    if (step.assumir) {
      lead = await h.store.updateLead(lead.id, { aiPaused: true, pausedBy: "humano@equipe" });
      transcript.push("  [painel] humano assumiu a conversa");
    }
    if (step.hotmart) {
      const r = await handleHotmart(h.app.deps, {
        event: step.hotmart.evento,
        data: {
          buyer: { name: lead.name, email: "joao@example.com", checkout_phone: PHONE },
          product: { id: 0, name: step.hotmart.produto === "express" ? "Controle Express" : "Treino CONTROLE 2.0" },
          purchase: { transaction: step.hotmart.transacao ?? "HP0001", price: { value: step.hotmart.produto === "express" ? 47 : 397 }, origin: { sck: "f4-ia" } },
        },
      });
      transcript.push(`  [hotmart] ${step.hotmart.evento} ${step.hotmart.produto} → ${r.handled ? "ok" : r.reason}`);
    }
    if (step.tempo) {
      const n = await h.advance(step.tempo);
      transcript.push(`  [relógio ${step.tempo}] ${DateTime.fromJSDate(h.clock.now).setZone(config.TZ_OPERACAO).toFormat("ccc dd/MM HH:mm", { locale: "pt-BR" })} · ${n} cadência(s)`);
    }
    if (step.botao) {
      lastInboundIdx = h.messenger.sent.length;
      transcript.push(`  lead [botão] ${step.botao}`);
      result = await h.app.engine.handleWhatsApp({ from: PHONE, text: step.botao, replyId: step.botao });
    }
    if (step.lead !== undefined) {
      lastInboundIdx = h.messenger.sent.length;
      transcript.push(`  lead › ${step.lead}`);
      result = await h.app.engine.handleWhatsApp({ from: PHONE, name: lead.name, text: step.lead });
    }
    if (step.ligacao) {
      const r = await h.startCall((await h.store.getLead(lead.id))!, step.ligacao.motivo, step.ligacao.direcao);
      session = r.session;
      reply = r.opener;
      transcript.push(`  ☎ IA › ${r.opener}`);
    }
    if (step.voz !== undefined) {
      if (!session) throw new Error(`${tag}: 'voz' sem ligação ativa`);
      transcript.push(`  ☎ lead › ${step.voz}`);
      const r = await h.app.engine.handleVoiceTurn(session, step.voz);
      reply = r.say;
      result = { state: r.state, guard: r.guard, hangup: r.hangup, text: r.say };
      transcript.push(`  ☎ IA › ${r.say}${r.hangup ? "  [desliga]" : ""}`);
      if (r.hangup) {
        await h.endCall(session);
        session = null;
      }
    }
    if (step.fim_ligacao && session) {
      await h.endCall(session);
      session = null;
    }

    const newSends = h.messenger.sent.slice(sentBefore);
    for (const s of newSends) transcript.push(`  ${s.to === PHONE ? "IA" : `→ ${s.to}`} [${s.kind === "template" ? `template ${s.tpl.name}` : s.kind}] › ${sentText(s)}`);
    if (step.lead !== undefined || step.botao) reply = newSends.filter((s) => s.to === PHONE).map(sentText).join("\n");

    lead = (await h.store.getLead(lead.id))!;
    if (lead.optOutWhatsapp && optoutAt.whatsapp === undefined) optoutAt.whatsapp = h.messenger.sent.length;
    if (lead.optOutVoz && optoutAt.voz === undefined) optoutAt.voz = h.dialer.dialed.length;

    const e = step.espera;
    if (!e) continue;
    const t = `${norm(reply)}\n${reply.toLowerCase()}`;
    const fail = (msg: string) => failures.push(`${tag}: ${msg}`);
    const toolNames: string[] = (result?.state?.toolLog ?? []).map((x: any) => x.name);

    for (const re of e.deve ?? []) if (!new RegExp(re, "i").test(t)) fail(`resposta deveria conter /${re}/ → "${reply.slice(0, 160)}"`);
    if (!live) for (const re of e.deve_offline ?? []) if (!new RegExp(re, "i").test(t)) fail(`(offline) resposta deveria conter /${re}/`);
    for (const re of e.nao_deve ?? []) if (new RegExp(re, "i").test(t)) fail(`resposta NÃO deveria conter /${re}/ → "${reply.slice(0, 160)}"`);
    for (const tool of e.tools ?? []) if (!toolNames.includes(tool)) fail(`deveria chamar a tool ${tool} (chamou: ${toolNames.join(", ") || "nenhuma"})`);
    for (const tool of e.sem_tools ?? []) if (toolNames.includes(tool)) fail(`não deveria chamar a tool ${tool}`);
    if (e.guard && result?.guard !== e.guard) fail(`regra esperada "${e.guard}", veio "${result?.guard ?? "nenhuma"}"`);
    if (e.encerra !== undefined && Boolean(result?.hangup) !== e.encerra) fail(`encerra=${e.encerra} esperado`);
    if (e.neutra && !isNeutral(reply)) fail(`resposta deveria ser neutra (sem citar o assunto): "${reply}"`);
    if (e.sem_resposta && reply.trim()) fail(`não deveria responder, respondeu: "${reply}"`);
    if (e.envios?.nenhum && newSends.some((s) => s.to === PHONE)) fail(`nenhum envio esperado, houve ${newSends.length}`);
    for (const name of e.envios?.templates ?? []) if (!newSends.some((s) => s.kind === "template" && s.tpl.name === name)) fail(`template ${name} deveria ter sido enviado`);
    if (e.envios?.minimo !== undefined && newSends.length < e.envios.minimo) fail(`esperava ao menos ${e.envios.minimo} envio(s)`);
    for (const [k, v] of Object.entries(e.lead ?? {})) if (JSON.stringify((lead as any)[k]) !== JSON.stringify(v)) fail(`lead.${k} = ${JSON.stringify((lead as any)[k])}, esperado ${JSON.stringify(v)}`);
    if (e.tarefa) {
      const task = h.store.tasks[h.store.tasks.length - 1];
      if (!task) fail("deveria haver transferência para humano");
      else {
        if (e.tarefa.urgencia && task.urgency !== e.tarefa.urgencia) fail(`urgência ${task.urgency}, esperado ${e.tarefa.urgencia}`);
        if (e.tarefa.motivo && !new RegExp(e.tarefa.motivo, "i").test(norm(task.reason))) fail(`motivo "${task.reason}" não bate com /${e.tarefa.motivo}/`);
      }
    }
    if (e.discou !== undefined && h.dialer.dialed.length - dialBefore !== e.discou) fail(`ligações discadas: ${h.dialer.dialed.length - dialBefore}, esperado ${e.discou}`);
    const jobs = await h.scheduler.list(lead.id);
    for (const j of e.jobs ?? []) if (!jobs.some((x) => x.type === j)) fail(`job ${j} deveria estar agendado`);
    for (const j of e.sem_jobs ?? []) if (jobs.some((x) => x.type === j)) fail(`job ${j} não deveria estar agendado`);
    if (e.consentimento_ligacao !== undefined && hasCallConsent(lead) !== e.consentimento_ligacao) fail(`consentimento de ligação = ${hasCallConsent(lead)}`);
  }

  // ---------------- Critérios globais (seção 5)
  const toLead = h.messenger.sent.filter((s) => s.to === PHONE);
  for (const s of h.messenger.sent) {
    const txt = sentText(s);
    for (const url of extractUrls(txt)) if (isCheckoutUrl(url) || /pagamento|pay\./.test(url)) if (!hasRequiredTracking(url)) failures.push(`GLOBAL: link sem sck=f4-ia: ${url}`);
    const v = checkOutput(txt, "whatsapp").filter((x) => x.rule !== "link sem sck=f4-ia");
    if (v.length) failures.push(`GLOBAL: mensagem viola regra (${v.map((x) => x.rule).join(", ")}): "${txt.slice(0, 120)}"`);
    if (s.kind === "template" && !isNeutral(s.rendered)) failures.push(`GLOBAL: template não neutro: ${s.rendered}`);
    if (s.kind === "template" && s.at && !isWithinContactWindow(new Date(s.at)) && s.to === PHONE) failures.push(`GLOBAL: contato ativo fora da janela 9h-20h/domingo: ${s.at}`);
  }
  const firstAi = toLead.find((s) => s.kind !== "template" || !["lembrete_horario", "link_solicitado"].includes(s.tpl.name));
  if (firstAi && !mentionsVirtualAssistant(sentText(firstAi)) && !sc.lead?.ja_conversou) failures.push(`GLOBAL: primeira mensagem não se identifica como assistente virtual: "${sentText(firstAi).slice(0, 100)}"`);
  if (optoutAt.whatsapp !== undefined) {
    const after = h.messenger.sent.slice(optoutAt.whatsapp).filter((s) => s.to === PHONE && s.kind === "template");
    if (after.length) failures.push(`GLOBAL: ${after.length} contato(s) ativo(s) depois do opt-out de WhatsApp`);
  }
  if (optoutAt.voz !== undefined && h.dialer.dialed.length > optoutAt.voz) failures.push("GLOBAL: ligação depois do opt-out de voz");
  for (const d of h.dialer.dialed) {
    const l = (await h.store.getLead(d.leadId))!;
    if (!hasCallConsent(l)) failures.push("GLOBAL: ligação sem consentimento explícito");
    if (d.purpose === "oferta" && !d.from.startsWith("0303")) failures.push("GLOBAL: ligação de oferta sem 0303");
  }
  void lastInboundIdx;

  const ok = failures.length === 0;
  log(`${ok ? color(32, "✔ PASSOU") : color(31, "✘ FALHOU")}  ${sc.nome}  ${color(2, `(${file})`)}`);
  for (const l of transcript) log(color(2, l));
  for (const f of failures) log(color(31, `    ✘ ${f}`));
  log();
  return ok;
}

const dir = path.join(here, "scenarios");
const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") && (!only || f.includes(only))).sort();
log(`Cenários do agente comercial · cérebro: ${live ? `Claude (${config.ANTHROPIC_MODEL})` : "offline"} · ${files.length} cenário(s)`);
log("=".repeat(80));
let passed = 0;
for (const f of files) {
  const sc = YAML.parse(readFileSync(path.join(dir, f), "utf8")) as Scenario;
  try {
    if (await runScenario(f, sc)) passed++;
  } catch (e) {
    log(color(31, `✘ ERRO  ${sc.nome} (${f}): ${(e as Error).stack}`));
  }
}
log("=".repeat(80));
log(`${passed}/${files.length} cenários passaram${passed === files.length ? " · nenhuma regra da seção 5 violada · todos os links com sck=f4-ia" : ""}`);

if (reportDir) {
  mkdirSync(reportDir, { recursive: true });
  const stamp = live ? "live" : "offline";
  writeFileSync(path.join(reportDir, `cenarios-${stamp}.txt`), lines.join("\n") + "\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<!doctype html><meta charset="utf-8"><title>Cenários do agente</title><style>body{background:#0f1115;color:#d6d8dd;font:13px/1.5 ui-monospace,Menlo,monospace;padding:24px;margin:0}pre{white-space:pre-wrap;margin:0}.ok{color:#4ade80}.no{color:#f87171}.dim{color:#8b8f98}</style><pre>${lines
    .map((l) => {
      const e = esc(l);
      if (l.startsWith("✔")) return `<span class="ok">${e}</span>`;
      if (l.includes("✘")) return `<span class="no">${e}</span>`;
      if (l.startsWith("  ")) return `<span class="dim">${e}</span>`;
      return e;
    })
    .join("\n")}</pre>`;
  writeFileSync(path.join(reportDir, `cenarios-${stamp}.html`), html);
}
process.exit(passed === files.length ? 0 : 1);
