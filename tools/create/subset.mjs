import fs from 'node:fs/promises';
import path from 'node:path';
import { walk, isBinary, UnresolvedTokenError } from './copy.mjs';
import { substitute, findUnresolved } from './tokens.mjs';

/**
 * The "how we work" layer, adoptable into a repository that already exists.
 * A trailing slash means "this directory and everything under it".
 *
 * **The rule for ADRs, which is why this list stops at `0004`.** An ADR belongs here when it
 * records how a team works — how it documents decisions, how its agents are organised, where
 * architecture and API docs live. An ADR does NOT belong here when it records a decision
 * about *this template's* architecture: identity being separate from user, authorization
 * being a pure function, tenancy being explicit, mail leaving through a port. Those are true
 * of a project generated from this template and false of a repository that adopted only the
 * process layer — shipping them would hand somebody four confident claims about a system
 * they do not have. That is the whole test to apply: **would this ADR still be true in a
 * repository that took the agents and the standards and nothing else?**
 *
 * By that rule `0000`–`0004` are in and `0005`–`0008` are out, and a new ADR is out unless
 * someone adds it here deliberately. The list stays an explicit enumeration rather than a
 * range or a glob precisely so that defaulting to "out" is what happens when nobody thinks
 * about it: a range would silently adopt the next platform ADR the day it is written.
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
