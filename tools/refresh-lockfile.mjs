#!/usr/bin/env node
/**
 * Regenerates `template/package-lock.json` from scratch.
 *
 * `npm install` cannot be run directly against `template/`'s own package.json files: their
 * `name` fields are still forge tokens (`__FORGE_SCOPE__/backend`, `__FORGE_NAME__`, ...),
 * and a leading `_` is not a legal npm package-name character, so npm fails outright with
 * `EINVALIDPACKAGENAME` before it resolves a single dependency. (This is a real defect in
 * the plan that first asked for "run `npm install` at template/ root" — see
 * `docs/superpowers/lockfile-report.md`.)
 *
 * This script works around that by substituting a throwaway, valid placeholder
 * name/scope/title/description into every `package.json` under `template/`, running
 * `npm install` there, then reversing that exact substitution inside the resulting
 * `package-lock.json` — so the committed file records the real `__FORGE_*__` tokens like
 * every other templated file, ready for the generator's own substitution pass. The original
 * package.json files are restored byte-for-byte afterward, and every install artifact
 * (`node_modules`, `.nuxt`, etc.) is removed — only the lockfile is meant to change.
 *
 * Used by:
 *   - a human running `npm run refresh-lockfile` after changing a template package.json,
 *     then reviewing and committing the diff themselves;
 *   - `.github/workflows/ci.yml`'s weekly `lockfile-refresh` job, which runs this and then
 *     the generated-project gate against the result, and never commits — see that job's
 *     own comment for why.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const forgeRoot = path.resolve(here, '..');
const templateRoot = path.join(forgeRoot, 'template');

// Deliberately unrealistic and mutually distinct — practically impossible to collide with a
// real dependency name, description or URL substring, and no one placeholder's text is a
// substring of another's, so the reverse-substitution below cannot cross-match.
const PLACEHOLDERS = {
  __FORGE_NAME__: 'zzforgelockfilerefreshname',
  __FORGE_SCOPE__: '@zzforgelockfilerefreshscope',
  __FORGE_TITLE__: 'ZzForgeLockfileRefreshTitle',
  __FORGE_DESCRIPTION__: 'Zz Forge Lockfile Refresh Description Placeholder',
};

// Mirrors template/.gitignore's ignored directory names — everything `npm install` (and its
// postinstall scripts, e.g. Nuxt's `nuxt prepare`) can leave behind that must never be
// committed or seen by tools/sanitize.mjs.
const ARTIFACT_DIR_NAMES = ['node_modules', '.nx', 'dist', 'coverage', '.output', '.nuxt', 'storybook-static'];

async function findPackageJsonFiles(root) {
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name === 'package.json') found.push(full);
    }
  }
  await walk(root);
  return found;
}

/** Removes every artifact directory under `root`, without descending into one it just removed. */
async function removeArtifacts(root, maxDepth = 4) {
  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (ARTIFACT_DIR_NAMES.includes(entry.name)) {
        await fs.rm(full, { recursive: true, force: true });
        continue;
      }
      await walk(full, depth + 1);
    }
  }
  await walk(root, 0);
}

async function main() {
  const packageJsonFiles = await findPackageJsonFiles(templateRoot);
  const originals = new Map();

  for (const file of packageJsonFiles) {
    const text = await fs.readFile(file, 'utf8');
    if (!/__FORGE_[A-Z0-9_]*__/.test(text)) continue;
    originals.set(file, text);
    let patched = text;
    for (const [token, value] of Object.entries(PLACEHOLDERS)) patched = patched.split(token).join(value);
    await fs.writeFile(file, patched);
  }

  try {
    const lockPath = path.join(templateRoot, 'package-lock.json');
    await fs.rm(lockPath, { force: true });

    console.log('Running `npm install` in template/ under a placeholder identity...');
    await run('npm', ['install'], { cwd: templateRoot, maxBuffer: 128 * 1024 * 1024 });

    let lockText = await fs.readFile(lockPath, 'utf8');
    for (const [token, value] of Object.entries(PLACEHOLDERS)) lockText = lockText.split(value).join(token);

    // No placeholder may survive, and no OTHER __FORGE_*__ spelling may appear — either would
    // silently trip the generator's own unresolved-token guard on every `forge create`.
    const leftoverPlaceholder = Object.values(PLACEHOLDERS).find((value) => lockText.includes(value));
    if (leftoverPlaceholder) {
      throw new Error(
        `Placeholder "${leftoverPlaceholder}" survived reverse-substitution in package-lock.json — ` +
        'do not commit this output.',
      );
    }
    const unknownTokens = [...new Set(lockText.match(/__FORGE_[A-Z0-9_]*__/g) ?? [])]
      .filter((token) => !Object.hasOwn(PLACEHOLDERS, token));
    if (unknownTokens.length > 0) {
      throw new Error(
        `Unexpected forge token spelling(s) in package-lock.json: ${unknownTokens.join(', ')} — ` +
        'do not commit this output.',
      );
    }

    await fs.writeFile(lockPath, lockText);
    console.log(`Wrote ${lockPath} (${lockText.split('\n').length} lines, ${lockText.length} bytes).`);
  } finally {
    for (const [file, text] of originals) await fs.writeFile(file, text);
    await removeArtifacts(templateRoot);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
