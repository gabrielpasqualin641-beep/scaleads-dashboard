import fs from 'fs';
import path from 'path';
import { qualify } from '../kommo/qualification.js';
import { slugify } from '../sheets/fetchAndAggregate.js';

/**
 * Export manual de leads da Meta, reduzido a contagens por criativo e por dia.
 *
 * Existe por dois motivos. O primeiro: o lead chega ao Kommo sem dizer de qual
 * anúncio veio, então o MQL do CRM só existe no total da conta. O export do
 * Gerenciador traz o anúncio de cada lead junto com a resposta de faturamento,
 * e é a única origem hoje que permite dizer qual criativo gera lead que presta.
 *
 * O segundo: o conector do Kommo pode parar de receber leads sem avisar — foi o
 * que aconteceu quando um formulário novo entrou no ar sem mapeamento, e 98% dos
 * leads dele não chegaram ao CRM. Nas datas que o export cobre, ele é a origem
 * completa.
 *
 * Nada pessoal é guardado. O CSV traz nome, e-mail e telefone; aqui fica só a
 * contagem. O arquivo resultante vai para o repositório, que é público, e é por
 * isso que ele pode ir: sem os dados de contato não há lead identificável.
 */

export interface LeadCell {
  leads: number;
  mqls: number;
  /** Lead sem faturamento legível — fora do MQL, mas contado para aparecer. */
  indefinidos: number;
}

export interface DateRange {
  since: string;
  until: string;
}

export interface AdLeadExport {
  /** Mesmo id que o anúncio tem no snapshot da planilha. */
  adKey: string;
  adName: string;
  adSetName: string;
  campaignName: string;
  /**
   * Janelas que algum export cobriu para este anúncio. Dentro delas, dia sem
   * contagem é zero lead de verdade; fora delas, é desconhecido.
   */
  coverage: DateRange[];
  daily: Record<string, LeadCell>;
}

export interface LeadExportSnapshot {
  version: 1;
  updatedAt: string;
  /** externalAccountId → adKey → dados do anúncio. */
  accounts: Record<string, Record<string, AdLeadExport>>;
}

const SEED_FILE = path.resolve(process.cwd(), 'server/seed/lead-exports.json');

/* -------------------------------------------------------------------------- */
/* Leitura do CSV                                                             */
/* -------------------------------------------------------------------------- */

export interface ExportedLead {
  id: string;
  /** Data local do lead, como a Meta grava no fuso da conta. */
  date: string;
  campaignName: string;
  adSetName: string;
  adName: string;
  faturamento: string | null;
}

/** O Gerenciador exporta em UTF-16 com BOM; um CSV reaberto e salvo pode virar UTF-8. */
function decode(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
  return buffer.toString('utf8');
}

/** Separa linhas e campos respeitando aspas, que aparecem em nomes com "|". */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

export function parseLeadExport(buffer: Buffer): ExportedLead[] {
  const text = decode(buffer);
  const firstLine = text.slice(0, text.search(/\r?\n/));
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const table = parseDelimited(text, delimiter);
  if (table.length === 0) return [];

  const header = table[0].map(h => h.trim().toLowerCase());
  const col = (predicate: (h: string) => boolean) => header.findIndex(predicate);

  const idx = {
    id: col(h => h === 'id'),
    created: col(h => h === 'created_time'),
    campaign: col(h => h === 'campaign_name'),
    adSet: col(h => h === 'adset_name'),
    ad: col(h => h === 'ad_name'),
    // A pergunta vira nome de coluna e muda com o texto do formulário; o que
    // se mantém é a palavra "faturamento".
    faturamento: col(h => h.includes('faturamento'))
  };

  const faltando = Object.entries(idx).filter(([k, v]) => v < 0 && k !== 'faturamento').map(([k]) => k);
  if (faltando.length > 0) {
    throw new Error(`Export sem as colunas esperadas: ${faltando.join(', ')}.`);
  }

  return table.slice(1).map(r => ({
    id: (r[idx.id] || '').trim(),
    date: (r[idx.created] || '').trim().slice(0, 10),
    campaignName: (r[idx.campaign] || '').trim(),
    adSetName: (r[idx.adSet] || '').trim(),
    adName: (r[idx.ad] || '').trim(),
    faturamento: idx.faturamento >= 0 ? (r[idx.faturamento] || '').trim() || null : null
  })).filter(l => l.id && /^\d{4}-\d{2}-\d{2}$/.test(l.date));
}

/** Janela declarada no nome do arquivo: "..._Leads_2026-09-10_2026-09-13.csv". */
export function rangeFromFileName(fileName: string): DateRange | null {
  const m = fileName.match(/_Leads_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/i);
  return m ? { since: m[1], until: m[2] } : null;
}

export function adKeyFor(campaignName: string, adSetName: string, adName: string): string {
  return `sheet_ad_${slugify(campaignName)}_${slugify(adSetName)}_${slugify(adName)}`;
}

/* -------------------------------------------------------------------------- */
/* Agregação e merge                                                          */
/* -------------------------------------------------------------------------- */

function mergeRanges(ranges: DateRange[]): DateRange[] {
  const sorted = [...ranges].sort((a, b) => a.since.localeCompare(b.since));
  const out: DateRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.since <= nextDay(last.until)) {
      if (r.until > last.until) last.until = r.until;
    } else out.push({ ...r });
  }
  return out;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface ImportedFile {
  fileName: string;
  leads: ExportedLead[];
}

export interface ImportReport {
  accountId: string;
  adKey: string;
  adName: string;
  coverage: DateRange;
  leads: number;
  mqls: number;
  indefinidos: number;
}

/**
 * Incorpora exports ao snapshot.
 *
 * Reimportar precisa ser seguro: exportar de novo o mesmo período não pode
 * contar lead duas vezes. Por isso, para cada anúncio, os dias dentro da janela
 * do export são apagados e reescritos a partir dele — em vez de somados ao que
 * já havia. Leads que aparecem em mais de um arquivo da mesma rodada entram uma
 * vez só, pelo id.
 *
 * `resolveAccount` diz a qual conta o anúncio pertence. O CSV não traz a conta,
 * e anúncio que não casa com nenhum criativo da planilha é recusado: sem saber
 * a conta, qualquer atribuição seria chute.
 */
export function mergeExports(
  snapshot: LeadExportSnapshot,
  files: ImportedFile[],
  resolveAccount: (adKey: string) => string | null
): { snapshot: LeadExportSnapshot; report: ImportReport[]; unmatched: string[] } {
  // Agrupa por anúncio, somando todos os arquivos da rodada.
  const porAnuncio = new Map<string, { sample: ExportedLead; leads: Map<string, ExportedLead>; ranges: DateRange[] }>();

  for (const file of files) {
    for (const lead of file.leads) {
      const key = adKeyFor(lead.campaignName, lead.adSetName, lead.adName);
      const entry = porAnuncio.get(key) || { sample: lead, leads: new Map<string, ExportedLead>(), ranges: [] as DateRange[] };
      entry.leads.set(lead.id, lead);
      porAnuncio.set(key, entry);
    }
  }

  const next: LeadExportSnapshot = JSON.parse(JSON.stringify(snapshot));
  const report: ImportReport[] = [];
  const unmatched: string[] = [];

  for (const [adKey, entry] of porAnuncio) {
    const accountId = resolveAccount(adKey);
    if (!accountId) {
      unmatched.push(`${entry.sample.adName} (${entry.sample.campaignName})`);
      continue;
    }

    const leads = Array.from(entry.leads.values());
    const dates = leads.map(l => l.date).sort();
    // A janela real é a declarada no arquivo somada às datas observadas: o
    // export às vezes traz lead de um dia além do nome do arquivo.
    const coverage = mergeRanges([...entry.ranges, { since: dates[0], until: dates[dates.length - 1] }]);
    const janela: DateRange = { since: coverage[0].since, until: coverage[coverage.length - 1].until };

    const conta = (next.accounts[accountId] ||= {});
    const atual: AdLeadExport = conta[adKey] || {
      adKey,
      adName: entry.sample.adName,
      adSetName: entry.sample.adSetName,
      campaignName: entry.sample.campaignName,
      coverage: [],
      daily: {}
    };

    // Substitui a janela inteira, inclusive dias em que o export não tem lead.
    for (const d of Object.keys(atual.daily)) {
      if (coverage.some(r => d >= r.since && d <= r.until)) delete atual.daily[d];
    }

    const resumo = { leads: 0, mqls: 0, indefinidos: 0 };
    for (const lead of leads) {
      const cell = (atual.daily[lead.date] ||= { leads: 0, mqls: 0, indefinidos: 0 });
      const verdict = qualify(lead.faturamento);
      cell.leads++;
      resumo.leads++;
      if (verdict === 'mql') { cell.mqls++; resumo.mqls++; }
      else if (verdict === 'indefinido') { cell.indefinidos++; resumo.indefinidos++; }
    }

    atual.coverage = mergeRanges([...atual.coverage, ...coverage]);
    conta[adKey] = atual;
    report.push({ accountId, adKey, adName: atual.adName, coverage: janela, ...resumo });
  }

  next.updatedAt = new Date().toISOString();
  return { snapshot: next, report, unmatched };
}

/* -------------------------------------------------------------------------- */
/* Persistência e consulta                                                    */
/* -------------------------------------------------------------------------- */

const EMPTY: LeadExportSnapshot = { version: 1, updatedAt: new Date(0).toISOString(), accounts: {} };

export function readSnapshotFile(file = SEED_FILE): LeadExportSnapshot {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as LeadExportSnapshot;
  } catch (e) {
    console.error('[Leads export] Arquivo ilegível, ignorado:', (e as Error).message);
  }
  return JSON.parse(JSON.stringify(EMPTY));
}

export function writeSnapshotFile(snapshot: LeadExportSnapshot, file = SEED_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
}

class LeadExportStore {
  private cache: LeadExportSnapshot | null = null;
  private mtime = 0;

  /** Relê o arquivo quando ele muda — o import roda fora do servidor. */
  private data(): LeadExportSnapshot {
    try {
      const stat = fs.statSync(SEED_FILE);
      if (!this.cache || stat.mtimeMs !== this.mtime) {
        this.cache = readSnapshotFile();
        this.mtime = stat.mtimeMs;
      }
    } catch {
      this.cache = this.cache || JSON.parse(JSON.stringify(EMPTY));
    }
    return this.cache!;
  }

  private ads(accountId: string): AdLeadExport[] {
    return Object.values(this.data().accounts[accountId] || {});
  }

  private covers(ad: AdLeadExport, date: string): boolean {
    return ad.coverage.some(r => date >= r.since && date <= r.until);
  }

  /**
   * Contagem do anúncio no período, ou `null` quando nenhum export cobre
   * nenhum dia dele — ausência de dado, que o painel mostra como N/D.
   */
  public forAd(accountId: string, adKey: string, since: string, until: string): (LeadCell & { coverage: DateRange }) | null {
    const ad = this.data().accounts[accountId]?.[adKey];
    if (!ad) return null;

    const clipped = ad.coverage
      .map(r => ({ since: r.since > since ? r.since : since, until: r.until < until ? r.until : until }))
      .filter(r => r.since <= r.until);
    if (clipped.length === 0) return null;

    const total = { leads: 0, mqls: 0, indefinidos: 0 };
    for (const [date, cell] of Object.entries(ad.daily)) {
      if (date < since || date > until) continue;
      total.leads += cell.leads;
      total.mqls += cell.mqls;
      total.indefinidos += cell.indefinidos;
    }
    return { ...total, coverage: { since: clipped[0].since, until: clipped[clipped.length - 1].until } };
  }

  /**
   * Contagem da conta num dia, somando os anúncios cujo export cobre o dia.
   * `null` quando nenhum cobre — aí quem responde é o CRM.
   */
  public forAccountDate(accountId: string, date: string): LeadCell | null {
    const cobrem = this.ads(accountId).filter(ad => this.covers(ad, date));
    if (cobrem.length === 0) return null;
    return cobrem.reduce<LeadCell>((acc, ad) => {
      const cell = ad.daily[date];
      if (cell) {
        acc.leads += cell.leads;
        acc.mqls += cell.mqls;
        acc.indefinidos += cell.indefinidos;
      }
      return acc;
    }, { leads: 0, mqls: 0, indefinidos: 0 });
  }
}

export const leadExportStore = new LeadExportStore();
