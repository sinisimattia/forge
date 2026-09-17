import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt } from '../../tools/create/receipt.mjs';

test('buildReceipt records provenance and the tokens used', () => {
  const receipt = buildReceipt({
    forgeCommit: 'abc1234',
    mode: 'create',
    tokens: { __FORGE_NAME__: 'my-app' },
  });
  assert.equal(receipt.forgeCommit, 'abc1234');
  assert.equal(receipt.mode, 'create');
  assert.deepEqual(receipt.tokens, { __FORGE_NAME__: 'my-app' });
  assert.match(receipt.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('buildReceipt does not carry anything beyond the declared fields', () => {
  const receipt = buildReceipt({ forgeCommit: 'a', mode: 'adopt', tokens: {} });
  assert.deepEqual(Object.keys(receipt).sort(), ['forgeCommit', 'generatedAt', 'mode', 'tokens']);
});
