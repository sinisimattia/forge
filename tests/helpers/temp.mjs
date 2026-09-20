/**
 * Temporary directories that do not survive the run that made them.
 *
 * Every suite here works by building a little tree in `os.tmpdir()` and copying into or out
 * of it. Nothing removed them. Over this repository's life that leaked **2,624 directories
 * totalling 23 GB** on one developer machine — most of them a few kilobytes from the unit
 * tiers, but thirty-four of them a fully installed monorepo at roughly 700 MB each, because
 * the generated-project gate installs `node_modules` into one. The same machine had already
 * had a disk exhaustion crash an unrelated live Postgres mid-transaction, so this is a
 * hazard, not housekeeping.
 *
 * Two properties matter more than the removal itself:
 *
 * 1. **It must survive a failing assertion.** A suite that cleans up only when it passes
 *    leaks precisely when someone is iterating on a broken test — the one time the leak is
 *    fastest. So removal runs from node:test's file-level `after()` hook, which runs whether
 *    the tests passed, failed or threw, rather than from a `finally` in each test.
 * 2. **The removal is asserted, not trusted.** After removing, every path is checked to be
 *    actually gone and the hook fails if any survived. A cleanup nobody has watched fail is
 *    not a cleanup; `sweep` is exported separately and unit-tested against a directory it
 *    genuinely cannot remove, so the assertion has been observed firing.
 *
 * Node builtins only — Forge takes no dependencies (ADR-0002).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

async function exists(target) {
  return fs.access(target).then(() => true, () => false);
}

/**
 * Removes every directory in `dirs`, then asserts each one is gone.
 *
 * A failed removal is collected rather than thrown, so one undeletable directory cannot
 * cause the rest to be skipped — and it still fails the run, via the assertion below, with
 * every surviving path named. Throwing from the first `rm` would both hide the others and
 * report the wrong thing: the fault is "this leaked", not "rm raised EACCES".
 *
 * @param dirs - absolute paths to remove
 */
export async function sweep(dirs) {
  for (const dir of dirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Deliberately swallowed — the assertion below is what reports it, and it reports
      // the condition that matters (the directory is still there) rather than the errno.
    }
  }

  const leaked = [];
  for (const dir of dirs) {
    if (await exists(dir)) leaked.push(dir);
  }

  assert.deepEqual(
    leaked, [],
    'temporary directories survived the run — every one of these is still on disk and '
    + 'nothing will ever remove it',
  );
}

/**
 * Builds a `tempDir()` for one test file and registers the sweep that removes what it made.
 *
 * Call once at module scope: the `after()` hook is a file-level hook, so it must be
 * registered while the file is being loaded, not from inside a test.
 *
 * @param prefix - the `mkdtemp` prefix, e.g. `'forge-copy-'`
 * @returns an async function returning a fresh, registered temporary directory
 */
export function tempDirFactory(prefix) {
  const created = [];

  after(() => sweep(created));

  return async function tempDir() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    created.push(dir);
    return dir;
  };
}
