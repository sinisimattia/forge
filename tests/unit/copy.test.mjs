import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isBinary, walk, copyTree, UnresolvedTokenError, UnsupportedEntryError,
} from '../../tools/create/copy.mjs';
import { tempDirFactory } from '../helpers/temp.mjs';

const tempDir = tempDirFactory('forge-copy-');

test('isBinary detects a NUL byte and passes plain text', () => {
  assert.equal(isBinary(Buffer.from('hello world')), false);
  assert.equal(isBinary(Buffer.from([0x68, 0x00, 0x69])), true);
});

test('isBinary only inspects the first 8 KiB', () => {
  const buffer = Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from([0x00])]);
  assert.equal(isBinary(buffer), false);
});

test('walk yields nested files as posix relative paths', async () => {
  const dir = await tempDir();
  await fs.mkdir(path.join(dir, 'a', 'b'), { recursive: true });
  await fs.writeFile(path.join(dir, 'root.txt'), 'x');
  await fs.writeFile(path.join(dir, 'a', 'b', 'deep.txt'), 'y');
  const found = [];
  for await (const rel of walk(dir)) found.push(rel);
  assert.deepEqual(found.sort(), ['a/b/deep.txt', 'root.txt']);
});

test('copyTree substitutes in file contents', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.writeFile(path.join(src, 'readme.md'), '# __FORGE_TITLE__');
  await copyTree(src, dest, { __FORGE_TITLE__: 'My App' });
  assert.equal(await fs.readFile(path.join(dest, 'readme.md'), 'utf8'), '# My App');
});

test('copyTree substitutes in path segments', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.mkdir(path.join(src, '__FORGE_NAME__-docs'), { recursive: true });
  await fs.writeFile(path.join(src, '__FORGE_NAME__-docs', '__FORGE_NAME__.md'), 'x');
  await copyTree(src, dest, { __FORGE_NAME__: 'my-app' });
  const written = await fs.readFile(path.join(dest, 'my-app-docs', 'my-app.md'), 'utf8');
  assert.equal(written, 'x');
});

test('copyTree copies binary files byte-for-byte without substituting', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  const bytes = Buffer.from([0x89, 0x50, 0x00, 0x5f, 0x5f]);
  await fs.writeFile(path.join(src, 'logo.png'), bytes);
  await copyTree(src, dest, { __FORGE_NAME__: 'my-app' });
  assert.deepEqual(await fs.readFile(path.join(dest, 'logo.png')), bytes);
});

test('copyTree fails when a forge token cannot be resolved', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.writeFile(path.join(src, 'a.txt'), 'x __FORGE_MISSING__');
  await assert.rejects(
    () => copyTree(src, dest, { __FORGE_NAME__: 'my-app' }),
    (error) => {
      assert.ok(error instanceof UnresolvedTokenError);
      assert.deepEqual(error.tokens, ['__FORGE_MISSING__']);
      assert.equal(error.exitCode, 1);
      return true;
    },
  );
});

test('walk fails loudly on a symlink instead of silently dropping it', async () => {
  // A Dirent for a symlink reports neither isFile() nor isDirectory() — a symlink added to
  // template/ would otherwise vanish from every generated project with no message. Assert it
  // is instead treated as a build error, the same way an unresolved token is.
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, 'real.txt'), 'x');
  await fs.symlink(path.join(dir, 'real.txt'), path.join(dir, 'link.txt'));
  await assert.rejects(
    async () => { for await (const _rel of walk(dir)) { /* drain */ } },
    (error) => {
      assert.ok(error instanceof UnsupportedEntryError);
      assert.equal(error.exitCode, 1);
      assert.match(error.message, /link\.txt/);
      return true;
    },
  );
});

test('copyTree does not trip on non-forge dunder identifiers', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.writeFile(path.join(src, 'a.js'), 'window.__NUXT__; __dirname;');
  await copyTree(src, dest, {});
  assert.equal(await fs.readFile(path.join(dest, 'a.js'), 'utf8'), 'window.__NUXT__; __dirname;');
});
