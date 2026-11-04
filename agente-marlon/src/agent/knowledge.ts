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

export function loadSystemPrompt(agentName: string): string {
  const base = readFileSync(path.join(AGENT_DIR, "system_prompt.md"), "utf8").replaceAll("{{AGENT_NAME}}", agentName);
  return `${base}\n\n# Base de conhecimento\n\n${loadKnowledge()}`;
}
