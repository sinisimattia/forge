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
  // \b, so `EventsModule` matches as well as bare `Event` — but a bare trailing
  // boundary would also match the ordinary English word "Eventually"/"Eventual",
  // so that one stem is explicitly excluded. `Payment`/`Ticket` have no comparable
  // innocent derivative, so they keep no exclusion. Verified zero false positives
  // against the shipped template (no capitalized Event/Payment/Ticket appears
  // anywhere in prose there today), and verified "Eventually"/"Eventual" do NOT
  // match while `EventsModule`/`interface Event`/`PaymentService`/`Payments`/
  // `TicketingModule` still do.
  ['source-domain type name', /\bEvent(?!ual)|\b(Payment|Ticket)/],
  // UPPER_SNAKE domain constants — EventEmitter event names, enum members
  // (`EVENT_CREATED`, `PAYMENT_STATUS`, `TICKET_ISSUED`). Uppercase-plus-underscore
  // is unambiguous, so this needs no innocent-word exclusion the way the bare
  // PascalCase stems above do.
  ['source-domain constant', /\b(EVENT|PAYMENT|TICKET|INVITATION|REFUND)_/],
  ['source-domain module', /\b(event|payment|ticket|invitation)s?\.(module|service|controller|entity|repository|guard|dto|resolver|interceptor|pipe|strategy|gateway)\b/i],
  ['stripe-style key', /\b(sk_|pk_live)/],
  // YAML's `KEY: value` is as common as `KEY=value` in the scanned files, and a real
  // password pasted into compose.yaml would take that form. Exempt only what cannot be
  // a secret: an unsubstituted token, a ${...} interpolation, or an empty value. A
  // deliberate literal must carry an explicit `sanitize:allow` marker so every
  // exemption is greppable and reviewable rather than invisible (see
  // stripInterpolations below for why ${...} spans are stripped before this rule
  // runs, not just checked for at the match site). Case-insensitive: a Nest/Nuxt
  // codebase's conventional casing is `password:`/`{ password: ... }`, not just
  // `PASSWORD=`; verified the only case-insensitive matches in the template today
  // are the `${...}` interpolations and `__FORGE_NAME__` token, both already exempt.
  // Key list widened beyond the four original names to the other plausible shapes a
  // real credential takes. `CREDENTIALS?` was proposed alongside these but is
  // deliberately left out: tested against the real template it false-positives on
  // `apps/backend/src/main.ts`'s `app.enableCors({ ..., credentials: true })` — a
  // NestJS/fetch boolean config flag, not a secret value, and a name that common in
  // this stack's own framework config. `PRIVATE_KEY`/`ACCESS_KEY`/`DB_PASS` carry no
  // such conflict and are included.
  ['populated secret', /(SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY|ACCESS_KEY|DB_PASS)\s*[:=]\s*(?!__FORGE_|\$\{|\s*$)\S+/i],
  ['private key', /BEGIN [A-Z ]*PRIVATE KEY/],
];

// Path-only: a bare `event`/`payment`/`ticket` is restricted to identifier shape in
// RULES above specifically to avoid flagging legitimate prose ("emitted events",
// "issue tickets") in file *content*. A file path is never prose, so that collision
// risk does not exist there, and a leftover file named for the domain is realistically
// kebab-case (`events-overview.md`), which none of the identifier-shape rules above
// match — they require camelCase, PascalCase, ALL_CAPS, or a dotted module suffix.
// Verified zero false positives against every real path in `template/` and `tools/`
// today (only an injected `events-overview.md` fixture matched).
const PATH_ONLY_RULES = [
  ['source-domain path term', /\b(events?|payments?|tickets?)\b/i],
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

    // A leftover file or directory *named* for the domain leaks via its path alone,
    // even with generic content inside — content-only scanning is blind to that. A
    // path cannot carry an inline `sanitize:allow` marker, so a path finding is never
    // exemptible that way; it is reported with a `(path)` marker in place of a line
    // number to make clear it is not a content hit.
    for (const [label, pattern] of [...RULES, ...PATH_ONLY_RULES]) {
      if (pattern.test(file)) findings.push(`${file}:(path)  ${label}  ${file}`);
    }

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
