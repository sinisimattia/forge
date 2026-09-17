#!/usr/bin/env node
/**
 * Core purity, prose edition.
 *
 * The purity rule forbids naming framework or transport specifics in libs/core —
 * in comments and TSDoc, not only in imports. Lint covers imports; this covers
 * the words. Lines containing a URL are exempt, since `https://` in a @see link
 * is a reference, not transport vocabulary.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '..', 'src');

const FORBIDDEN = [
  ['jwt', /\bjwts?\b/i],
  ['cookie', /\bcookies?\b/i],
  ['http', /\bhttps?\b/i],
  ['nestjs', /nest\.?js|@nestjs/i],
  ['nuxt', /\bnuxt\b/i],
  ['vue', /\bvue\b/i],
  ['pinia', /\bpinia\b/i],
  ['typeorm', /\btypeorm\b/i],
  ['express', /\bexpress\b/i],
];

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
    if (line.includes('://')) return;
    for (const [word, pattern] of FORBIDDEN) {
      if (pattern.test(line)) {
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
