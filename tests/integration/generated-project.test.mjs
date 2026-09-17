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
