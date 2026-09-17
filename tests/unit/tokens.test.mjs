import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTitle, deriveTokens, substitute, findUnresolved } from '../../tools/create/tokens.mjs';

test('toTitle turns a kebab name into a human title', () => {
  assert.equal(toTitle('my-app'), 'My App');
  assert.equal(toTitle('billover'), 'Billover');
  assert.equal(toTitle('a-b-c'), 'A B C');
});

test('deriveTokens derives title, scope and db name from the project name', () => {
  const t = deriveTokens({ name: 'my-app' });
  assert.equal(t.__FORGE_NAME__, 'my-app');
  assert.equal(t.__FORGE_TITLE__, 'My App');
  assert.equal(t.__FORGE_SCOPE__, '@my-app');
  assert.equal(t.__FORGE_DB_NAME__, 'my_app');
  assert.equal(t.__FORGE_DESCRIPTION__, '');
});

test('deriveTokens lets explicit answers win over derived ones', () => {
  const t = deriveTokens({
    name: 'my-app', title: 'Custom Title', scope: '@other',
    description: 'Hello.', dbName: 'custom_db',
  });
  assert.equal(t.__FORGE_TITLE__, 'Custom Title');
  assert.equal(t.__FORGE_SCOPE__, '@other');
  assert.equal(t.__FORGE_DESCRIPTION__, 'Hello.');
  assert.equal(t.__FORGE_DB_NAME__, 'custom_db');
});

test('deriveTokens requires a name', () => {
  assert.throws(() => deriveTokens({}), /name is required/);
});

test('substitute replaces known tokens and leaves unknown ones for the guard', () => {
  const out = substitute('a=__FORGE_NAME__ b=__FORGE_NOPE__', { __FORGE_NAME__: 'my-app' });
  assert.equal(out, 'a=my-app b=__FORGE_NOPE__');
});

test('substitute replaces every occurrence', () => {
  const out = substitute('__FORGE_NAME__/__FORGE_NAME__', { __FORGE_NAME__: 'x' });
  assert.equal(out, 'x/x');
});

test('findUnresolved reports only forge tokens, never other dunder identifiers', () => {
  assert.deepEqual(findUnresolved('window.__NUXT__ and __dirname and __filename'), []);
  assert.deepEqual(findUnresolved('x __FORGE_MISSING__ y __FORGE_MISSING__'), ['__FORGE_MISSING__']);
});
