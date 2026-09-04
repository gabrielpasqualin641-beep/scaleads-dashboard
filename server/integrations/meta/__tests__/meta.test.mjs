/**
 * Testes da lógica pura da integração Meta.
 *
 * Cobre o que dá para verificar sem token: interpretação de actions,
 * normalização de id e redação de credencial. Rodar com:
 *   npm run test:meta
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMetaActions, listActionTypes } from '../actions.ts';
import { toActId, redact } from '../graphClient.ts';

test('não soma tipos que representam a mesma compra', () => {
  const actions = [
    { action_type: 'purchase', value: '10' },
    { action_type: 'omni_purchase', value: '10' },
    { action_type: 'offsite_conversion.fb_pixel_purchase', value: '10' }
  ];
  const parsed = parseMetaActions(actions, [], 'purchase');
  // Somar daria 30 para 10 compras reais.
  assert.equal(parsed.conversions, 10);
});

test('usa o primeiro tipo de lead disponível', () => {
  const parsed = parseMetaActions([{ action_type: 'offsite_conversion.fb_pixel_lead', value: '7' }], [], 'purchase');
  assert.equal(parsed.leads, 7);
});

test('métrica ausente vira null, não zero', () => {
  const parsed = parseMetaActions([{ action_type: 'link_click', value: '5' }], [], 'purchase');
  assert.equal(parsed.leads, null, 'conta sem lead deve reportar null');
  assert.equal(parsed.conversions, null);
  assert.equal(parsed.linkClicks, 5);
});

test('zero reportado continua sendo zero', () => {
  const parsed = parseMetaActions([{ action_type: 'lead', value: '0' }], [], 'purchase');
  assert.equal(parsed.leads, 0, 'zero explícito é diferente de ausente');
});

test('valor de conversão sai de action_values', () => {
  const parsed = parseMetaActions(
    [{ action_type: 'purchase', value: '3' }],
    [{ action_type: 'purchase', value: '450.75' }],
    'purchase'
  );
  assert.equal(parsed.conversions, 3);
  assert.equal(parsed.conversionValue, 450.75);
});

test('entrada inválida não quebra', () => {
  for (const input of [null, undefined, 'texto', 42, {}]) {
    const parsed = parseMetaActions(input, input, 'purchase');
    assert.equal(parsed.leads, null);
    assert.equal(parsed.conversions, null);
  }
});

test('conversão principal fora da lista conhecida é respeitada', () => {
  const parsed = parseMetaActions(
    [{ action_type: 'complete_registration', value: '12' }],
    [],
    'complete_registration'
  );
  assert.equal(parsed.conversions, 12);
});

test('act_ não é duplicado', () => {
  assert.equal(toActId('123456'), 'act_123456');
  assert.equal(toActId('act_123456'), 'act_123456');
  assert.equal(toActId('  act_123456  '), 'act_123456');
});

test('token some de qualquer texto', () => {
  const comQuery = redact('GET /insights?access_token=EAABsecretovalor123&fields=spend');
  assert.ok(!comQuery.includes('EAABsecretovalor123'));
  assert.ok(comQuery.includes('[REDACTED]'));

  const solto = redact('falhou com EAAG' + 'x'.repeat(30));
  assert.ok(!solto.includes('EAAG' + 'x'.repeat(30)));
});

test('listActionTypes ajuda a diagnosticar a conta', () => {
  const tipos = listActionTypes([{ action_type: 'lead', value: '1' }, { action_type: 'purchase', value: '2' }]);
  assert.deepEqual(tipos, ['lead', 'purchase']);
  assert.deepEqual(listActionTypes(null), []);
});
