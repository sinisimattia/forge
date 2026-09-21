import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * `check-atomic-layers.mjs`'s vacuous-pass guard, run for real.
 *
 * The guard fires when either axis of the scan — components, or pages/layouts — comes back
 * empty, so that a renamed directory or a bad cwd cannot report "clean" for having found
 * nothing. Code review found the `pages`/`layouts` half unreachable in ordinary CI: the
 * real tree always has pages and layouts, so the clause a future edit might delete would never
 * turn CI red. This drives the script itself — not an extracted predicate — against a disposable
 * fixture tree, so the assertion covers both halves the review asked for: that the guard's
 * *condition* is right, and that the script really does exit 1 with that message when it fires.
 *
 * A fixture tree rather than moving `app/pages`/`app/layouts` aside: this suite runs alongside
 * every other one under `npm run test`, and a test that relocates the real tree even briefly is
 * one bad interruption away from leaving the package in a broken state for whoever runs next.
 *
 * `execFile`, not an import: the script is a `#!/usr/bin/env node` CLI that calls `main()` and
 * exits the process on its own, at module load. Importing it would run it (and its
 * `process.exit`) as a side effect of loading the spec file, for the real `app/` tree, before
 * any test had a chance to say which tree it wanted checked.
 */

const SCRIPT = path.resolve(import.meta.dirname, '..', 'check-atomic-layers.mjs');
const run = promisify(execFile);

const ATOM = `<template>
  <button type="button"><slot /></button>
</template>
<script setup lang="ts"></script>
`;

const PAGE = `<template>
  <div>home</div>
</template>
<script setup lang="ts"></script>
`;

/** A fresh fixture root under the OS temp dir, removed by the caller. */
async function makeFixture(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'check-atomic-layers-spec-'));
}

async function writeFile(root: string, relative: string, contents: string): Promise<void> {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
}

describe('check-atomic-layers.mjs — the vacuous-pass guard', () => {
  const fixtures: string[] = [];

  afterEach(async () => {
    while (fixtures.length > 0) {
      const fixture = fixtures.pop();
      if (fixture !== undefined) await fs.rm(fixture, { recursive: true, force: true });
    }
  });

  it('exits 0 and reports both axes when components AND pages/layouts are both present', async () => {
    const root = await makeFixture();
    fixtures.push(root);
    await writeFile(root, 'components/atoms/AppButton.vue', ATOM);
    await writeFile(root, 'pages/index.vue', PAGE);

    const { stdout } = await run('node', [SCRIPT, root]);

    expect(stdout).toContain('Atomic layering: clean (1 component(s) and 1 page(s)/layout(s) checked)');
  });

  it('FAILS with the vacuous-pass message when pages/layouts is empty — the axis review found unreachable', async () => {
    const root = await makeFixture();
    fixtures.push(root);
    await writeFile(root, 'components/atoms/AppButton.vue', ATOM);
    // Deliberately no `pages/` and no `layouts/` under `root` — `routed` resolves to 0.

    await expect(run('node', [SCRIPT, root])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        'Atomic layering: FAILED — nothing was scanned on at least one axis.',
      ),
    });
  });

  it('FAILS with the same message when components is empty — the mirror axis', async () => {
    const root = await makeFixture();
    fixtures.push(root);
    await writeFile(root, 'pages/index.vue', PAGE);
    // Deliberately no `components/` under `root` — `components` resolves to 0.

    await expect(run('node', [SCRIPT, root])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        'Atomic layering: FAILED — nothing was scanned on at least one axis.',
      ),
    });
  });
});
