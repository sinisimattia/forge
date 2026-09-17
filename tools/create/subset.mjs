import fs from 'node:fs/promises';
import path from 'node:path';
import { walk, isBinary, UnresolvedTokenError } from './copy.mjs';
import { substitute, findUnresolved } from './tokens.mjs';

/**
 * The "how we work" layer, adoptable into a repository that already exists.
 * A trailing slash means "this directory and everything under it".
 */
export const PROCESS_SUBSET = [
  'CLAUDE.md',
  '.claude/agents/',
  '.claude/agent-memory/',
  'docs/standards/',
  'docs/adrs/0000-template.md',
  'docs/adrs/0001-single-source-documentation.md',
  'docs/adrs/0002-consolidated-agent-roster.md',
  'docs/adrs/0003-architecture-docs-describe-boundaries.md',
  'docs/adrs/0004-api-reference-lives-with-implementation.md',
];

export function inSubset(rel) {
  return PROCESS_SUBSET.some((entry) =>
    entry.endsWith('/') ? rel.startsWith(entry) : rel === entry,
  );
}

/**
 * Copies the process subset into an existing repository. Existing files are
 * never overwritten — they are reported so the caller can list them.
 */
export async function copySubset(srcRoot, destRoot, tokens) {
  const written = [];
  const skipped = [];

  try {
    for await (const rel of walk(srcRoot)) {
      if (!inSubset(rel)) continue;

      const destRel = substitute(rel, tokens);

      // Guard the path as well as the contents, exactly as copyTree does.
      const leftoverInPath = findUnresolved(destRel);
      if (leftoverInPath.length > 0) throw new UnresolvedTokenError(leftoverInPath, `path "${rel}"`);

      const destAbs = path.join(destRoot, destRel);

      const exists = await fs.access(destAbs).then(() => true, () => false);
      if (exists) { skipped.push(destRel); continue; }

      const buffer = await fs.readFile(path.join(srcRoot, rel));
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
  } catch (error) {
    // Adopt mode has no staging directory — it writes into the user's real
    // repository. Never roll back: deleting their files is worse than leaving
    // ours. Instead, tell them exactly what landed before the abort.
    error.written = written;
    error.skipped = skipped;
    throw error;
  }

  return { written, skipped };
}
