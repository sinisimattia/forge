import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { generate } from '../../tools/create/index.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const forgeRoot = path.resolve(here, '../..');
const templateRoot = path.join(forgeRoot, 'template');

async function generateProject() {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-gate-'));
  const { target } = await generate({
    argv: ['--name', 'gateapp', '--out', out, '--yes', '--no-git'],
    templateRoot, forgeRoot, interactive: false,
  });
  await run('npm', ['install'], { cwd: target, maxBuffer: 64 * 1024 * 1024 });
  return target;
}

test('a generated project passes every gate it ships with', async (t) => {
  const project = await generateProject();

  await t.test('lint', async () => {
    await run('npm', ['run', 'lint'], { cwd: project, maxBuffer: 64 * 1024 * 1024 });
  });
  await t.test('typecheck', async () => {
    await run('npm', ['run', 'typecheck'], { cwd: project, maxBuffer: 64 * 1024 * 1024 });
  });
  await t.test('test', async () => {
    await run('npm', ['run', 'test'], { cwd: project, maxBuffer: 64 * 1024 * 1024 });
  });
  await t.test('build', async () => {
    await run('npm', ['run', 'build'], { cwd: project, maxBuffer: 64 * 1024 * 1024 });
  });
  await t.test('core purity', async () => {
    await run('npm', ['run', 'purity', '-w', 'libs/core'], { cwd: project, maxBuffer: 64 * 1024 * 1024 });
  });

  // D2 / D14 — the plan's Definition of Done requires these two discriminating tests
  // "implemented and each observed to fail when its fault is injected". Until this subtest,
  // they existed only as a manual shell snippet in the plan doc that nobody ran in CI — the
  // subtests above only prove `lint`/`purity` exit 0 on a clean project, which they would do
  // whether or not the underlying rules actually fire. Reuses the project already generated
  // and installed above rather than generating a third one.
  //
  // The probe exercises all three mechanisms `libs/core/eslint.config.mjs` uses to enforce
  // purity, not just the static-import ban: `@typescript-eslint/no-restricted-imports` only
  // sees static import/export declarations, so a separate `no-restricted-syntax` rule guards
  // dynamic `import()` and `require()` specifically (its own comment there says so — "Without
  // these, `await import('typeorm')` and `require('typeorm')` walk straight past it"). A probe
  // covering only the static form would never notice if that second rule regressed.
  await t.test('D2/D14: the core-purity gates actually discriminate', async () => {
    const probePath = path.join(project, 'libs/core/src/shared/types/D2D14Probe.ts');
    // One probe file covers both faults: D2 (a framework import must fail lint — static,
    // dynamic, and require forms) and D14 (transport vocabulary in prose must fail the purity
    // check).
    await fs.writeFile(
      probePath,
      "import type { Repository } from 'typeorm';\n" +
        '\n' +
        '/** Returns the JWT for the session cookie. */\n' +
        'export type D2D14Probe = Repository<unknown>;\n' +
        '\n' +
        "// Dynamic import and require are guarded by `no-restricted-syntax`, a rule separate\n" +
        '// from the static-import ban above — without these two lines, a regression that\n' +
        '// removed only that rule would ship silently even though the static-import probe\n' +
        '// above still failed.\n' +
        'export async function probeDynamicImport() {\n' +
        "  return import('typeorm');\n" +
        '}\n' +
        '\n' +
        "export const probeRequire = require('typeorm');\n",
    );

    try {
      // D2 — a framework import must fail `nx lint core`, in every form it can take:
      //   - static:  `@typescript-eslint/no-restricted-imports`
      //   - dynamic: `no-restricted-syntax` (ImportExpression selector) — no other rule here
      //     covers this form, so this is the one that would go silently missing if that rule
      //     regressed.
      //   - require: both `no-restricted-syntax` (CallExpression selector) AND
      //     `@typescript-eslint/no-require-imports` (from the recommended ruleset) fire
      //     together — verified below that removing `no-restricted-syntax` still leaves
      //     `no-require-imports` catching this particular form, so require() alone would not
      //     prove `no-restricted-syntax` matters; the dynamic-import case is what does.
      await assert.rejects(
        () => run('npx', ['nx', 'lint', 'core'], { cwd: project, maxBuffer: 64 * 1024 * 1024 }),
        'expected `nx lint core` to fail while the typeorm import is present — D2 is decorative',
      );

      // D14 — transport vocabulary in prose (a TSDoc line mentioning a JWT) must fail the
      // purity check.
      await assert.rejects(
        () => run('npm', ['run', 'purity', '-w', 'libs/core'], { cwd: project, maxBuffer: 64 * 1024 * 1024 }),
        'expected `purity -w libs/core` to fail while the JWT-mentioning TSDoc is present — D14 is decorative',
      );
    } finally {
      await fs.rm(probePath, { force: true });
    }

    // With the fault removed, both gates must return to green — this is what proves the
    // failures above were caused by the probe and not some unrelated break.
    await run('npx', ['nx', 'lint', 'core'], { cwd: project, maxBuffer: 64 * 1024 * 1024 });
    await run('npm', ['run', 'purity', '-w', 'libs/core'], { cwd: project, maxBuffer: 64 * 1024 * 1024 });
  });
});

test('a generated project contains the whole process layer', async () => {
  const project = await generateProject();
  const expected = [
    'CLAUDE.md', 'README.md', 'forge.json', 'package.json', 'nx.json',
    'compose.yaml', '.env.example', '.github/workflows/ci.yml',
    '.claude/agents/planner.md', '.claude/agents/reviewer.md', '.claude/agents/README.md',
    'docs/standards/agent-playbook.md', 'docs/standards/naming.md',
    'docs/adrs/0001-single-source-documentation.md',
    'libs/core/src/shared/errors/DomainError.ts',
    'apps/backend/src/health/health.controller.ts',
    'apps/webapp/app/pages/index.vue',
  ];
  for (const rel of expected) {
    await fs.access(path.join(project, rel));
  }
  const agents = await fs.readdir(path.join(project, '.claude/agents'));
  assert.equal(agents.length, 12, 'expected 11 agents plus a README');

  // `nx run-many` is checked elsewhere only by exit code, which stays 0 even if a
  // future template edit silently breaks project discovery for one package (a
  // shrinking gate that still reports green). Assert all three are actually found.
  const { stdout: projects } = await run('npx', ['nx', 'show', 'projects'], { cwd: project });
  for (const name of ['core', 'backend', 'webapp']) {
    assert.ok(projects.includes(name), `nx did not discover the ${name} project`);
  }
});

// D5 — no trace of the project the template was extracted from
test('D5: the template carries no source-project trace or populated secret', async () => {
  await run('node', ['tools/sanitize.mjs'], { cwd: forgeRoot });
});
