#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs, UsageError } from './args.mjs';
import { deriveTokens, toTitle } from './tokens.mjs';
import { copyTree } from './copy.mjs';
import { copySubset } from './subset.mjs';
import { buildReceipt } from './receipt.mjs';
import { forgeCommit, initRepo } from './git.mjs';
import { collectAnswers } from './prompts.mjs';

class TargetConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TargetConflictError';
    this.exitCode = 2;
  }
}

async function isEmptyDir(dir) {
  try {
    return (await fs.readdir(dir)).length === 0;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

async function dirExists(dir) {
  try {
    await fs.access(dir);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function createProject({ args, templateRoot, forgeRoot, interactive }) {
  const answers = await collectAnswers(args, { interactive });
  const tokens = deriveTokens(answers);
  const target = path.resolve(args.out, answers.name);

  if (!(await isEmptyDir(target))) {
    throw new TargetConflictError(
      `Target ${target} already exists and is not empty. Move it aside or choose another --name.`,
    );
  }

  // Stage as a sibling of the target so the final move is a real atomic rename.
  // os.tmpdir() is often a different filesystem, where fs.rename fails with EXDEV.
  await fs.mkdir(args.out, { recursive: true });
  const staging = await fs.mkdtemp(path.join(args.out, '.forge-staging-'));

  try {
    const written = await copyTree(templateRoot, staging, tokens);

    const receipt = buildReceipt({
      forgeCommit: await forgeCommit(forgeRoot),
      mode: 'create',
      tokens,
    });
    await fs.writeFile(path.join(staging, 'forge.json'), `${JSON.stringify(receipt, null, 2)}\n`);

    // No `fs.rm(target)` here on purpose. `isEmptyDir` above guarantees the
    // target is absent or empty, and rename() replaces an empty directory
    // atomically. Deleting first would open the exact delete-then-fail window
    // that staging-as-a-sibling exists to close.
    await fs.rename(staging, target);

    if (args.git) await initRepo(target, tokens.__FORGE_TITLE__);

    return { mode: 'create', target, written: [...written, 'forge.json'], skipped: [] };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function adoptInto({ args, templateRoot, forgeRoot }) {
  const target = path.resolve(args.into);
  if (!(await dirExists(target))) {
    throw new TargetConflictError(`${target} does not exist — use create mode instead.`);
  }

  const name = args.name ?? path.basename(target);
  const tokens = deriveTokens({ name, title: args.title ?? toTitle(name) });
  const { written, skipped } = await copySubset(templateRoot, target, tokens);

  return { mode: 'adopt', target, written, skipped, forgeCommit: await forgeCommit(forgeRoot) };
}

/** Programmatic entry point — the CLI is a thin wrapper around this. */
export async function generate({ argv, templateRoot, forgeRoot, interactive = true }) {
  const args = parseArgs(argv);
  return args.mode === 'adopt'
    ? adoptInto({ args, templateRoot, forgeRoot })
    : createProject({ args, templateRoot, forgeRoot, interactive });
}

async function main() {
  const forgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const templateRoot = path.join(forgeRoot, 'template');

  try {
    const result = await generate({ argv: process.argv.slice(2), templateRoot, forgeRoot });

    if (result.mode === 'create') {
      process.stdout.write(`\nCreated ${result.target} (${result.written.length} files)\n\n`);
      process.stdout.write('Next steps:\n');
      process.stdout.write(`  cd ${result.target}\n  npm install\n  npm run dev:up\n\n`);
    } else {
      process.stdout.write(`\nAdopted the process layer into ${result.target}\n`);
      process.stdout.write(`  ${result.written.length} file(s) written\n`);
      if (result.skipped.length > 0) {
        process.stdout.write(`  ${result.skipped.length} left untouched (already present):\n`);
        for (const rel of result.skipped) process.stdout.write(`    ${rel}\n`);
      }
      process.stdout.write('\n');
    }
  } catch (error) {
    process.stderr.write(`\n${error.message}\n`);
    // copySubset attaches what it managed to write before aborting. Adopt mode
    // writes into a real repository and never deletes, so say what landed.
    if (Array.isArray(error.written) && error.written.length > 0) {
      process.stderr.write(`\n${error.written.length} file(s) were written before this failed:\n`);
      for (const rel of error.written) process.stderr.write(`    ${rel}\n`);
      process.stderr.write('Nothing was deleted. Review them before re-running.\n');
    }
    process.stderr.write('\n');
    if (error instanceof UsageError) {
      process.stderr.write('Usage:\n');
      process.stderr.write('  npm run create -- --name <kebab> [--title <s>] [--scope <@s>]\n');
      process.stderr.write('                    [--description <s>] [--db-name <s>] [--out <dir>]\n');
      process.stderr.write('                    [--no-git] [--yes]\n');
      process.stderr.write('  npm run create -- --into <existing-dir>\n\n');
    }
    process.exit(error.exitCode ?? 3);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
