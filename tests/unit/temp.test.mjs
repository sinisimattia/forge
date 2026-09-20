import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sweep, tempDirFactory } from '../helpers/temp.mjs';

const tempDir = tempDirFactory('forge-temp-');

async function exists(target) {
  return fs.access(target).then(() => true, () => false);
}

test('sweep removes every directory it is given', async () => {
  const one = await fs.mkdtemp(path.join(await tempDir(), 'a-'));
  const two = await fs.mkdtemp(path.join(await tempDir(), 'b-'));
  await fs.writeFile(path.join(one, 'file.txt'), 'x');
  await fs.mkdir(path.join(two, 'nested', 'deeper'), { recursive: true });

  await sweep([one, two]);

  assert.equal(await exists(one), false);
  assert.equal(await exists(two), false);
});

test('sweep is a no-op on a directory that is already gone', async () => {
  const gone = path.join(await tempDir(), 'never-created');
  await sweep([gone]);
});

// The point of the whole helper. A cleanup that quietly fails is worse than no cleanup: the
// leak continues and the run stays green, so nobody ever looks. `sweep` must FAIL when a
// directory it was asked to remove is still there afterwards.
//
// The fault is injected by taking write permission off the PARENT — removing a directory
// entry needs write permission on the directory holding it, so `fs.rm` raises EACCES and the
// child survives. That is a genuinely undeletable directory, not a stub that pretends to be
// one, which is what makes this an observation rather than a restatement of the code.
test('sweep FAILS when a directory it removed is still there', async () => {
  const parent = await tempDir();
  const trapped = path.join(parent, 'undeletable');
  await fs.mkdir(path.join(trapped, 'contents'), { recursive: true });

  await fs.chmod(parent, 0o555);
  try {
    await assert.rejects(
      () => sweep([trapped]),
      (error) => {
        assert.equal(error.code, 'ERR_ASSERTION', 'sweep threw, but not the leak assertion');
        assert.match(error.message, /temporary directories survived the run/);
        assert.deepEqual(error.actual, [trapped], 'the surviving path must be named');
        return true;
      },
      'sweep reported success for a directory that is demonstrably still on disk',
    );
    assert.equal(await exists(trapped), true, 'the injection itself did not take');
  } finally {
    // Hand the permission back, or the factory's own sweep cannot clean up either — and it
    // would then fail the file, correctly, for a fault this test created on purpose.
    await fs.chmod(parent, 0o755);
  }
});

// One undeletable directory must not stop the others being removed. `sweep` collects the
// failure instead of throwing from the first `rm`, so the run still fails — with every
// surviving path named — but the disk is left as clean as it could be made.
test('sweep removes what it can even when one directory resists', async () => {
  const parent = await tempDir();
  const trapped = path.join(parent, 'undeletable');
  await fs.mkdir(trapped, { recursive: true });
  const removable = await tempDir();

  await fs.chmod(parent, 0o555);
  try {
    await assert.rejects(() => sweep([trapped, removable]));
    assert.equal(await exists(removable), false, 'the removable directory was skipped');
  } finally {
    await fs.chmod(parent, 0o755);
  }
});
