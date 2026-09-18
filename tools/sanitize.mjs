#!/usr/bin/env node
/**
 * Extraction gate. The template must carry no trace of the project it was
 * extracted from, and no populated secret. Run before every commit that touches
 * template/, and in CI.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved against this file's own location, not process.cwd() — `sanitize.mjs`'s one job is to
// fail loudly, and a cwd-relative root would silently scan nothing (and report clean) if this
// script were ever invoked from outside the repo root. `npm run sanitize` always runs from here,
// but that is exactly the kind of assumption this fix exists to stop relying on.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['template', 'tools'].map((root) => path.join(REPO_ROOT, root));

// This file's own rule definitions necessarily spell out every forbidden term
// (in comments and regex literals) — e.g. this comment mentions voku, rsvp,
// stripe, eventId. Scanning tools/ without excluding this file would make the
// gate fail on every clean checkout. Exclude only this exact file, the same
// way a linter excludes its own config from its own rules.
const SELF = path.resolve(fileURLToPath(import.meta.url));

export const RULES = [
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
export const PATH_ONLY_RULES = [
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
export function stripInterpolations(line) {
  return line.replace(/\$\{[^}]*\}/g, '');
}

// The same rule, scanning TypeScript source rather than YAML and env files, matches two
// shapes that cannot carry a credential. Both are stripped from the probe rather than
// exempted at the match site, for the reason stripInterpolations gives: a span-level strip
// handles a line carrying a false positive AND a real secret, where a lookahead anchored at
// one key's match site would skip the whole line. Case-insensitive throughout, including
// the backreference.
//
// Applied to TypeScript source ONLY — see isTypeScriptFile. The justification for each of
// these exemptions is a fact about source code (an enum member published in the source, a
// type annotation), and neither shape exists in YAML or env files, where the rule was
// correct as written. Applying them everywhere silently un-flagged
// `POSTGRES_PASSWORD: "password"` in a compose file, which is the commonest shape a
// weak-but-real credential takes.
const SECRET_KEYS = 'SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY|ACCESS_KEY|DB_PASS';

// A quoted value identical to its own key: a string enum member naming itself
// (`PASSWORD = 'PASSWORD'`). The value is the key's own name, published in the source by
// definition, so there is nothing secret about it. The backreference is what keeps this
// narrow — `PASSWORD = 'hunter2'` does not match it and is still flagged.
//
// The leading boundary matters as much as the backreference. The key alternation is a
// substring match, so without it `POSTGRES_PASSWORD = 'password'` exempts itself: the
// regex starts at the `PASSWORD` inside the longer name and finds a value equal to *that*.
// A key is only self-named when the whole key is the name, so a preceding identifier
// character disqualifies the match. (`\b` would not do it — `_` is a word character, so
// `_PASSWORD` has no boundary before `P`.) The type-annotation rule below deliberately
// keeps no such anchor: `dbPassword: string` is a type annotation like any other, and the
// populated-secret rule it is exempting matches by substring too.
//
// Case-SENSITIVE — the only rule here that is, and the `i` this once carried was a hole.
// JS applies `i` to a backreference too, so `const PASSWORD = 'password'` and
// `password: 'password'` both satisfied `\1` and exempted themselves: a hardcoded dev
// credential in a config object, wearing the enum member's exemption. The justification
// ("the value is the key's own name, published in the source by definition") holds only
// for the shipped shape, which is an UPPER_SNAKE enum member whose value is spelled
// identically — so that is exactly what this matches and nothing else. A self-named member
// in some other casing (`Password = 'Password'`) is flagged, and can carry a
// `sanitize:allow` marker like any other deliberate literal; the gate errs strict.
const SELF_NAMED_VALUE = new RegExp(
  `(?<![A-Za-z0-9_])(${SECRET_KEYS})\\s*[:=]\\s*(['"\`])\\1\\2`,
  'g',
);

// A TypeScript type annotation: `secret: string`, `readonly token: string,`. A type is not
// a value, so nothing is populated. Only the primitive type names are accepted — an
// unrecognised bare word after the colon (`DB_PASS: correct-horse-battery`) is still a
// value and is still flagged. `=` is deliberately absent: an annotation never uses one.
const TYPE_ANNOTATION = new RegExp(
  `(${SECRET_KEYS})\\??\\s*:\\s*(string|number|boolean|bigint|symbol|unknown|Date)(\\[\\])?\\s*(?=[;,)|>]|$)`,
  'gi',
);

/**
 * Removes the two source-code shapes that cannot be a populated secret. Replaced with a
 * space rather than deleted, so stripping never splices two halves of a line into a match
 * that was not there before.
 */
export function stripNonSecrets(line) {
  return line.replace(SELF_NAMED_VALUE, ' ').replace(TYPE_ANNOTATION, ' ');
}

/** Whether a path is TypeScript source — the only file type the two exemptions above apply to. */
export function isTypeScriptFile(file) {
  return /\.tsx?$/.test(file);
}

/**
 * Every rule label a line's *content* trips, in rule order. This is the whole per-line
 * judgement the scan below makes, extracted so it can be exercised directly: a gate whose
 * exemptions can only be tested by writing a fixture file into `template/` is a gate whose
 * exemptions do not get tested.
 *
 * The file is part of the judgement, not decoration: `PASSWORD = 'PASSWORD'` is an enum
 * member in a `.ts` file and a real credential in a compose file. `${...}` stripping is
 * unconditional — it exists *for* YAML — while the two source-code exemptions apply only to
 * TypeScript. Anything whose type is unknown is judged as a non-source file, which is the
 * strict direction.
 *
 * @param line - one raw line, exactly as read from the file
 * @param file - the path it came from; anything but `.ts`/`.tsx` gets the unexempted rule
 * @returns the labels of the rules it matched, possibly empty
 */
export function lineFindings(line, file = '') {
  const interpolationsStripped = stripInterpolations(line);
  const secretProbe = isTypeScriptFile(file)
    ? stripNonSecrets(interpolationsStripped)
    : interpolationsStripped;
  const labels = [];
  for (const [label, pattern] of RULES) {
    const subject = label === 'populated secret' ? secretProbe : line;
    if (pattern.test(subject)) labels.push(label);
  }
  return labels;
}

/**
 * Every rule label a file's *path* trips. Paths are held to the content rules plus the
 * path-only ones, because a path is never prose (see PATH_ONLY_RULES).
 *
 * @param file - a path, absolute or relative
 * @returns the labels it matched, possibly empty
 */
export function pathFindings(file) {
  const labels = [];
  for (const [label, pattern] of [...RULES, ...PATH_ONLY_RULES]) {
    if (pattern.test(file)) labels.push(label);
  }
  return labels;
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

/** The scan itself, exactly as it has always run — see the entry-point guard below. */
async function main() {
  const findings = [];
  const exemptions = [];
  let scannedCount = 0;

  for (const root of ROOTS) {
    for await (const file of walk(root)) {
      if (path.resolve(file) === SELF) continue;
      scannedCount += 1;

      // A leftover file or directory *named* for the domain leaks via its path alone,
      // even with generic content inside — content-only scanning is blind to that. A
      // path cannot carry an inline `sanitize:allow` marker, so a path finding is never
      // exemptible that way; it is reported with a `(path)` marker in place of a line
      // number to make clear it is not a content hit.
      for (const label of pathFindings(file)) {
        findings.push(`${file}:(path)  ${label}  ${file}`);
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
        for (const label of lineFindings(line, file)) {
          findings.push(`${file}:${index + 1}  ${label}  ${line.trim()}`);
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

  // This gate's one job is to fail. A zero count means every root came up empty (a bad
  // cwd, a renamed/missing directory, a walk that silently swallowed a readdir error) —
  // that is not "clean", it is "nothing was scanned", and printing "clean" for it would
  // be a vacuous pass indistinguishable from a real one. Fail loudly instead.
  if (scannedCount === 0) {
    console.error('Sanitization failed: 0 files were scanned — the gate examined nothing.');
    console.error(`Roots checked: ${ROOTS.join(', ')}`);
    process.exit(1);
  }

  if (exemptions.length > 0) {
    console.log(`Sanitization: clean (${scannedCount} file(s) scanned, ${exemptions.length} deliberate exemption(s))`);
    for (const exemption of exemptions) console.log(`  ${exemption}`);
  } else {
    console.log(`Sanitization: clean (${scannedCount} file(s) scanned)`);
  }
}

// Run the scan only when this file is the process's entry point. Importing it — which is
// what lets the rules above be tested at all — must not walk the tree or exit the importer's
// process. `npm run sanitize` still runs exactly what it always did.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === SELF) {
  await main();
}
