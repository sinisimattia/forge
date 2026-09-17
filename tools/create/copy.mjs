import fs from 'node:fs/promises';
import path from 'node:path';
import { substitute, findUnresolved } from './tokens.mjs';

const BINARY_SNIFF_BYTES = 8192;

/** A token survived substitution, so the output would be broken. Never emit it. */
export class UnresolvedTokenError extends Error {
  constructor(tokens, where) {
    super(`Unresolved token(s) in ${where}: ${tokens.join(', ')}`);
    this.name = 'UnresolvedTokenError';
    this.tokens = tokens;
    this.exitCode = 1;
  }
}

/** True when the buffer looks binary — a NUL byte in the first 8 KiB. */
export function isBinary(buffer) {
  const end = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** Yields every file under `root` as a posix-style path relative to it. */
export async function* walk(root, prefix = '') {
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield* walk(root, rel);
    } else if (entry.isFile()) {
      yield rel;
    }
  }
}

/**
 * Copies `srcRoot` into `destRoot`, substituting tokens in text contents and in
 * path segments. Binary files are copied verbatim. Throws UnresolvedTokenError
 * rather than writing a file that still contains a forge token.
 */
export async function copyTree(srcRoot, destRoot, tokens) {
  const written = [];

  for await (const rel of walk(srcRoot)) {
    const destRel = substitute(rel, tokens);

    const leftoverInPath = findUnresolved(destRel);
    if (leftoverInPath.length > 0) throw new UnresolvedTokenError(leftoverInPath, `path "${rel}"`);

    const buffer = await fs.readFile(path.join(srcRoot, rel));
    const destAbs = path.join(destRoot, destRel);
    await fs.mkdir(path.dirname(destAbs), { recursive: true });

    if (isBinary(buffer)) {
      await fs.writeFile(destAbs, buffer);
    } else {
      const output = substitute(buffer.toString('utf8'), tokens);
      const leftover = findUnresolved(output);
      if (leftover.length > 0) throw new UnresolvedTokenError(leftover, rel);
      await fs.writeFile(destAbs, output);
    }

    written.push(destRel);
  }

  return written;
}
