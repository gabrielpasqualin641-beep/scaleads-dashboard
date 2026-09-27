import fs from 'fs';
import { dataFile } from '../../config/paths.js';
import { readSnapshotFile, writeSnapshotFile, LeadExportSnapshot, DateRange, LeadCell } from '../metaLeads/leadExports.js';

/**
 * MQL por criativo vindo do Kommo, atribuído pela UTM do lead.
 *
 * Fica separado do export de leads da Meta (`lead-exports-*.json`) de
 * propósito: aqui entram só os leads da landing page, que chegam ao CRM com
 * `utm_campaign/medium/content` e permitem dizer de qual anúncio vieram. O
 * total da conta continua saindo da contagem de conta do Kommo, sem tocar
 * nesta — então um lead nunca é contado nas duas.
 *
 * Mesma estrutura do snapshot de export (conta → adKey → dias), para o
 * `adKey` casar com o do snapshot do Adveronix e o MQL cair no criativo certo.
 */

const FILE = dataFile('kommo-creative.json');

export function readKommoCreative(): LeadExportSnapshot {
  return readSnapshotFile(FILE);
}

export function writeKommoCreative(snapshot: LeadExportSnapshot): void {
  writeSnapshotFile(snapshot, FILE);
}

class KommoCreativeStore {
  private cache: LeadExportSnapshot | null = null;
  private signature = '';

  private data(): LeadExportSnapshot {
    let mtime = 0;
    try { mtime = fs.statSync(FILE).mtimeMs; } catch { /* arquivo ainda não existe */ }
    const sig = String(mtime);
    if (!this.cache || sig !== this.signature) {
      this.cache = readSnapshotFile(FILE);
      this.signature = sig;
    }
    return this.cache;
  }

  /** Contagem do anúncio no período, ou null quando nenhum lead da LP o cobre. */
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
}

export const kommoCreativeStore = new KommoCreativeStore();
