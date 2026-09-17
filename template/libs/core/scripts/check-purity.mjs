#!/usr/bin/env node
/**
 * Core purity, prose edition.
 *
 * The purity rule forbids naming framework or transport specifics in libs/core —
 * in comments and TSDoc, not only in imports. Lint covers imports; this covers
 * the words. Only a real `http(s)://` link span is stripped before matching,
 * since a `@see https://...` link is a reference, but prose sharing that line
 * must stay under scrutiny. Any other `scheme://` is left alone on purpose —
 * stripping arbitrary schemes would let a forbidden word smuggle itself out of
 * the line by posing as one (`jwt://...`).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '..', 'src');

/**
 * Terms that are unambiguous enough to match anywhere, including inside
 * camelCase compounds like `jwtToken`, `SessionCookie` or `useCookie`. A word
 * boundary would miss exactly those, which is how transport vocabulary actually
 * shows up in prose.
 */
const FORBIDDEN = [
  ['jwt', /jwt/i],
  ['cookie', /cookie/i],
  ['typeorm', /typeorm/i],
  ['pinia', /pinia/i],
  ['nuxt', /nuxt/i],
  ['vue', /vue/i],
  ['nestjs', /nest[._-]?js|@nestjs/i],
  // Unambiguous once real documentation links have been stripped from the line.
  ['http', /https?/i],
  // `express` is an ordinary English verb ("must express the invariant"), so the
  // lowercase word is allowed. The capitalised proper noun is the framework, and
  // naming a consumer's framework in core prose is exactly what K2 forbids.
  // Accepted trade-off: a sentence that *begins* with the verb ("Express the
  // invariant clearly.") will be flagged; rewording one line is cheaper than
  // silently permitting transport coupling. No `/i` flag — that is deliberate.
  ['express', /express\.?js|@express\b|\bExpress\b/],
];

/**
 * Only real documentation links are stripped. Matching any `scheme://token`
 * would let a forbidden word smuggle itself out of the line by posing as a
 * scheme — `jwt://the-session-token` would erase the very word being checked.
 */
const URL_PATTERN = /\bhttps?:\/\/\S*/gi;

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && full.endsWith('.ts')) yield full;
  }
}

const violations = [];

for await (const file of walk(SRC)) {
  const lines = (await fs.readFile(file, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    // Strip only the URL span, not the whole line: a @see link is a reference,
    // but prose sharing that line must stay under scrutiny.
    const prose = line.replace(URL_PATTERN, '');
    for (const [word, pattern] of FORBIDDEN) {
      if (pattern.test(prose)) {
        violations.push(`${path.relative(SRC, file)}:${index + 1}  ${word}  ${line.trim()}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error('libs/core purity violations — core must not name its consumers:\n');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}

console.log('libs/core purity: clean');
