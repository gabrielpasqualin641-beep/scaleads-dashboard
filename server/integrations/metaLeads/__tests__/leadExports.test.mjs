/**
 * Testes do importador de export de leads da Meta.
 * Rodar com: npm run test:leads
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseLeadExport,
  mergeExports,
  rangeFromFileName,
  adKeyFor
} from '../leadExports.ts';

const CAMPANHA = 'IA | E2-CAP | P1-FRIO | ON | 01-29-2026 | FORM7';
const CONJUNTO = '00 | AUTO | PFRIO ADV | Criativo Estático';
const ANUNCIO = 'Criativo Estático - Faça um Raio X';

/** Monta um CSV no formato do Gerenciador: UTF-16 com BOM, tabulação, aspas. */
function exportMeta(linhas) {
  const header = ['id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id',
    'campaign_name', 'form_id', 'form_name', 'is_organic', 'platform',
    'qual_é_o_faturamento_anual_da_sua_empres?_', 'full_name', 'email', 'phone_number', 'lead_status'];
  const q = v => `"${v}"`;
  const rows = linhas.map(([id, data, fat]) => [
    `l:${id}`, `${data}T10:00:00-03:00`, 'ag:1', q(ANUNCIO), 'as:1', q(CONJUNTO), 'c:1', q(CAMPANHA),
    'f:1', q('IA | FORM-01'), 'false', 'ig', fat, q('Fulano'), 'a@b.com', 'p:+55', 'complete'
  ].join('\t'));
  const texto = [header.join('\t'), ...rows].join('\r\n') + '\r\n';
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(texto, 'utf16le')]);
}

const ARQUIVO = `${ANUNCIO}_Leads_2026-09-10_2026-09-13.csv`;
const vazio = () => ({ version: 1, updatedAt: '', accounts: {} });
const contaUnica = () => 'conta-1';

test('lê o formato do Gerenciador, com nomes que contêm "|"', () => {
  const leads = parseLeadExport(exportMeta([['111', '2026-09-11', 'até_r$_200.000,00']]));
  assert.equal(leads.length, 1);
  assert.equal(leads[0].adName, ANUNCIO);
  assert.equal(leads[0].campaignName, CAMPANHA);
  assert.equal(leads[0].date, '2026-09-11');
  assert.equal(leads[0].faturamento, 'até_r$_200.000,00');
});

test('não guarda nada que identifique o lead', () => {
  const buf = exportMeta([['111', '2026-09-11', 'acima_de_r$_500.000,00']]);
  const { snapshot } = mergeExports(vazio(), [{ fileName: ARQUIVO, leads: parseLeadExport(buf) }], contaUnica);
  const gravado = JSON.stringify(snapshot);
  assert.ok(!gravado.includes('Fulano'), 'nome não pode ir para o arquivo');
  assert.ok(!gravado.includes('a@b.com'), 'e-mail não pode ir para o arquivo');
  assert.ok(!gravado.includes('111'), 'id do lead não pode ir para o arquivo');
});

test('conta leads e MQL por dia, usando a mesma regra do CRM', () => {
  const buf = exportMeta([
    ['1', '2026-09-11', 'até_r$_200.000,00'],
    ['2', '2026-09-11', 'de_r$_200.000,00_a_r$_500.000,00'],
    ['3', '2026-09-12', 'acima_de_r$_500.000,00']
  ]);
  const { snapshot, report } = mergeExports(vazio(), [{ fileName: ARQUIVO, leads: parseLeadExport(buf) }], contaUnica);
  const ad = snapshot.accounts['conta-1'][adKeyFor(CAMPANHA, CONJUNTO, ANUNCIO)];
  assert.deepEqual(ad.daily['2026-09-11'], { leads: 2, mqls: 1, indefinidos: 0 });
  assert.deepEqual(ad.daily['2026-09-12'], { leads: 1, mqls: 1, indefinidos: 0 });
  assert.equal(report[0].leads, 3);
  assert.equal(report[0].mqls, 2);
});

test('reimportar o mesmo arquivo não duplica', () => {
  const files = [{ fileName: ARQUIVO, leads: parseLeadExport(exportMeta([['1', '2026-09-11', 'acima_de_r$_500.000,00']])) }];
  const primeira = mergeExports(vazio(), files, contaUnica).snapshot;
  const segunda = mergeExports(primeira, files, contaUnica).snapshot;
  const ad = segunda.accounts['conta-1'][adKeyFor(CAMPANHA, CONJUNTO, ANUNCIO)];
  assert.deepEqual(ad.daily['2026-09-11'], { leads: 1, mqls: 1, indefinidos: 0 });
});

test('export novo substitui os dias que ele traz', () => {
  const antes = mergeExports(vazio(), [{
    fileName: ARQUIVO,
    leads: parseLeadExport(exportMeta([['1', '2026-09-11', 'acima_de_r$_500.000,00']]))
  }], contaUnica).snapshot;
  const depois = mergeExports(antes, [{
    fileName: ARQUIVO,
    leads: parseLeadExport(exportMeta([['2', '2026-09-11', 'até_r$_200.000,00']]))
  }], contaUnica).snapshot;
  const ad = depois.accounts['conta-1'][adKeyFor(CAMPANHA, CONJUNTO, ANUNCIO)];
  assert.deepEqual(ad.daily['2026-09-11'], { leads: 1, mqls: 0, indefinidos: 0 });
});

test('o mesmo lead em dois arquivos da rodada conta uma vez', () => {
  const buf = exportMeta([['1', '2026-09-11', 'acima_de_r$_500.000,00']]);
  const files = [
    { fileName: ARQUIVO, leads: parseLeadExport(buf) },
    { fileName: ARQUIVO.replace('.csv', ' (1).csv'), leads: parseLeadExport(buf) }
  ];
  const { report } = mergeExports(vazio(), files, contaUnica);
  assert.equal(report[0].leads, 1);
});

test('criativo sem conta conhecida é recusado, não atribuído no chute', () => {
  const files = [{ fileName: ARQUIVO, leads: parseLeadExport(exportMeta([['1', '2026-09-11', 'acima_de_r$_500.000,00']])) }];
  const { snapshot, unmatched } = mergeExports(vazio(), files, () => null);
  assert.equal(unmatched.length, 1);
  assert.deepEqual(snapshot.accounts, {});
});

/*
 * O export real "_2026-09-10_2026-09-13" não trazia nenhum lead do dia 10, que
 * teve 7. Confiar no nome do arquivo marcava o dia 10 como coberto e sem MQL,
 * apagando os MQL que o CRM tinha para ele.
 */
test('a janela é a das datas que o arquivo contém, não a do nome', () => {
  const files = [{ fileName: ARQUIVO, leads: parseLeadExport(exportMeta([
    ['1', '2026-09-11', 'acima_de_r$_500.000,00'],
    ['2', '2026-09-14', 'até_r$_200.000,00']
  ])) }];
  const { report } = mergeExports(vazio(), files, contaUnica);
  assert.deepEqual(report[0].coverage, { since: '2026-09-11', until: '2026-09-14' });
});

test('a chave do criativo é a mesma que a planilha usa', () => {
  // Acento e "|" viram hífen do mesmo jeito dos dois lados.
  assert.equal(
    adKeyFor(CAMPANHA, CONJUNTO, ANUNCIO),
    'sheet_ad_ia-e2-cap-p1-frio-on-01-29-2026-form7_00-auto-pfrio-adv-criativo-estatico_criativo-estatico-faca-um-raio-x'
  );
});
