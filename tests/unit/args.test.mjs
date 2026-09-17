import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, UsageError } from '../../tools/create/args.mjs';

test('parses create mode with a name', () => {
  const a = parseArgs(['--name', 'my-app']);
  assert.equal(a.mode, 'create');
  assert.equal(a.name, 'my-app');
  assert.equal(a.out, process.cwd());
  assert.equal(a.git, true);
  assert.equal(a.yes, false);
});

test('parses every create flag', () => {
  const a = parseArgs([
    '--name', 'my-app', '--title', 'My App', '--scope', '@acme',
    '--description', 'Hi.', '--db-name', 'my_db', '--out', '/tmp/x',
    '--no-git', '--yes',
  ]);
  assert.deepEqual(
    [a.title, a.scope, a.description, a.dbName, a.out, a.git, a.yes],
    ['My App', '@acme', 'Hi.', 'my_db', '/tmp/x', false, true],
  );
});

test('parses adopt mode', () => {
  const a = parseArgs(['--into', '/tmp/existing']);
  assert.equal(a.mode, 'adopt');
  assert.equal(a.into, '/tmp/existing');
});

test('rejects combining --into with --name or --out', () => {
  assert.throws(() => parseArgs(['--into', '/tmp/x', '--name', 'y']), UsageError);
  assert.throws(() => parseArgs(['--into', '/tmp/x', '--out', '/tmp/y']), UsageError);
});

test('rejects an invalid project name', () => {
  for (const bad of ['My-App', '1app', 'my_app', 'my app', '-leading']) {
    assert.throws(() => parseArgs(['--name', bad]), UsageError, `expected ${bad} to be rejected`);
  }
});

test('rejects an invalid scope or db name', () => {
  assert.throws(() => parseArgs(['--name', 'a', '--scope', 'acme']), UsageError);
  assert.throws(() => parseArgs(['--name', 'a', '--db-name', '1db']), UsageError);
});

test('rejects an unknown flag', () => {
  assert.throws(() => parseArgs(['--nope']), UsageError);
});

test('UsageError carries exit code 1', () => {
  try { parseArgs(['--nope']); assert.fail('should throw'); }
  catch (error) { assert.equal(error.exitCode, 1); }
});
