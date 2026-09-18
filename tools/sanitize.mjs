#!/usr/bin/env node
/**
 * Extraction gate. The template must carry no trace of the project it was
 * extracted from, and no populated secret. Run before every commit that touches
 * template/, and in CI.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
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

// The names a credential is actually spelled with. Defined once and shared by the
// populated-secret rules and the self-named-value exemption below, so the two can never
// drift apart — they were once two identical copies of this list, which is exactly the
// arrangement in which one gets extended and the other does not.
//
// Multi-word names tolerate a missing or hyphenated separator (`API_KEY`, `apiKey`,
// `api-key`). The rules are case-insensitive, so spelling the separator `[_-]?` is what
// makes the camelCase form match at all — and camelCase is this stack's conventional
// casing for backend config. Spelled with underscores only, `apiKey`, `accessKey`,
// `privateKey` and `dbPass` slipped the populated-secret rule entirely; the first two
// happened to be caught by the stripe-key and private-key rules, but only because of
// their distinctive *values* — `accessKey: 'AKIAIOSFODNN7EXAMPLE'` and
// `dbPass: 'correct-horse-battery'` were missed outright.
//
// `CREDENTIALS?` was proposed alongside these but is deliberately left out: tested against
// the real template it false-positives on `apps/backend/src/main.ts`'s
// `app.enableCors({ ..., credentials: true })` — a NestJS/fetch boolean config flag, not a
// secret value, and a name that common in this stack's own framework config.
const SECRET_KEYS = 'SECRET|PASSWORD|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|DB[_-]?PASS';

// The populated-secret rule as written for YAML, env and every other non-TypeScript file,
// where an unquoted value genuinely is a literal: anything non-empty after the separator is
// the secret. `KEY: value` is as common as `KEY=value` in the scanned files, and a real
// password pasted into compose.yaml takes exactly that form. Exempt only what cannot be a
// credential: an unsubstituted token, a `${...}` interpolation, or an empty value. A
// deliberate literal must carry an explicit `sanitize:allow` marker so every exemption is
// greppable and reviewable rather than invisible (see stripInterpolations below for why
// `${...}` spans are stripped before this rule runs, not just checked for at the match site).
// Case-insensitive: a Nest/Nuxt codebase's conventional casing is `password:`, not `PASSWORD=`.
//
// DOCUMENTED LIMITATION, deliberate — do not "fix" this. The key must be *immediately*
// followed by the separator, so a key carrying a suffix (`PASSWORD_HASH: 'actual-secret'`)
// is missed, in every file type. Making the key suffix-tolerant — wrapping the alternation
// in `[A-Za-z0-9_]*` — was tested against the whole tree and rejected: it false-positives on
// our own shipped source. Against the gate as it stood before the quoted-literal rule it
// produced ten, led by
// `template/libs/core/src/identities/policies/DEFAULT_PASSWORD_POLICY.ts:25`
// (`export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {`), where the key is a policy
// name and the "value" is a type. The quoted-literal rule below happens to neutralise that
// particular one — its value is unquoted — but not the class: it still flags
// `template/libs/core/tests/identities/testing/runIIdentityServiceContract.spec.ts:50`
// (`const PASSWORD_ACCOUNT_AS_GIVEN = '  Ada@Example.COM ';`), an email fixture whose name
// merely begins with `PASSWORD_`. A miss is the cheaper failure here: this gate is only
// useful while its findings are believed.
const POPULATED_SECRET = new RegExp(
  `(?:${SECRET_KEYS})\\s*[:=]\\s*(?!__FORGE_|\\$\\{|\\s*$)\\S+`,
  'i',
);

// The same rule for TypeScript source, where a populated secret is a QUOTED literal.
//
// The argument: TypeScript has no unquoted string literals, so an unquoted bare word after a
// colon is a reference to a binding — `secret: candidateSecret`, `token: refreshToken` — and
// a reference is not a credential. Any credential that can actually exist in `.ts`/`.tsx` is
// written in single quotes, double quotes or backticks. Requiring quotes therefore loses no
// credential this file type can carry, while dissolving the whole `secret: <reference>` class
// of false positives that had already caused two tasks to restructure working code around the
// gate. A gate that cries wolf is the one that gets switched off.
//
// Consequences of the quote requirement, both intended:
//   - a numeric literal (`password: 12345`) no longer flags in TypeScript. A number is not a
//     quoted literal, and a key immediately followed by a digit is far more often a count or
//     a TTL (`maxAttemptsPerToken: 5`) than a credential.
//   - the former type-annotation exemption is gone rather than narrowed: `secret: string` no
//     longer needs a list of tolerated primitive type names, because nothing unquoted matches
//     in TypeScript at all. There is no list left to widen by accident.
//
// The second alternative covers `secret: string = 'dev-secret'` — a quoted initializer behind
// a type annotation, which is a real credential shape and was flagged before this change. The
// annotation's character class deliberately excludes `,` and `;` so an annotation cannot run
// past its own declaration and adopt an unrelated default elsewhere on the line
// (`function f(secret: string, name = 'bob')` must not flag). The `__FORGE_` and empty-value
// exemptions are carried over; `${...}` needs none, since stripInterpolations has already
// reduced an interpolated template literal to an empty pair of backticks by the time this runs.
//
// The quote after the separator is captured (not just matched) and must reappear, via the
// backreference, after at least one content character — a real closing delimiter, not merely
// "the next character happens to be a quote mark". That distinction is load-bearing for
// backtick literals specifically: `'` and `"` are opened fresh at the value site and close a
// few characters later, but a template literal's backtick can span the *whole line*, so a
// backtick appearing near a key is as likely to be that outer literal's own CLOSING delimiter
// as it is to be an opening one for a new value. `` `${webappUrl}/reset-password?token=${value}` ``
// is exactly that: once stripInterpolations removes both `${...}` spans, the enclosing
// literal's closing backtick lands immediately after `token=`, and the old pattern — which
// asked only "is the next char a quote, and the one after that not a quote" — read it as an
// opening quote for a one-character literal. Requiring the SAME quote character to close again
// after real content fixes it: there is no third backtick left on the line to satisfy `\1`, so
// it no longer matches. A genuine quoted secret (`password: 'hunter2'`, `secret: \`hunter2\`,`)
// is unaffected — its closing quote of the same type is right there.
const POPULATED_SECRET_TS = new RegExp(
  `(?:${SECRET_KEYS})\\??\\s*(?:[:=]|:\\s*[A-Za-z0-9_$<>\\[\\]| ]+=)\\s*(['"\`])(?!__FORGE_)[^'"\`]+?\\1`,
  'i',
);

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
  // The non-TypeScript form of the populated-secret rule; `lineFindings` substitutes
  // POPULATED_SECRET_TS for this one in `.ts`/`.tsx`. See both definitions above.
  ['populated secret', POPULATED_SECRET],
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

// One shape survives the quoted-literal requirement above and still cannot carry a
// credential: a quoted value identical to its own key. It is stripped from the probe rather
// than exempted at the match site, for the reason stripInterpolations gives — a span-level
// strip handles a line carrying a false positive AND a real secret, where a lookahead
// anchored at one key's match site would skip the whole line.
//
// Applied to TypeScript source ONLY — see isTypeScriptFile. Its justification is a fact about
// source code (an enum member published in the source), and the shape does not exist in YAML
// or env files, where the rule is correct as written. Applying it everywhere silently
// un-flagged `POSTGRES_PASSWORD: "password"` in a compose file, which is the commonest shape
// a weak-but-real credential takes.
//
// A type-annotation exemption used to sit beside this one, accepting a closed list of
// primitive type names after the colon. It is gone, not narrowed: under POPULATED_SECRET_TS
// nothing unquoted matches in TypeScript at all, so `secret: string` passes for the general
// reason rather than by being on a list. Deleting it removes the widening risk that list
// carried, and leaving it in place would have been worse than useless — dead code that reads
// as a safety net and that no test could distinguish from a working one.

// A quoted value identical to its own key: a string enum member naming itself
// (`PASSWORD = 'PASSWORD'`, `INVALID_SECRET = 'INVALID_SECRET'`). The value is the key's
// own name, published in the source by definition, so there is nothing secret about it.
// The backreference is what keeps this narrow — `PASSWORD = 'hunter2'` does not match it
// and is still flagged.
//
// The key that is captured is the WHOLE UPPER_SNAKE name, not the secret word inside it,
// and that is what the backreference then compares against. An earlier form captured only
// the alternation and blocked the match with a preceding-character lookbehind, which got
// `POSTGRES_PASSWORD = 'password'` right — the regex could no longer start inside the
// longer name and find a value equal to that fragment — but got
// `INVALID_SECRET = 'INVALID_SECRET'` wrong, flagging a member that is the exact shape
// this exemption exists for. Capturing the whole key does both jobs at once and is the
// more direct statement of the rule: a key is self-named when the value is the key.
// `POSTGRES_PASSWORD = 'password'` still flags, because `password` is not
// `POSTGRES_PASSWORD`.
//
// Case-SENSITIVE — the only rule here that is, and the `i` this once carried was a hole.
// JS applies `i` to a backreference too, so `const PASSWORD = 'password'` and
// `password: 'password'` both satisfied `\1` and exempted themselves: a hardcoded dev
// credential in a config object, wearing the enum member's exemption. The justification
// ("the value is the key's own name, published in the source by definition") holds only
// for the shipped shape, which is an UPPER_SNAKE enum member whose value is spelled
// identically — so the key pattern is UPPER_SNAKE and nothing else. A self-named member
// in some other casing (`Password = 'Password'`) is flagged, and can carry a
// `sanitize:allow` marker like any other deliberate literal; the gate errs strict.
const SELF_NAMED_VALUE = new RegExp(
  `(?<![A-Za-z0-9_])([A-Z0-9_]*(?:${SECRET_KEYS})[A-Z0-9_]*)\\s*[:=]\\s*(['"\`])\\1\\2`,
  'g',
);

/**
 * Removes the source-code shape that cannot be a populated secret. Replaced with a space
 * rather than deleted, so stripping never splices two halves of a line into a match that was
 * not there before.
 */
export function stripNonSecrets(line) {
  return line.replace(SELF_NAMED_VALUE, ' ');
}

/** Whether a path is TypeScript source — the only file type the exemption above applies to. */
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
 * member in a `.ts` file and a real credential in a compose file, and `secret: candidateSecret`
 * is a reference to a binding in a `.ts` file and a literal value in an env file. TypeScript
 * therefore gets its own populated-secret pattern (a value must be quoted) as well as the
 * self-named-value strip; `${...}` stripping is unconditional, because it exists *for* YAML.
 * Anything whose type is unknown is judged as a non-source file, which is the strict direction.
 *
 * @param line - one raw line, exactly as read from the file
 * @param file - the path it came from; anything but `.ts`/`.tsx` gets the unexempted rule
 * @returns the labels of the rules it matched, possibly empty
 */
export function lineFindings(line, file = '') {
  const isSource = isTypeScriptFile(file);
  const interpolationsStripped = stripInterpolations(line);
  const secretProbe = isSource ? stripNonSecrets(interpolationsStripped) : interpolationsStripped;
  const labels = [];
  for (const [label, pattern] of RULES) {
    if (label === 'populated secret') {
      if ((isSource ? POPULATED_SECRET_TS : pattern).test(secretProbe)) labels.push(label);
      continue;
    }
    if (pattern.test(line)) labels.push(label);
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

/**
 * Whether this file is the process's entry point.
 *
 * `SELF` comes from `import.meta.url`, which Node has already resolved through any
 * symlink, so the argv side has to be resolved the same way — otherwise invoking the gate
 * through a symlink (`node ./san-link.mjs`) matches nothing, `main()` never runs, and the
 * script prints nothing and exits 0. A gate that passes silently when it is invoked
 * slightly differently is the vacuous pass the zero-file check exists to prevent, arriving
 * by another door. `realpathSync` throws on a path that no longer exists, which is not a
 * reason to crash: fall back to the plain resolve, which is what this did before.
 */
function isEntryPoint(argv1) {
  if (argv1 === undefined) return false;
  try {
    return fsSync.realpathSync(argv1) === SELF;
  } catch {
    return path.resolve(argv1) === SELF;
  }
}

// Run the scan only when this file is the process's entry point. Importing it — which is
// what lets the rules above be tested at all — must not walk the tree or exit the importer's
// process. `npm run sanitize` still runs exactly what it always did.
if (isEntryPoint(process.argv[1])) {
  await main();
}
