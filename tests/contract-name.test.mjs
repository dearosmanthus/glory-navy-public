import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeContractName } from '../lib/contract-name.ts';

test('normalizes boundary asterisks copied with Chinese item names', () => {
  const expected = normalizeContractName('三钛合金');

  assert.equal(normalizeContractName('*三钛合金'), expected);
  assert.equal(normalizeContractName('＊三钛合金'), expected);
  assert.equal(normalizeContractName('* 三钛合金'), expected);
  assert.equal(normalizeContractName('三钛合金 *'), expected);
  assert.equal(normalizeContractName('** 三钛合金 **'), expected);
});

test('keeps asterisks inside an item name', () => {
  assert.equal(normalizeContractName('A*B'), 'a*b');
});
