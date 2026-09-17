#!/usr/bin/env node
/**
 * Extraction gate. The template must carry no trace of the project it was
 * extracted from, and no populated secret. Run before every commit that touches
 * template/, and in CI.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOTS = ['template', 'tools'];

// This file's own rule definitions necessarily spell out every forbidden term
// (in comments and regex literals) — e.g. this comment mentions voku, rsvp,
// stripe, eventId. Scanning tools/ without excluding this file would make the
// gate fail on every clean checkout. Exclude only this exact file, the same
// way a linter excludes its own config from its own rules.
const SELF = path.resolve(fileURLToPath(import.meta.url));

const RULES = [
  ['source-project trace', /voku/i],
  // Terms with no innocent generic use — always a leak.
  ['source-domain term', /\b(rsvp|stripe|organizers?|refunds?|invitations?)\b/i],
  // `event`, `payment` and `ticket` DO have innocent uses ("emitted events" in Vue,
  // "issue tickets"), so flagging the bare word produces false positives. Flag them
  // only in identifier shape, which is how a leaked domain name actually looks —
  // `eventId`, `userPaymentSummaryByEvent`, `events.module.ts`.
  ['source-domain identifier', /\b(event|payment|ticket)(?=[A-Z])/],
  ['source-domain identifier', /[a-z](Event|Payment|Ticket)/],
  ['source-domain module', /\b(event|payment|ticket|invitation)s?\.(module|service|controller|entity)\b/i],
  ['stripe-style key', /\b(sk_|pk_live)/],
  // Only a POPULATED value is a finding — `POSTGRES_PASSWORD=` in .env.example is fine.
  ['populated secret', /(SECRET|PASSWORD|TOKEN|API_KEY)=\S+/],
  ['private key', /BEGIN [A-Z ]*PRIVATE KEY/],
];

async function* walk(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const findings = [];

for (const root of ROOTS) {
  for await (const file of walk(root)) {
    if (path.resolve(file) === SELF) continue;
    const buffer = await fs.readFile(file);
    if (buffer.includes(0)) continue;
    const lines = buffer.toString('utf8').split('\n');
    lines.forEach((line, index) => {
      for (const [label, pattern] of RULES) {
        if (pattern.test(line)) findings.push(`${file}:${index + 1}  ${label}  ${line.trim()}`);
      }
    });
  }
}

if (findings.length > 0) {
  console.error('Sanitization failed:\n');
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(`\n${findings.length} finding(s).`);
  process.exit(1);
}

console.log('Sanitization: clean');
