import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { generate } from '../../tools/create/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const forgeRoot = path.resolve(here, '../..');
const templateRoot = path.join(forgeRoot, 'tests/fixtures/mini-template');

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'forge-create-'));
}

test('create mode generates a project with tokens substituted', async () => {
  const out = await tempDir();
  const result = await generate({
    argv: ['--name', 'my-app', '--out', out, '--yes', '--no-git'],
    templateRoot, forgeRoot, interactive: false,
  });

  assert.equal(result.target, path.join(out, 'my-app'));
  assert.equal(
    await fs.readFile(path.join(out, 'my-app/CLAUDE.md'), 'utf8'),
    '# My App\n\n\n',
  );
  const pkg = JSON.parse(await fs.readFile(path.join(out, 'my-app/package.json'), 'utf8'));
  assert.equal(pkg.name, 'my-app');
  assert.equal(pkg.db, 'my_app');
});

test('create mode writes a forge.json receipt', async () => {
  const out = await tempDir();
  await generate({
    argv: ['--name', 'my-app', '--out', out, '--yes', '--no-git'],
    templateRoot, forgeRoot, interactive: false,
  });
  const receipt = JSON.parse(await fs.readFile(path.join(out, 'my-app/forge.json'), 'utf8'));
  assert.equal(receipt.mode, 'create');
  assert.equal(receipt.tokens.__FORGE_NAME__, 'my-app');
});

test('create mode refuses a non-empty target and leaves no staging directory', async () => {
  const out = await tempDir();
  await fs.mkdir(path.join(out, 'my-app'), { recursive: true });
  await fs.writeFile(path.join(out, 'my-app/keep.txt'), 'existing');

  await assert.rejects(
    () => generate({
      argv: ['--name', 'my-app', '--out', out, '--yes', '--no-git'],
      templateRoot, forgeRoot, interactive: false,
    }),
    (error) => { assert.equal(error.exitCode, 2); return true; },
  );

  assert.deepEqual(await fs.readdir(path.join(out, 'my-app')), ['keep.txt']);
  const leftovers = (await fs.readdir(out)).filter((e) => e.startsWith('.forge-staging-'));
  assert.deepEqual(leftovers, []);
});

// D1 — an unresolvable token must fail the run and leave nothing behind
test('D1: an unresolved token fails generation and leaves nothing behind', async () => {
  const out = await tempDir();
  const brokenTemplate = await tempDir();
  await fs.writeFile(path.join(brokenTemplate, 'a.md'), 'x __FORGE_MISSING__');

  await assert.rejects(
    () => generate({
      argv: ['--name', 'my-app', '--out', out, '--yes', '--no-git'],
      templateRoot: brokenTemplate, forgeRoot, interactive: false,
    }),
    (error) => {
      assert.deepEqual(error.tokens, ['__FORGE_MISSING__']);
      assert.equal(error.exitCode, 1);
      return true;
    },
  );

  assert.deepEqual(await fs.readdir(out), []);
});

test('adopt mode copies only the process subset and skips existing files', async () => {
  const existing = await tempDir();
  await fs.writeFile(path.join(existing, 'CLAUDE.md'), 'MINE');

  const result = await generate({
    argv: ['--into', existing, '--yes'],
    templateRoot, forgeRoot, interactive: false,
  });

  assert.equal(result.mode, 'adopt');
  assert.equal(await fs.readFile(path.join(existing, 'CLAUDE.md'), 'utf8'), 'MINE');
  assert.deepEqual(result.skipped, ['CLAUDE.md']);
  assert.ok(result.written.includes('docs/standards/naming.md'));
  await assert.rejects(() => fs.access(path.join(existing, 'package.json')));
});

test('adopt mode derives the project name from the target directory', async () => {
  const parent = await tempDir();
  const existing = path.join(parent, 'billover');
  await fs.mkdir(existing);

  await generate({
    argv: ['--into', existing, '--yes'],
    templateRoot, forgeRoot, interactive: false,
  });

  assert.equal(
    await fs.readFile(path.join(existing, 'docs/standards/naming.md'), 'utf8'),
    'Naming rules for Billover.\n',
  );
});
