import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inSubset, copySubset } from '../../tools/create/subset.mjs';
import { walk } from '../../tools/create/copy.mjs';
import { fileURLToPath } from 'node:url';
import { tempDirFactory } from '../helpers/temp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tempDir = tempDirFactory('forge-subset-');

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

test('copySubset reports what it wrote before aborting on an unresolved token', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.mkdir(path.join(src, 'docs/standards'), { recursive: true });
  await fs.writeFile(path.join(src, 'docs/standards/a-good.md'), 'fine: __FORGE_TITLE__');
  await fs.writeFile(path.join(src, 'docs/standards/b-bad.md'), 'broken: __FORGE_MISSING__');

  let caughtError;
  try {
    await copySubset(src, dest, { __FORGE_TITLE__: 'My App' });
    assert.fail('expected an error');
  } catch (error) {
    caughtError = error;
  }

  assert.deepEqual(caughtError.tokens, ['__FORGE_MISSING__']);
  assert.ok(Array.isArray(caughtError.written), 'the error must carry what was written');
  // Order-independent: the reported list must match what actually landed.
  const onDisk = [];
  for await (const rel of walk(dest)) onDisk.push(rel);
  assert.deepEqual([...caughtError.written].sort(), onDisk.sort());
});

test('copySubset guards unresolved tokens in destination paths, not only contents', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.mkdir(path.join(src, 'docs/standards'), { recursive: true });
  await fs.writeFile(path.join(src, 'docs/standards/__FORGE_MISSING__.md'), 'contents are fine');

  await assert.rejects(
    () => copySubset(src, dest, { __FORGE_TITLE__: 'My App' }),
    (error) => {
      assert.deepEqual(error.tokens, ['__FORGE_MISSING__']);
      return true;
    },
  );
});

// The rule in `subset.mjs`: an ADR is adoptable only if it would still be true in a repo
// that took the agents and the standards and nothing else. The platform ADRs (0005-0008 —
// identity, authorization, tenancy, ports) are not, and must never drift into the subset.
//
// Derived from the template tree rather than from a hardcoded list, so it keeps working when
// a ninth ADR is written: whatever ADRs exist, only the five named in PROCESS_SUBSET may be
// adoptable. The assertion that ADRs were found at all is what stops this passing by
// scanning nothing.
test('only the process ADRs are adoptable — a platform ADR never is', async () => {
  const adrDir = path.join(here, '../../template/docs/adrs');
  const adrs = (await fs.readdir(adrDir)).filter((name) => name.endsWith('.md')).sort();
  assert.ok(adrs.length > 5, `expected the template to have ADRs; found ${adrs.length}`);

  const adoptable = adrs.filter((name) => inSubset(`docs/adrs/${name}`));
  assert.deepEqual(adoptable, [
    '0000-template.md',
    '0001-single-source-documentation.md',
    '0002-consolidated-agent-roster.md',
    '0003-architecture-docs-describe-boundaries.md',
    '0004-api-reference-lives-with-implementation.md',
  ], 'the set of adoptable ADRs changed — apply the rule in subset.mjs and update both');

  // Said separately and positively, because the deepEqual above would also pass if the ADRs
  // it names had been renamed away and the platform ones renamed into their place.
  for (const name of adrs.filter((one) => /^000[5-9]|^00[1-9]\d/.test(one))) {
    assert.equal(
      inSubset(`docs/adrs/${name}`), false,
      `${name} is adoptable; platform ADRs describe this template's architecture, which an `
      + 'adopting repository does not have',
    );
  }
});
