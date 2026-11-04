import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import { config } from "../config.js";
import type { Channel, EventType } from "../domain/types.js";
import type { Deps } from "../deps.js";
import { SCK } from "../agent/links.js";

export interface Metrics {
  periodo: { de: string; ate: string };
  funil: Record<Channel | "total", Record<string, number>>;
  objecoes: Array<{ tipo: string; total: number }>;
  taxaTransferencia: number;
  transferencias: number;
  ligacoes: { total: number; atendidas: number; tempoMedioSeg: number };
  optouts: number;
  receitaAtribuida: number;
  vendasAtribuidas: number;
}

const FUNIL_STEPS: Array<[string, EventType]> = [
  ["contatos", "contato"],
  ["conversas", "conversa"],
  ["recomendacao", "recomendacao"],
  ["link_enviado", "link_enviado"],
  ["compra", "compra"],
  ["consulta_agendada", "consulta_agendada"],
  ["comparecimento", "comparecimento"],
];

export async function computeMetrics(deps: Deps, from: Date, to: Date): Promise<Metrics> {
  const since = from.toISOString();
  const until = to.toISOString();
  const events = await deps.store.listEvents({ since, until });
  const funil = { whatsapp: {}, voz: {}, total: {} } as Metrics["funil"];
  for (const [label, type] of FUNIL_STEPS) {
    const ev = events.filter((e) => e.type === type);
    // Conta leads únicos por etapa
    const uniq = (list: typeof ev) => new Set(list.map((e) => e.leadId)).size;
    funil.total[label] = uniq(ev);
    funil.whatsapp[label] = uniq(ev.filter((e) => e.channel === "whatsapp" || (e.channel === null && type === "compra")));
    funil.voz[label] = uniq(ev.filter((e) => e.channel === "voz"));
  }
  const obj = new Map<string, number>();
  for (const e of events.filter((x) => x.type === "objecao")) obj.set(String(e.data.tipo), (obj.get(String(e.data.tipo)) ?? 0) + 1);
  const transferencias = new Set(events.filter((e) => e.type === "transferencia").map((e) => e.leadId)).size;
  const conversas = funil.total.conversas || 0;
  const calls = (await deps.store.listCalls({ limit: 5000 })).filter((c) => c.createdAt >= since && c.createdAt < until);
  const atendidas = calls.filter((c) => c.durationSec && c.status !== "outra_pessoa" && c.status !== "nao_atendida");
  const purchases = (await deps.store.listPurchases({ since })).filter((p) => p.createdAt < until && p.status === "aprovada" && p.sck === SCK);
  return {
    periodo: { de: since, ate: until },
    funil,
    objecoes: [...obj.entries()].map(([tipo, total]) => ({ tipo, total })).sort((a, b) => b.total - a.total),
    taxaTransferencia: conversas ? transferencias / conversas : 0,
    transferencias,
    ligacoes: {
      total: calls.length,
      atendidas: atendidas.length,
      tempoMedioSeg: atendidas.length ? Math.round(atendidas.reduce((s, c) => s + (c.durationSec ?? 0), 0) / atendidas.length) : 0,
    },
    optouts: events.filter((e) => e.type === "optout").length,
    receitaAtribuida: purchases.reduce((s, p) => s + p.value, 0),
    vendasAtribuidas: purchases.length,
  };
}

export function metricsToCsv(m: Metrics): string {
  const rows: string[][] = [["secao", "chave", "whatsapp", "voz", "total"]];
  for (const k of Object.keys(m.funil.total)) rows.push(["funil", k, String(m.funil.whatsapp[k] ?? 0), String(m.funil.voz[k] ?? 0), String(m.funil.total[k])]);
  for (const o of m.objecoes) rows.push(["objecao", o.tipo, "", "", String(o.total)]);
  rows.push(["geral", "taxa_transferencia", "", "", m.taxaTransferencia.toFixed(3)]);
  rows.push(["geral", "ligacoes_total", "", "", String(m.ligacoes.total)]);
  rows.push(["geral", "ligacoes_atendidas", "", "", String(m.ligacoes.atendidas)]);
  rows.push(["geral", "ligacoes_tempo_medio_seg", "", "", String(m.ligacoes.tempoMedioSeg)]);
  rows.push(["geral", "optouts", "", "", String(m.optouts)]);
  rows.push(["geral", "vendas_atribuidas", "", "", String(m.vendasAtribuidas)]);
  rows.push(["geral", "receita_atribuida", "", "", m.receitaAtribuida.toFixed(2)]);
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n";
}

function dayRange(deps: Deps, offsetDays = -1) {
  const d = DateTime.fromJSDate(deps.now()).setZone(config.TZ_OPERACAO).plus({ days: offsetDays }).startOf("day");
  return { from: d.toJSDate(), to: d.plus({ days: 1 }).toJSDate(), label: d.toFormat("dd/MM"), file: d.toFormat("yyyy-MM-dd") };
}

/** CSV diário do dia anterior em ./exports (sem dados pessoais: só agregados). */
export async function exportDailyCsv(deps: Deps) {
  const r = dayRange(deps);
  const m = await computeMetrics(deps, r.from, r.to);
  const dir = path.resolve("exports");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `metricas-${r.file}.csv`);
  writeFileSync(file, metricsToCsv(m));
  return file;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Resumo do dia anterior no WhatsApp do Marlon às 8h. */
export async function dailySummary(deps: Deps) {
  if (!config.WA_MARLON_NUMBER) return;
  const r = dayRange(deps);
  const m = await computeMetrics(deps, r.from, r.to);
  await deps.messenger.sendTemplate(config.WA_MARLON_NUMBER, {
    name: "resumo_diario",
    params: [
      r.label,
      String(m.funil.total.conversas ?? 0),
      String(m.funil.total.link_enviado ?? 0),
      String(m.vendasAtribuidas),
      brl(m.receitaAtribuida),
      String(m.funil.total.consulta_agendada ?? 0),
      String(m.transferencias),
      String(m.optouts),
    ],
  });
}
