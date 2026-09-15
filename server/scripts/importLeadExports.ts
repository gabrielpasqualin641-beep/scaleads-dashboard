import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  mergeExports,
  parseLeadExport,
  readSnapshotFile,
  writeSnapshotFile,
  isLeadExportFile,
  ImportedFile
} from '../integrations/metaLeads/leadExports.js';
import { sheetsSnapshotStore } from '../integrations/sheets/SheetsSnapshotStore.js';
import { db } from '../db/database.js';

/**
 * Importa exports de leads da Meta.
 *
 *   npm run leads:import                      # todo *_Leads_*.csv/.xls da pasta Downloads
 *   npm run leads:import -- arquivo.csv ...   # arquivos específicos
 *   npm run leads:import -- C:\pasta          # todo *_Leads_*.csv da pasta
 *
 * Grava só contagens em server/seed/lead-exports.json. Faça commit desse
 * arquivo para o painel hospedado passar a ver os números.
 */

function collect(args: string[]): string[] {
  const alvos = args.length > 0 ? args : [path.join(os.homedir(), 'Downloads')];
  const files: string[] = [];
  for (const alvo of alvos) {
    if (!fs.existsSync(alvo)) {
      console.warn(`Não encontrado: ${alvo}`);
      continue;
    }
    if (fs.statSync(alvo).isDirectory()) {
      for (const f of fs.readdirSync(alvo)) {
        // Só o nome que o Gerenciador gera, em .csv ou .xls. "_leads_" solto
        // casava com o modelo de importação do Kommo, que não é export da Meta.
        if (isLeadExportFile(f)) files.push(path.join(alvo, f));
      }
    } else files.push(alvo);
  }
  return files;
}

const paths = collect(process.argv.slice(2));
if (paths.length === 0) {
  console.error('Nenhum export de leads encontrado (arquivos *_Leads_*.csv).');
  process.exit(1);
}

// Um arquivo ilegível não pode derrubar os outros: ele é listado e pulado.
const files: ImportedFile[] = [];
for (const p of paths) {
  try {
    files.push({ fileName: path.basename(p), leads: parseLeadExport(fs.readFileSync(p)) });
  } catch (err) {
    console.warn(`Pulado ${path.basename(p)}: ${(err as Error).message}`);
  }
}

// O CSV não diz a conta: ela sai do criativo com o mesmo nome na planilha.
const planilhas = db.getAllAccounts()
  .map(acc => sheetsSnapshotStore.getAccount(acc.externalAccountId))
  .filter((acc): acc is NonNullable<typeof acc> => !!acc);
const resolveAccount = (adKey: string): string | null => {
  const donas = planilhas.filter(acc => acc.ads.some(ad => ad.id === adKey));
  return donas.length === 1 ? donas[0].accountId : null;
};

const { snapshot: next, report, unmatched } = mergeExports(readSnapshotFile(), files, resolveAccount);
writeSnapshotFile(next);

console.log(`\n${files.length} arquivo(s), ${files.reduce((s, f) => s + f.leads.length, 0)} lead(s) lidos.\n`);
for (const r of report) {
  console.log(
    `  ${r.adName.padEnd(38)} ${r.coverage.since} a ${r.coverage.until}  ` +
    `leads ${String(r.leads).padStart(3)}  MQL ${String(r.mqls).padStart(3)}  sem faturamento ${r.indefinidos}`
  );
}
if (unmatched.length > 0) {
  console.warn(`\nNão importados — criativo sem correspondente na planilha:\n  ${unmatched.join('\n  ')}`);
}
console.log('\nGravado em server/seed/lead-exports.json. Faça commit para o painel hospedado ver.');
