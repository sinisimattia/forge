import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inSubset, copySubset } from '../../tools/create/subset.mjs';

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'forge-subset-'));
}

test('inSubset accepts process files and rejects application code', () => {
  assert.equal(inSubset('CLAUDE.md'), true);
  assert.equal(inSubset('.claude/agents/planner.md'), true);
  assert.equal(inSubset('docs/standards/naming.md'), true);
  assert.equal(inSubset('docs/adrs/0000-template.md'), true);
  assert.equal(inSubset('docs/adrs/0001-single-source-documentation.md'), true);

  assert.equal(inSubset('package.json'), false);
  assert.equal(inSubset('apps/backend/src/main.ts'), false);
  assert.equal(inSubset('libs/core/src/shared/errors/DomainError.ts'), false);
  assert.equal(inSubset('docs/rfcs/README.md'), false);
});

test('copySubset writes only subset files and substitutes tokens', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.mkdir(path.join(src, '.claude/agents'), { recursive: true });
  await fs.writeFile(path.join(src, 'CLAUDE.md'), '# __FORGE_TITLE__');
  await fs.writeFile(path.join(src, '.claude/agents/planner.md'), 'plan for __FORGE_TITLE__');
  await fs.writeFile(path.join(src, 'package.json'), '{}');

  const result = await copySubset(src, dest, { __FORGE_TITLE__: 'My App' });

  assert.equal(await fs.readFile(path.join(dest, 'CLAUDE.md'), 'utf8'), '# My App');
  assert.deepEqual(result.written.sort(), ['.claude/agents/planner.md', 'CLAUDE.md']);
  await assert.rejects(() => fs.access(path.join(dest, 'package.json')));
});

test('copySubset never overwrites an existing file and reports it as skipped', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.writeFile(path.join(src, 'CLAUDE.md'), '# __FORGE_TITLE__');
  await fs.writeFile(path.join(dest, 'CLAUDE.md'), 'ORIGINAL — DO NOT TOUCH');

  const result = await copySubset(src, dest, { __FORGE_TITLE__: 'My App' });

  assert.equal(await fs.readFile(path.join(dest, 'CLAUDE.md'), 'utf8'), 'ORIGINAL — DO NOT TOUCH');
  assert.deepEqual(result.skipped, ['CLAUDE.md']);
  assert.deepEqual(result.written, []);
});
