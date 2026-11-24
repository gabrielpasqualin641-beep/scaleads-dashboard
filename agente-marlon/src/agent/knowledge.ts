import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProductCode } from "../domain/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const AGENT_DIR = path.resolve(here, "../../agent");

export interface ProductInfo {
  code: ProductCode;
  name: string;
  priceText: string;
  checkoutBase: string | null;
}

let cachedKnowledge: string | null = null;

/** Concatena todos os arquivos de agent/knowledge/*.md (ordem alfabética, estável para cache de prompt). */
export function loadKnowledge(): string {
  if (cachedKnowledge) return cachedKnowledge;
  const dir = path.join(AGENT_DIR, "knowledge");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  cachedKnowledge = files.map((f) => `<!-- ${f} -->\n${readFileSync(path.join(dir, f), "utf8").trim()}`).join("\n\n");
  return cachedKnowledge;
}

/** Lê produtos.md (fonte única de verdade) e extrai código, nome, preço e checkout de cada produto. */
export function loadProducts(): Record<ProductCode, ProductInfo> {
  const md = readFileSync(path.join(AGENT_DIR, "knowledge", "produtos.md"), "utf8");
  const sections = md.split(/^## /m).slice(1);
  const out: Partial<Record<ProductCode, ProductInfo>> = {};
  for (const s of sections) {
    const name = s.split("\n")[0].trim();
    const code = s.match(/\*\*Código interno:\*\*\s*`([a-z0-9_]+)`/)?.[1] as ProductCode | undefined;
    if (!code) continue;
    const priceText = s.match(/\*\*Preço:\*\*\s*(.+)/)?.[1].trim() ?? "";
    const checkoutBase = s.match(/\*\*Checkout:\*\*\s*(https:\/\/\S+)/)?.[1] ?? null;
    out[code] = { code, name, priceText, checkoutBase };
  }
  for (const c of ["controle_express", "controle_2", "consulta"] as ProductCode[]) {
    if (!out[c]) throw new Error(`produtos.md não define o produto ${c}`);
  }
  return out as Record<ProductCode, ProductInfo>;
}

export function loadSystemPrompt(agentName: string, genero: "masculino" | "feminino" = "masculino"): string {
  const m = genero === "masculino";
  const tokens: Record<string, string> = {
    AGENT_NAME: agentName,
    AGENT_ARTIGO: m ? "o" : "a",
    AGENT_HUMANO: m ? "humano" : "humana",
    AGENT_DOUTOR: m ? "doutor" : "doutora",
    AGENT_CHAMADO: m ? "chamado" : "chamada",
    AGENT_CALOROSO: m ? "caloroso" : "calorosa",
    AGENT_SEGURO: m ? "seguro" : "segura",
    AGENT_CURIOSO: m ? "curioso" : "curiosa",
    AGENT_DIRETO: m ? "direto" : "direta",
    AGENT_MELOSO: m ? "meloso" : "melosa",
  };
  let base = readFileSync(path.join(AGENT_DIR, "system_prompt.md"), "utf8");
  for (const [k, v] of Object.entries(tokens)) base = base.replaceAll(`{{${k}}}`, v);
  return `${base}\n\n# Base de conhecimento\n\n${loadKnowledge()}`;
}
