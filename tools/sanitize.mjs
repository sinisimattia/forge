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
  // PascalCase type names are how a domain leak really looks — `EventsModule`,
  // `PaymentService`, `interface Event`. The two rules above both miss these: one
  // needs a lowercase prefix, the other a preceding lowercase letter. No trailing
  // anchor, so `EventsModule` matches as well as bare `Event`. Verified zero false
  // positives against the shipped template (no capitalized Event/Payment/Ticket
  // appears anywhere in prose there).
  ['source-domain type name', /\b(Event|Payment|Ticket)/],
  ['source-domain module', /\b(event|payment|ticket|invitation)s?\.(module|service|controller|entity|repository|guard|dto|resolver|interceptor|pipe|strategy|gateway)\b/i],
  ['stripe-style key', /\b(sk_|pk_live)/],
  // YAML's `KEY: value` is as common as `KEY=value` in the scanned files, and a real
  // password pasted into compose.yaml would take that form. Exempt only what cannot be
  // a secret: an unsubstituted token, a ${...} interpolation, or an empty value. A
  // deliberate literal must carry an explicit `sanitize:allow` marker so every
  // exemption is greppable and reviewable rather than invisible (see
  // stripInterpolations below for why ${...} spans are stripped before this rule
  // runs, not just checked for at the match site).
  ['populated secret', /(SECRET|PASSWORD|TOKEN|API_KEY)\s*[:=]\s*(?!__FORGE_|\$\{|\s*$)\S+/],
  ['private key', /BEGIN [A-Z ]*PRIVATE KEY/],
];

// The populated-secret rule is tested against this stripped view of the line, not the
// raw line. Reason: `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}` contains the
// word PASSWORD twice — once as the YAML key (exempt, its value is an interpolation),
// once *inside* that interpolation's own `:?required` bash default-value operator. A
// lookahead anchored only at the key's match site cannot see that the second
// occurrence is nested inside a `${...}` span rather than a real `KEY: value` pair, so
// it still finds a "populated" value (`?required}`) and false-positives. Stripping every
// `${...}` span first removes the nested occurrence entirely, so only genuine
// `KEY: literal` pairs remain to match.
function stripInterpolations(line) {
  return line.replace(/\$\{[^}]*\}/g, '');
}

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
const exemptions = [];

for (const root of ROOTS) {
  for await (const file of walk(root)) {
    if (path.resolve(file) === SELF) continue;
    const buffer = await fs.readFile(file);
    if (buffer.includes(0)) continue;
    const lines = buffer.toString('utf8').split('\n');
    lines.forEach((line, index) => {
      // A marked line is a deliberate, reviewed exemption — skip every rule for it,
      // but record it so it shows up in the run's output rather than vanishing silently.
      if (line.includes('sanitize:allow')) {
        exemptions.push(`${file}:${index + 1}  ${line.trim()}`);
        return;
      }
      const secretProbe = stripInterpolations(line);
      for (const [label, pattern] of RULES) {
        const subject = label === 'populated secret' ? secretProbe : line;
        if (pattern.test(subject)) findings.push(`${file}:${index + 1}  ${label}  ${line.trim()}`);
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

if (exemptions.length > 0) {
  console.log(`Sanitization: clean (${exemptions.length} deliberate exemption(s))`);
  for (const exemption of exemptions) console.log(`  ${exemption}`);
} else {
  console.log('Sanitization: clean');
}
