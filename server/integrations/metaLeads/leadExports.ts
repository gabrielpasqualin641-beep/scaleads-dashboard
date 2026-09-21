import fs from 'fs';
import path from 'path';
import { qualify, Qualification } from '../kommo/qualification.js';
import { slugify } from '../sheets/fetchAndAggregate.js';
import { dataFile } from '../../config/paths.js';

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
  /**
   * Resposta que qualifica o lead. Na maioria das contas é o faturamento; em
   * outras, uma opção de múltipla escolha (ex.: posição sobre o investimento).
   * Qual coluna a preenche é decidido por `parseLeadExport`.
   */
  qualifierAnswer: string | null;
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

/**
 * Lê o XML "SpreadsheetML" que o Gerenciador entrega quando o export é pedido
 * como .xls — mesmas colunas do CSV, empacotadas em `<Row><Cell><Data>`.
 *
 * Uma célula vazia é omitida do XML, mas pode carregar `ss:Index` dizendo a que
 * coluna a próxima pertence; sem respeitar isso, uma linha com buraco no meio
 * desalinha todas as colunas seguintes.
 */
function parseSpreadsheetXml(text: string): string[][] {
  const cellRe = /<Cell\b([^>]*)>([\s\S]*?)<\/Cell>|<Cell\b([^>]*)\/>/g;
  const dataRe = /<Data\b[^>]*>([\s\S]*?)<\/Data>/;
  const indexRe = /ss:Index="(\d+)"/;
  const unescape = (s: string) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');

  const rows: string[][] = [];
  const rowRe = /<Row\b[^>]*>([\s\S]*?)<\/Row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(text))) {
    const cells: string[] = [];
    let col = 0;
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] ?? cellMatch[3] ?? '';
      const idxAttr = attrs.match(indexRe);
      if (idxAttr) col = Number(idxAttr[1]) - 1; // ss:Index é 1-based
      const inner = cellMatch[2] ?? '';
      const data = inner.match(dataRe);
      while (cells.length < col) cells.push('');
      cells[col] = data ? unescape(data[1]) : '';
      col++;
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Lê o export de leads. `matchQualifier` escolhe a coluna cuja resposta
 * qualifica o lead — por padrão a de faturamento, mas uma conta pode apontar
 * outra (ex.: a pergunta sobre o investimento). A coluna é opcional: se não
 * existir, o lead entra com `qualifierAnswer` nulo e cai em indefinido.
 */
export function parseLeadExport(
  buffer: Buffer,
  matchQualifier: (header: string) => boolean = h => h.includes('faturamento')
): ExportedLead[] {
  const text = decode(buffer);
  const isXml = /^\s*<\?xml|^\s*<Workbook/i.test(text.slice(0, 64));
  let table: string[][];
  if (isXml) {
    table = parseSpreadsheetXml(text);
  } else {
    const firstLine = text.slice(0, text.search(/\r?\n/));
    const delimiter = firstLine.includes('\t') ? '\t' : ',';
    table = parseDelimited(text, delimiter);
  }
  if (table.length === 0) return [];

  const header = table[0].map(h => h.trim().toLowerCase());
  const col = (predicate: (h: string) => boolean) => header.findIndex(predicate);

  const idx = {
    id: col(h => h === 'id'),
    created: col(h => h === 'created_time'),
    campaign: col(h => h === 'campaign_name'),
    adSet: col(h => h === 'adset_name'),
    ad: col(h => h === 'ad_name'),
    // A pergunta vira nome de coluna e muda com o texto do formulário; qual
    // coluna qualifica é decidido por quem chama.
    qualifier: col(matchQualifier)
  };

  const faltando = Object.entries(idx).filter(([k, v]) => v < 0 && k !== 'qualifier').map(([k]) => k);
  if (faltando.length > 0) {
    throw new Error(`Export sem as colunas esperadas: ${faltando.join(', ')}.`);
  }

  return table.slice(1).map(r => ({
    // O CSV grava o id como "l:123", o XLS como "123". Sem tirar o prefixo, o
    // mesmo lead exportado nos dois formatos vira dois ids distintos e a
    // deduplicação não o reconhece — foi o que inflou o Criativo 07 de 104 para
    // 185, contando cada lead duas vezes.
    id: (r[idx.id] || '').trim().replace(/^l:/, ''),
    date: (r[idx.created] || '').trim().slice(0, 10),
    campaignName: (r[idx.campaign] || '').trim(),
    adSetName: (r[idx.adSet] || '').trim(),
    adName: (r[idx.ad] || '').trim(),
    qualifierAnswer: idx.qualifier >= 0 ? (r[idx.qualifier] || '').trim() || null : null
  })).filter(l =>
    l.id &&
    /^\d{4}-\d{2}-\d{2}$/.test(l.date) &&
    // Lead de teste da Meta: vem com a resposta "dummy" e não é um lead real.
    !/^<test lead/i.test(l.qualifierAnswer || '')
  );
}

/** Janela declarada no nome: "..._Leads_2026-09-10_2026-09-13.csv" (ou .xls). */
export function rangeFromFileName(fileName: string): DateRange | null {
  const m = fileName.match(/_Leads_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/i);
  return m ? { since: m[1], until: m[2] } : null;
}

/** Nome de export da Meta, em qualquer um dos formatos que o Gerenciador gera. */
export function isLeadExportFile(fileName: string): boolean {
  return /_Leads_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.(csv|xls)$/i.test(fileName);
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
  resolveAccount: (adKey: string) => string | null,
  classify: (answer: string | null) => Qualification = answer => qualify(answer)
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
      const verdict = classify(lead.qualifierAnswer);
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

/**
 * Segunda fonte, ao vivo: a planilha de backup de leads sincronizada pelo
 * servidor. Fica no disco de dados (runtime), separada do seed commitado.
 *
 * São duas origens de propósito. O seed carrega o histórico que veio de
 * exports manuais e é versionado — sobrevive a deploy. O arquivo ao vivo é
 * regenerado da planilha a cada sincronização e não vai para o git. O store
 * lê os dois e junta na leitura, com a planilha ao vivo prevalecendo quando o
 * mesmo dia aparece nas duas (é a mais fresca).
 */
const LIVE_FILE = dataFile('lead-exports-live.json');

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

export function readLiveFile(): LeadExportSnapshot {
  return readSnapshotFile(LIVE_FILE);
}

export function writeLiveFile(snapshot: LeadExportSnapshot): void {
  writeSnapshotFile(snapshot, LIVE_FILE);
}

/**
 * Junta seed (histórico) e ao vivo (planilha) num snapshot só.
 *
 * Por anúncio, os dias das duas fontes se somam num mapa único; quando o mesmo
 * dia existe nos dois, o ao vivo vence, porque reflete a planilha mais recente.
 * A cobertura é a união das janelas — um dia coberto por qualquer das fontes
 * conta como coberto.
 */
function mergeSnapshots(seed: LeadExportSnapshot, live: LeadExportSnapshot): LeadExportSnapshot {
  const merged: LeadExportSnapshot = JSON.parse(JSON.stringify(seed));
  for (const [accountId, ads] of Object.entries(live.accounts)) {
    const conta = (merged.accounts[accountId] ||= {});
    for (const [adKey, ad] of Object.entries(ads)) {
      const atual = conta[adKey];
      if (!atual) {
        conta[adKey] = JSON.parse(JSON.stringify(ad));
        continue;
      }
      atual.daily = { ...atual.daily, ...ad.daily };
      atual.coverage = mergeRanges([...atual.coverage, ...ad.coverage]);
    }
  }
  merged.updatedAt = live.updatedAt > seed.updatedAt ? live.updatedAt : seed.updatedAt;
  return merged;
}

class LeadExportStore {
  private cache: LeadExportSnapshot | null = null;
  private signature = '';

  /** Recarrega quando qualquer das duas fontes muda no disco. */
  private data(): LeadExportSnapshot {
    const mtimeOf = (f: string) => {
      try { return fs.statSync(f).mtimeMs; } catch { return 0; }
    };
    const sig = `${mtimeOf(SEED_FILE)}:${mtimeOf(LIVE_FILE)}`;
    if (!this.cache || sig !== this.signature) {
      this.cache = mergeSnapshots(readSnapshotFile(), readLiveFile());
      this.signature = sig;
    }
    return this.cache;
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
