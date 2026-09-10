/**
 * Testes da regra de MQL.
 *
 * É a parte da integração com consequência direta no número que o cliente vê:
 * classificar errado uma faixa infla ou esvazia o MQL sem deixar rastro.
 * Rodar com: npm run test:kommo
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floorOfRange, qualify } from '../qualification.ts';

// As três faixas reais do formulário da FORM7.
const ATE_200 = 'Até R$ 200.000,00';
const DE_200_A_500 = 'De R$ 200.000,00 a R$ 500.000,00';
const ACIMA_500 = 'Acima de R$ 500.000,00';

test('piso das faixas reais do formulário', () => {
  assert.equal(floorOfRange(ATE_200), 0, '"até X" é um teto: o piso é zero');
  assert.equal(floorOfRange(DE_200_A_500), 200000);
  assert.equal(floorOfRange(ACIMA_500), 500000);
});

test('classifica as três faixas do formulário', () => {
  assert.equal(qualify(ATE_200), 'nao_mql');
  assert.equal(qualify(DE_200_A_500), 'mql', 'a faixa que começa no limite conta como MQL');
  assert.equal(qualify(ACIMA_500), 'mql');
});

test('faturamento não informado é indefinido, não "não qualifica"', () => {
  for (const vazio of [null, undefined, '', '   ']) {
    assert.equal(qualify(vazio), 'indefinido');
  }
});

test('texto sem número não é chutado', () => {
  assert.equal(qualify('não sei informar'), 'indefinido');
  assert.equal(qualify('prefiro não responder'), 'indefinido');
});

test('formato brasileiro é lido corretamente', () => {
  // 200.000,00 são duzentos mil — não duzentos, nem duzentos milhões.
  assert.equal(floorOfRange('Acima de R$ 200.000,00'), 200000);
  assert.equal(floorOfRange('Acima de R$ 1.500.000,50'), 1500000.5);
});

test('faixa nova continua sendo classificada', () => {
  // O formulário pode ganhar faixas sem que ninguém mexa no código.
  assert.equal(qualify('De R$ 500.000,00 a R$ 1.000.000,00'), 'mql');
  assert.equal(qualify('Até R$ 50.000,00'), 'nao_mql');
  assert.equal(qualify('Acima de R$ 10.000.000,00'), 'mql');
});

test('valor solto funciona se o campo virar aberto', () => {
  assert.equal(qualify('350000'), 'mql');
  assert.equal(qualify('R$ 180.000,00'), 'nao_mql');
});

test('limite é configurável', () => {
  assert.equal(qualify(DE_200_A_500, 500000), 'nao_mql', 'com limite em 500k a faixa 200-500 não qualifica');
  assert.equal(qualify(ACIMA_500, 500000), 'mql');
});

test('a contagem dos 19 leads reais bate com 10 MQL', () => {
  // Distribuição real do export da Meta de 01/09 a 08/09.
  const respostas = [
    ...Array(9).fill(ATE_200),
    ...Array(7).fill(DE_200_A_500),
    ...Array(3).fill(ACIMA_500)
  ];
  const mqls = respostas.filter(r => qualify(r) === 'mql').length;
  assert.equal(respostas.length, 19);
  assert.equal(mqls, 10);
});

/*
 * O conector do Facebook grava o valor cru do formulário, com underscore no
 * lugar do espaço. Underscore é caractere de palavra em regex, então a
 * fronteira `\b` não fechava depois de "ate" e a regra do teto era pulada:
 * "até 200 mil" virava piso 200.000 e o lead era contado como MQL.
 */
test('formato cru do formulário, com underscore, é lido igual', () => {
  assert.equal(floorOfRange('até_r$_200.000,00'), 0);
  assert.equal(qualify('até_r$_200.000,00'), 'nao_mql');
  assert.equal(qualify('de_r$_200.000,00_a_r$_500.000,00'), 'mql');
  assert.equal(qualify('acima_de_r$_500.000,00'), 'mql');
});

test('os dois formatos da mesma faixa dão o mesmo veredito', () => {
  const pares = [
    ['Até R$ 200.000,00', 'até_r$_200.000,00'],
    ['De R$ 200.000,00 a R$ 500.000,00', 'de_r$_200.000,00_a_r$_500.000,00'],
    ['Acima de R$ 500.000,00', 'acima_de_r$_500.000,00']
  ];
  for (const [bonito, cru] of pares) {
    assert.equal(qualify(cru), qualify(bonito), `divergiu em ${cru}`);
  }
});

test('os 6 leads de 10/09 dão 2 MQL, não 6', () => {
  // Valores reais lidos do Kommo naquele dia.
  const dia = [
    'até_r$_200.000,00',
    'de_r$_200.000,00_a_r$_500.000,00',
    'até_r$_200.000,00',
    'até_r$_200.000,00',
    'acima_de_r$_500.000,00',
    'até_r$_200.000,00'
  ];
  assert.equal(dia.filter(v => qualify(v) === 'mql').length, 2);
});
