/**
 * Simulador local: converse com o agente pelo terminal, em texto (WhatsApp) ou voz simulada.
 *   npm run simulate                 # usa Claude se ANTHROPIC_API_KEY existir; senão, o cérebro offline
 *   npm run simulate -- --offline    # força o cérebro offline
 *   npm run simulate -- --voz        # começa numa ligação
 */
process.env.STORE = "memory";
process.env.QUEUE_MODE = "memory";

const { createInterface } = await import("node:readline");
const { DateTime } = await import("luxon");
const { config } = await import("./config.js");
const { createHarness } = await import("./sim/harness.js");
const { handleHotmart } = await import("./integrations/hotmart.js");
const { computeMetrics } = await import("./metrics/metrics.js");
const { hasCallConsent } = await import("./compliance/rules.js");

const args = process.argv.slice(2);
const live = !args.includes("--offline") && Boolean(config.ANTHROPIC_API_KEY);
const h = createHarness({ live });
const phone = "5511988887777";
let lead = await h.store.upsertLeadByPhone({ phone, name: "João Teste", source: "simulador" });
let canal: "whatsapp" | "voz" = args.includes("--voz") ? "voz" : "whatsapp";
let session: Awaited<ReturnType<typeof h.startCall>>["session"] | null = null;

const c = { dim: "\x1b[2m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", reset: "\x1b[0m", bold: "\x1b[1m" };
let printed = 0;
let tasksPrinted = 0;
function flush() {
  for (const s of h.messenger.sent.slice(printed)) {
    const who = s.to === phone ? "WhatsApp → lead" : `WhatsApp → ${s.to}`;
    if (s.kind === "text") console.log(`${c.green}[${who}]${c.reset} ${s.text}`);
    if (s.kind === "buttons") console.log(`${c.green}[${who}]${c.reset} ${s.text}\n   ${c.dim}botões: ${s.buttons.map((b) => `[${b.title}](${b.id})`).join(" ")}${c.reset}`);
    if (s.kind === "list") console.log(`${c.green}[${who}]${c.reset} ${s.text}\n   ${c.dim}lista: ${s.rows.map((r) => `${r.title} (${r.id})`).join(" | ")}${c.reset}`);
    if (s.kind === "template") console.log(`${c.green}[${who} · template ${s.tpl.name}]${c.reset} ${s.rendered}`);
  }
  printed = h.messenger.sent.length;
}

function help() {
  console.log(`${c.dim}Comandos:
  /voz [motivo]          inicia ligação simulada (a IA fala primeiro)
  /whatsapp              volta para o WhatsApp (encerra a ligação)
  /botao <id>            toca um botão: quero_link | duvida | falar_equipe | slot:<ISO>
  /consentimento         marca consentimento de ligação (checkbox do quiz)
  /hotmart <EVENTO> <express|controle2>   ex.: /hotmart PURCHASE_OUT_OF_SHOPPING_CART controle2
  /tempo +30m|+2h|+1d    avança o relógio e roda as cadências
  /jobs                  cadências agendadas
  /lead                  estado do lead
  /painel                métricas do funil
  /reset                 novo lead
  /sair${c.reset}`);
}

async function startVoice(reason = "lead pediu informações") {
  canal = "voz";
  const r = await h.startCall(lead, reason);
  session = r.session;
  console.log(`${c.cyan}[ligação · IA]${c.reset} ${r.opener}`);
}

console.log(`${c.bold}Simulador do agente comercial · equipe Marlon Mattedi${c.reset}  (cérebro: ${h.app.engine.brain.name}${live ? ` · ${config.ANTHROPIC_MODEL}` : ""})`);
console.log(`${c.dim}Relógio simulado: ${DateTime.fromJSDate(h.clock.now).setZone(config.TZ_OPERACAO).toFormat("cccc dd/MM HH:mm", { locale: "pt-BR" })}. Digite /ajuda.${c.reset}`);
if (canal === "voz") await startVoice();

const rl = createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
const prompt = () => process.stdout.write(`${c.yellow}você (${canal})> ${c.reset}`);
const echo = !process.stdin.isTTY;
prompt();
for await (const raw of rl) {
  const line = raw.trim();
  if (echo) process.stdout.write(`${line}\n`);
  if (!line) {
    prompt();
    continue;
  }
  try {
    if (line === "/sair") break;
    if (line === "/ajuda") help();
    else if (line.startsWith("/voz")) await startVoice(line.slice(4).trim() || undefined);
    else if (line === "/whatsapp") {
      if (session) await h.endCall(session);
      session = null;
      canal = "whatsapp";
      console.log(`${c.dim}ligação encerrada; resumo salvo (transcrição descartada).${c.reset}`);
    } else if (line.startsWith("/botao ")) {
      const id = line.slice(7).trim();
      const titles: Record<string, string> = { quero_link: "Quero o link", duvida: "Tenho uma dúvida", falar_equipe: "Falar com a equipe" };
      await h.app.engine.handleWhatsApp({ from: phone, text: titles[id] ?? id.replace(/^slot:/, ""), replyId: id });
    } else if (line === "/consentimento") {
      lead = await h.store.updateLead(lead.id, { callConsent: { given: true, at: h.clock.now.toISOString(), origin: "quiz", text: "Aceito receber ligação da equipe do Marlon Mattedi" } });
      console.log(`${c.dim}consentimento de ligação registrado.${c.reset}`);
    } else if (line.startsWith("/hotmart ")) {
      const [, ev, prod] = line.split(/\s+/);
      const r = await handleHotmart(h.app.deps, {
        event: ev,
        data: { buyer: { name: lead.name, email: "joao@example.com", checkout_phone: phone }, product: { id: 0, name: prod === "express" ? "Controle Express" : "Treino CONTROLE 2.0" }, purchase: { transaction: `HP${Date.now()}`, price: { value: prod === "express" ? 47 : 397 }, origin: { sck: "f4-ia" } } },
      });
      console.log(`${c.dim}hotmart: ${JSON.stringify(r)}${c.reset}`);
    } else if (line.startsWith("/tempo ")) {
      const n = await h.advance(line.slice(7).trim());
      console.log(`${c.dim}relógio: ${DateTime.fromJSDate(h.clock.now).setZone(config.TZ_OPERACAO).toFormat("cccc dd/MM HH:mm", { locale: "pt-BR" })} · ${n} cadência(s) executada(s)${c.reset}`);
      if (h.dialer.dialed.length) console.log(`${c.dim}ligações discadas: ${JSON.stringify(h.dialer.dialed)}${c.reset}`);
    } else if (line === "/jobs") console.log(await h.scheduler.list());
    else if (line === "/lead") {
      lead = (await h.store.getLead(lead.id))!;
      console.log({ ...lead, consentimentoLigacao: hasCallConsent(lead) });
    } else if (line === "/painel") {
      const m = await computeMetrics(h.app.deps, new Date(h.clock.now.getTime() - 30 * 86400000), new Date(h.clock.now.getTime() + 86400000));
      console.dir(m, { depth: 4 });
    } else if (line === "/reset") {
      lead = await h.store.upsertLeadByPhone({ phone: `55119${Math.floor(Math.random() * 1e8)}`, name: "Novo Lead" });
      console.log(`${c.dim}novo lead ${lead.phone} (as mensagens continuam indo para ${phone} neste simulador).${c.reset}`);
    } else if (canal === "voz" && session) {
      const r = await h.app.engine.handleVoiceTurn(session, line);
      if (r.say) console.log(`${c.cyan}[ligação · IA]${c.reset} ${r.say}`);
      if (r.hangup) {
        console.log(`${c.dim}(a IA encerrou a ligação)${c.reset}`);
        await h.endCall(session);
        session = null;
        canal = "whatsapp";
      }
    } else {
      const r = await h.app.engine.handleWhatsApp({ from: phone, name: lead.name, text: line });
      if (r.guard) console.log(`${c.dim}(regra ativada: ${r.guard})${c.reset}`);
      if (r.violations.length) console.log(`${c.red}(resposta bloqueada: ${r.violations.join(", ")})${c.reset}`);
    }
    for (const t of h.store.tasks.slice(tasksPrinted)) console.log(`${c.red}[equipe] transferência: ${t.reason} (urgência ${t.urgency}) · IA pausada neste contato${c.reset}`);
    tasksPrinted = h.store.tasks.length;
    flush();
  } catch (e) {
    console.error(`${c.red}erro: ${(e as Error).message}${c.reset}`);
  }
  prompt();
}
rl.close();
process.exit(0);
