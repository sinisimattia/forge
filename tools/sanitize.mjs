#!/usr/bin/env node
/**
 * Extraction gate. The template must carry no trace of the project it was
 * extracted from, and no populated secret. Run before every commit that touches
 * template/, and in CI.
 *
 * SCOPE is `template/` and `tools/` (see ROOTS), and `tests/` is deliberately outside it.
 * A gate's own suite has to spell, verbatim, the exact strings its rules fire on — that is
 * what a fixture is — so holding `tests/` to these rules would make this gate's own tests
 * unwritable. The only way to keep them would be an inline allow marker on nearly every
 * fixture line, which is the whole-file exclusion this script dropped for itself (see the
 * rule-definition region below) reappearing one directory over. `tests/` is also Forge's
 * own: nothing under it is copied into a generated project, so a trace or a credential
 * there cannot ship. Phrases this gate's rules catch therefore do occur in `tests/`, by
 * design and without a finding.
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
// `template/` is what ships and `tools/` is what builds it. `tests/` is not a root, and that
// is a decision rather than an omission — see the header for why a gate cannot be held to its
// own fixtures.
const ROOTS = ['template', 'tools'].map((root) => path.join(REPO_ROOT, root));

const SELF = path.resolve(fileURLToPath(import.meta.url));

// This file is scanned like any other file under `tools/`, with one allowance: the region
// between the two markers below, which holds the rule definitions and the predicates that
// document and apply them. Those lines cannot avoid spelling the forbidden vocabulary — a
// rule is a regex literal containing the term, and the comment justifying it has to quote
// the term to say anything at all — so holding them to themselves would fail the gate on
// every clean checkout.
//
// The allowance cannot be narrower than a region. Marking each line individually would put an
// inline marker on most lines of the rules block, which floods the run's exemption list — the
// reviewable record of what the gate chose not to apply — with entries nobody reads, and makes
// every edit to a rule's rationale require a new marker. Nor is it wider than it has to be: it
// opens at the first rule definition and closes at `lineFindings`, the last predicate that
// applies them; the pair is validated on every run for both its shape and its extent, so a
// marker cannot be moved out over the scanner itself (see `ruleDefinitionRegion` and
// `assertScannerOutsideRegion`, and note that counting markers alone would not have); the
// region is reported as an exemption rather than taking effect silently; and everything
// outside it — this header, the roots, `pathFindings`, the walk, `main`, the entry-point
// guard — is scanned with no allowance at all.
//
// What this does NOT buy: the vocabulary rules are global, and a clean run is not proof that
// `tools/` is free of the vocabulary, because this file's largest block is exempt from them.
// Before the region existed the whole file was exempt and that claim was weaker still; it is
// now true of one marked region instead of one whole file, and a rule that must hold
// everywhere should not have its scope resting on an exemption at all.
const RULE_REGION_BEGIN = '// sanitize:rule-definitions-begin';
const RULE_REGION_END = '// sanitize:rule-definitions-end';

// The inline marker, assembled rather than written as one literal. Now that this file is
// scanned, a literal here would make the line implementing the exemption exempt itself, and
// every line of this file that quotes the marker would report as a deliberate exemption —
// the gate's own plumbing crowding out the exemptions a reader is meant to review. Prose
// about the marker is written as "an inline allow marker" for the same reason.
const ALLOW_MARKER = ['sanitize', 'allow'].join(':');

/**
 * The inclusive 1-based line range of the rule-definition region in `lines`.
 *
 * A marker is the whole trimmed line, so the two constants above — which necessarily contain
 * the same text — are not themselves mistaken for markers. Exactly one of each must be
 * present, in order; anything else throws rather than resolving to some other region quietly.
 *
 * This checks the markers' COUNT and ORDER and nothing about their EXTENT, which is the half
 * that actually protects anything: a single well-ordered pair can enclose the entire file.
 * `assertScannerOutsideRegion` is the extent half, and both run on every scan.
 *
 * @param lines - the file's lines, in order
 * @returns `{ start, end }`, both 1-based and both inside the region
 */
export function ruleDefinitionRegion(lines) {
  const found = (marker) => lines
    .map((line, index) => (line.trim() === marker ? index + 1 : 0))
    .filter(Boolean);
  const starts = found(RULE_REGION_BEGIN);
  const ends = found(RULE_REGION_END);
  if (starts.length !== 1 || ends.length !== 1) {
    throw new Error(
      `the rule-definition region needs exactly one begin and one end marker; found ${starts.length} and ${ends.length}`,
    );
  }
  if (starts[0] >= ends[0]) {
    throw new Error('the rule-definition region\'s begin marker must come before its end marker');
  }
  return { start: starts[0], end: ends[0] };
}

// The top-level declarations that make up the scanner itself, as their source lines begin.
// These are what the region must never reach: the roots it walks, the marker machinery that
// decides the region, the path judgement, the walk, the run, and the entry-point guard. None
// of them has any reason to spell a forbidden term, so all of them are scanned.
const SCANNER_DECLARATIONS = [
  'const ROOTS =',
  'export function ruleDefinitionRegion(',
  'export function assertScannerOutsideRegion(',
  'export function pathFindings(',
  'async function* walk(',
  'async function main(',
  'function isEntryPoint(',
];

/**
 * Throws unless every scanner declaration sits outside `region`.
 *
 * Counting and ordering the markers leaves the allowance's size completely unconstrained: one
 * well-ordered pair can enclose the whole file, which is the exact exemption the region exists
 * to replace, arriving back under a narrower name and changing nothing visible but a number in
 * the run's output. Extent is the property worth asserting, and it cannot be asserted against
 * the markers themselves — a test that reads its expected range out of the markers passes no
 * matter where they move.
 *
 * So the region is pinned against the file's own structure instead. Each declaration must
 * appear exactly once and fall outside the region; a renamed or duplicated declaration throws
 * as loudly as a moved marker, because an anchor that silently stops matching is a guard that
 * silently stops guarding. Lines between two anchors are not individually pinned, so a marker
 * can still drift within the rules block — but it cannot cross out of it, which is the move
 * that would restore the whole-file exemption.
 *
 * @param lines - the file's lines, in order
 * @param region - the range from `ruleDefinitionRegion`
 */
export function assertScannerOutsideRegion(lines, region) {
  for (const declaration of SCANNER_DECLARATIONS) {
    const at = lines
      .map((line, index) => (line.startsWith(declaration) ? index + 1 : 0))
      .filter(Boolean);
    if (at.length !== 1) {
      throw new Error(
        `the scanner declaration \`${declaration}\` must appear exactly once to pin the rule-definition region; found ${at.length}`,
      );
    }
    if (at[0] >= region.start && at[0] <= region.end) {
      throw new Error(
        `the rule-definition region ${region.start}-${region.end} encloses \`${declaration}\` at line ${at[0]}; the scanner itself is never exempt`,
      );
    }
  }
}

// sanitize:rule-definitions-begin
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

// The identifier-shape rules below (`source-domain identifier`, `source-domain type name`)
// key off the substrings `event`/`Event`/`payment`/`Payment`/`ticket`/`Ticket`, which is
// exactly how the DOM and a few platform APIs spell their own, unrelated vocabulary —
// `addEventListener`, `EventTarget`, `KeyboardEvent`, `PaymentRequest`. Lexically these are
// the same strings the source domain leaks as (`eventId`, `EventCard`, `RefundPayment`), so no
// regex can tell them apart — the two look identical to a pattern that only sees characters.
//
// The fix is a closed, explicit accept-list of the *exact* identifiers the DOM and platform
// are known to use, checked against the whole identifier a match sits inside (not the bare
// substring the regex matched). A cleverer regex was considered and rejected: any pattern
// that infers "this Event looks like a DOM one" from shape alone (capitalisation, a
// following capital letter, etc.) is guessing at the same lexical level that caused the
// collision, so it is exactly as likely to admit a domain leak spelled the same way as it is
// to reject a real DOM identifier spelled differently — EventCard and EventTarget differ only
// in which word follows "Event", and no regex distinguishes "a word list I know" from "a word
// list I don't" without... a list. A list is also the auditable choice: it is a fixed,
// enumerable set (the DOM does not grow new Event/Payment interfaces by developer whim), and
// its failure mode is visible — an identifier missing from the list still trips, loudly,
// rather than silently passing because a regex happened to be clever enough to let it through.
//
// Every entry here is checked against the WHOLE identifier a match is found inside (see
// `identifierAt`), not just the substring the rule's regex captured — otherwise "EventCard"
// would be accepted for containing the same "Event" prefix as "EventTarget". That whole-word
// comparison is what keeps this list from widening into the false negatives it exists to avoid.
//
// UIEvent is included even though it happens to survive today's rules unaided: `[a-z](Event…)`
// needs a lowercase letter immediately before "Event" and finds the uppercase "I" instead, and
// `\bEvent…` needs a word boundary immediately before "Event" and finds none (word characters on
// both sides). That is a true accident of the two other rules' shapes, not a decision anyone
// made about UIEvent — indistinguishable, until written down, from a deliberate pass. Listing it
// here converts the accident into policy: it is a real DOM interface (the ancestor of every
// other `*Event` type below) and belongs on this list on its own merits, independent of whether
// some other rule also happens to miss it.
//
// A bare "Event" is on this list too, and that is a real, accepted trade — not an oversight.
// The source domain's own leaked entity is *also* spelled exactly "Event" with nothing before or
// after it (`class Event`, `interface Event`), and that shape is lexically identical to the DOM's
// global `Event` type (`e: Event`) with nothing "wrong" written down anywhere: both are just the
// four characters E-v-e-n-t, standing alone. No accept-list, no cleverer regex, and no rule this
// gate could write distinguishes them; only human review of the surrounding code can. Every
// identifier the suite requires as a catch — eventId, myEvent, EventCard, EventsService,
// ticketId, TicketTier, paymentIntent, RefundPayment — has something attached to "Event"/
// "Payment"/"Ticket" and still trips, because the accept-list is checked against the whole word,
// not the substring. Only the bare, standalone word is affected, and it is affected in both
// directions equally: this was already true before this change (a bare `Event`/`Payment`/
// `Ticket` interface declaration passed the gate then too, via `interface Event {}` not
// matching the digit/case-shaped rules at all — this change does not newly open that gap, it
// documents it).
export const DOM_AND_PLATFORM_IDENTIFIERS = new Set([
  // The base DOM event type and its infrastructure — not a domain entity.
  'Event', 'EventTarget', 'EventListener', 'EventInit', 'EventSource', 'EventEmitter',
  'EventListenerOrEventListenerObject', 'EventListenerOptions', 'AddEventListenerOptions',
  // DOM event-handling calls and the parameter/variable names conventionally used with them.
  'addEventListener', 'removeEventListener', 'dispatchEvent',
  'nativeEvent', 'onEvent', 'eventListener', 'eventName',
  // Every specific DOM/UIEvent-family interface in current use across this stack's targets
  // (browser DOM, Vue/Nuxt synthetic events). UIEvent is listed for the reason given above:
  // it happens to survive the other rules unaided, and is listed anyway so that survival is
  // policy, not accident.
  'UIEvent', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'SubmitEvent',
  'InputEvent', 'FocusEvent', 'TouchEvent', 'WheelEvent', 'DragEvent', 'ClipboardEvent',
  'ProgressEvent', 'MessageEvent', 'CloseEvent', 'ErrorEvent', 'PopStateEvent',
  'HashChangeEvent', 'StorageEvent', 'AnimationEvent', 'TransitionEvent', 'CompositionEvent',
  'BeforeUnloadEvent',
  // The Payment Request API — the browser platform's own "Payment" vocabulary.
  'PaymentRequest', 'PaymentResponse',
]);

/** The run of identifier characters (letters, digits, `_`, `$`) touching `index` in `text`. */
function identifierAt(text, index) {
  let start = index;
  let end = index;
  const isIdentChar = (ch) => ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
  while (isIdentChar(text[start - 1])) start -= 1;
  while (isIdentChar(text[end])) end += 1;
  return text.slice(start, end);
}

const isLetter = (ch) => ch !== undefined && /[A-Za-z]/.test(ch);

/**
 * Labels whose rule matches a bare term (`rsvp`, `stripe`, `organizer`, `refund`, …) that must
 * be caught wherever it forms a whole "word" inside an identifier — including a no-separator
 * compound, where the only thing marking the term off from its neighbour is a case change.
 *
 * `\b` cannot express that: it fires only at a word/non-word transition, and a letter is a
 * "word" character regardless of its case, so `\borganizers?\b` finds `organizer-invitation`
 * and `organizer_invitation` (the separator is a non-word character) but not
 * `OrganizerInvitation` or `organizerInvitation` (no non-word character exists between the two
 * words at all — see the RULES comment at their definition for the triage item this closes).
 *
 * `source-domain path term` (PATH_ONLY_RULES) is deliberately NOT in this set — see the
 * comment on that rule for why widening it the same way is a false-positive risk this gate
 * must not take on, rather than an oversight.
 *
 * `forge-process role` joins it for the same reason `organizer`/`rsvp` needed it: a generated
 * project could plausibly get a class or variable named after the role this template's own
 * comments call "the coordinator" (`TaskCoordinator`, `coordinatorService`), and a plain `\b`
 * would miss it exactly the way it missed `OrganizerInvitation`.
 */
const BOUNDED_TERM_LABELS = new Set(['source-domain term', 'forge-process role']);

/**
 * Whether the match of `pattern` starting at `index` in `text` sits on a real word boundary on
 * BOTH sides — `\b`'s notion of one (start/end of string, or a non-letter neighbour) widened to
 * also treat a case transition as a boundary, the same way `-` and `_` already are. This is
 * deliberately not a bare substring match: a longer word that merely contains the term
 * (`reinvitationless`) has a letter, of the same case run, on at least one side, so it is
 * rejected — only a genuine word boundary, letter-case or otherwise, counts.
 *
 * A DIGIT counts as a boundary on either side, which is wider than `\b` and deliberately so:
 * `isLetter` is letters-only rather than word-character-wide, so `organizer1` and `x1organizer`
 * both trip while `\borganizer\b` matches neither (a digit is a word character, so `\b` does not
 * fire between a letter and a digit at all). A numbered identifier is a leak like any other.
 *
 * Boundary before the match: start of string, a non-letter, the immediately preceding character
 * being lowercase while the match's own first character is uppercase (the compound-boundary
 * transition, e.g. the `y`|`O` in `myOrganizer`), or the acronym-run transition — an uppercase
 * neighbour where the match itself begins a new word, i.e. its first character is uppercase and
 * its second is lowercase (the `I`|`O` in `APIOrganizerService`). A capital in the middle of an
 * acronym run is still not a boundary, because the character after it is not lowercase.
 * Boundary after the match: end of string, a non-letter, or the immediately following character
 * being uppercase (a new word starting right where the match ends, e.g. the `r`|`I` in
 * `OrganizerInvitation`).
 *
 * An ALL-CAPS run supplies no boundary, in either direction, exactly as a lowercase run does
 * not: nothing in `APIORGANIZERService` marks `ORGANIZER` off from the letters before it, so
 * it is rejected for the same reason `reorganizerless` is. Treating any uppercase neighbour as
 * a boundary would close that gap and open a worse one — an ordinary ALL_CAPS constant that
 * merely contains a term would flag — so the gap is kept, and pinned by a test.
 *
 * `matched` is whatever the caller hands over, not necessarily what the pattern matched
 * greedily; see `boundedAlternatives` for why the greedy match is not the only candidate.
 */
function isBoundedMatch(text, index, matched) {
  const before = text[index - 1];
  const after = text[index + matched.length];
  const startsNewWord = /[A-Z]/.test(matched[0]) && /[a-z]/.test(matched[1] ?? '');
  const leadingOk = !isLetter(before)
    || (/[a-z]/.test(before) && /[A-Z]/.test(matched[0]))
    || (/[A-Z]/.test(before) && startsNewWord);
  const trailingOk = !isLetter(after) || /[A-Z]/.test(after);
  return leadingOk && trailingOk;
}

/**
 * Every prefix of `matched` that `pattern` could itself have produced at the same position,
 * longest first.
 *
 * A regex returns one match per position — the greedy one — and the boundary check then gets
 * no say in which. That matters wherever a pattern has an optional tail: `organizers?` is
 * case-insensitive, so its `s?` swallows the capital `S` that starts the next word of
 * `organizerService`, the match ends one character inside `Service`, and the trailing check
 * sees a lowercase `e` and refuses. The term was there, properly bounded, in a match the
 * engine had already discarded.
 *
 * Returning the alternatives and letting the caller test each one closes that as a class
 * rather than one spelling at a time. An earlier fix recognised the swallowed capital by its
 * own shape (last character uppercase after a lowercase one), which worked for
 * `organizerService` and walked straight past `REFUNDService` — the all-caps spelling of the
 * same miss. Every candidate here is a string the pattern genuinely matches, so nothing is
 * admitted that the rule did not already describe; only the engine's preference for the
 * longest one is set aside.
 *
 * @param pattern - the rule's pattern, with or without `g`
 * @param matched - the text the engine matched at this position
 * @returns the candidate matches to boundary-check, longest first
 */
function boundedAlternatives(pattern, matched) {
  const anchored = new RegExp(`^(?:${pattern.source})$`, pattern.flags.replace(/[gy]/g, ''));
  const candidates = [];
  for (let length = matched.length; length > 0; length -= 1) {
    const candidate = matched.slice(0, length);
    if (anchored.test(candidate)) candidates.push(candidate);
  }
  return candidates;
}

/**
 * Whether `pattern` (case-insensitive, no `\b` of its own — see BOUNDED_TERM_LABELS) finds a
 * properly word-bounded match anywhere in `text`. Every match is walked, not just the first —
 * a bounded hit later on the line must not be shadowed by an unbounded one earlier on it, the
 * same principle `matchesUnacceptedIdentifier` applies for the DOM/platform accept-list — and
 * at each position every alternative the pattern could have matched there is checked, not only
 * the greedy one the engine returned (see `boundedAlternatives`).
 */
function matchesBoundedTerm(pattern, text) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  let match;
  while ((match = global.exec(text)) !== null) {
    for (const candidate of boundedAlternatives(pattern, match[0])) {
      if (isBoundedMatch(text, match.index, candidate)) return true;
    }
    if (match[0].length === 0) global.lastIndex += 1; // never loop on a zero-width match
  }
  return false;
}

/**
 * Labels whose rule matches identifier-shaped substrings (`event`/`Event`/`payment`/`Payment`/
 * `ticket`/`Ticket`) that a DOM or platform identifier can share character-for-character with a
 * leaked domain name. Every match these rules produce is re-checked against
 * `DOM_AND_PLATFORM_IDENTIFIERS` before it counts — see the accept-list comment above.
 */
const IDENTIFIER_SHAPE_LABELS = new Set(['source-domain identifier', 'source-domain type name']);

/**
 * Whether `pattern` finds a match in `text` whose enclosing identifier is NOT on the DOM/
 * platform accept-list. A rule with several matches on one line (a domain leak next to a real
 * DOM identifier) must still trip on the one that is not accepted, so every match is walked —
 * the first accepted one does not buy amnesty for the rest of the line, the same principle
 * `stripNonSecrets` applies to the populated-secret rule.
 */
function matchesUnacceptedIdentifier(pattern, text) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const global = new RegExp(pattern.source, flags);
  let match;
  while ((match = global.exec(text)) !== null) {
    const identifier = identifierAt(text, match.index);
    if (!DOM_AND_PLATFORM_IDENTIFIERS.has(identifier)) return true;
    if (match[0].length === 0) global.lastIndex += 1; // never loop on a zero-width match
  }
  return false;
}

export const RULES = [
  ['source-project trace', /voku/i],
  // Terms with no innocent generic use — always a leak.
  //
  // `invitation` was here and is deliberately gone. The template ships organizations and
  // their memberships, and an invitation is how somebody joins one — so organization
  // invitations are a first-class concept of the template itself: `Invitation`,
  // `invitations.controller.ts` and `INVITATION_ACCEPTED` are all things a generated
  // project is supposed to contain. A rule that bans a word the template uses is not a
  // gate, it is a rule everyone learns to route around, and the routing-around is what
  // actually costs — it teaches that a sanitize failure is something you argue with.
  //
  // What still catches a leak of this concept is `source-project trace` (/voku/i), which
  // is unconditional and matches on the same line whatever else is on it. The qualifier
  // in front of the noun is where a domain shows itself, and no qualifier this template
  // uses is shared with the source project's.
  //
  // No `\b` here — deliberately. This rule is routed through `matchesBoundedTerm`
  // (BOUNDED_TERM_LABELS), which checks the same boundary `\b` would plus a
  // lowercase-to-uppercase transition, so a no-separator compound (`OrganizerInvitation`,
  // `organizerInvitation`) is caught the same way `organizer-invitation` and
  // `organizer_invitation` already are. Keeping `\b` in the pattern itself would only ever
  // narrow what `matchesBoundedTerm` is given to check, never widen it — Triage item 3 from
  // Phase 3.
  ['source-domain term', /(rsvp|stripe|organizers?|refunds?)/i],
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
  ['source-domain constant', /\b(EVENT|PAYMENT|TICKET|REFUND)_/],
  ['source-domain module', /\b(event|payment|ticket)s?\.(module|service|controller|entity|repository|guard|dto|resolver|interceptor|pipe|strategy|gateway)\b/i],
  // Forge's own process vocabulary — added after it leaked into `template/` three times in
  // one phase despite an explicit instruction not to, because the instruction and a
  // legitimate, 56-reference copy of the same vocabulary arrive in an implementer's hands in
  // the same document (the phase plan). An instruction cannot outrun a copy-paste source; a
  // gate can. A generated project has no "Task 12", no "Phase 3", no briefs and no
  // coordinator — those describe how THIS repository built the template, not anything true
  // of the code a generated project ships.
  //
  // Case-sensitive and requires a space before the digit, deliberately narrow: every leak
  // measured was capitalized and spelled with a space ("Task 12", "Phase 3", "Tasks 10–14").
  // The bare, lowercase words "task"/"phase" are ordinary English this template's own
  // comments use for ordinary reasons ("the next phase of rollout", "each task in the
  // queue") and must not be flagged, and neither should a coincidental digit near the
  // lowercase word ("the task 12 hours from now", "12 open tasks"). Catching the
  // capitalized, spaced shape and nothing else is the considered trade — see
  // `forge-process brief` below for the same trade made explicitly about "brief".
  //
  // The optional plural is not decoration. A citation of several units at once is written
  // "Tasks 10–14", and the singular-only form of this rule read straight past exactly that
  // line in `app/types/api.ts`. Adding `s?` costs nothing in false positives here, because
  // the rule is case-sensitive: "12 open tasks" and "3 tasks 5 minutes apart" are lowercase
  // and still do not match.
  ['forge-process coordinate', /\b(?:Tasks?|Phases?)\s+\d+\b/],
  // The same register with no coordinate in it. "Task 12" is a citation; "this task" is a
  // sentence about the work that produced a line, written without numbering it — "the one
  // read-only composable this task adds", "out of scope for this task", "what this task was
  // first given". `forge-process coordinate` cannot see any of them, and that is how
  // thirty-three of them shipped inside `template/` while the gate reported clean: a comment
  // explaining why a line looks the way it does rarely says which numbered unit of work
  // wrote it. A generated project's owner has no idea what "this task" refers to, and the
  // sentence is almost always better as a statement about the code it sits beside.
  //
  // Case-insensitive, unlike the coordinate rule above: a sentence opening "This task" is
  // the same register, and there is no capitalization split to key off.
  //
  // One word may sit between "this" and "task", and that allowance is not speculative: the
  // adjacent-only form of this rule shipped, and "this whole task exists to prevent" and
  // "the brief for this file's task" both walked past it on the very next read of the tree.
  // An adjective or a possessive is the cheapest way to say the same thing, so the rule has
  // to reach one of them or it catches only the phrasing somebody happened to use first.
  // Exactly one word, not any number: "this is the only task the runner schedules" is an
  // ordinary sentence, and widening further would start collecting them.
  //
  // It is otherwise the bare phrase and nothing cleverer, which has a cost worth naming
  // rather than discovering. A generated project writing "this task runner is configured in
  // nx.json", or "this build task", gets a finding for prose of its own. That is a real
  // false positive and the accepted side of the trade — every narrowing that would exempt it
  // (a following-word list, a verb list) is the kind of closed enumeration that goes stale,
  // and the escape is one word ("the task runner"), not an argument with the gate. "task"
  // without the demonstrative is untouched, and `\b` keeps the rule out of compounds, so
  // `taskQueue` and `this taskQueue` do not match.
  //
  // Labelled distinctly from the phase rule below even though both are provenance: two
  // entries sharing one label report the same string twice for a line that matches both,
  // which reads as a duplicate rather than as two findings.
  ['forge-process task provenance', /\bthis(?:\s+[\w'’-]+)?\s+task\b/i],
  // The same register spelled with "phase", and it needed a different shape of rule. The
  // bare word cannot be used here the way "this task" can, because a generated project's
  // own vocabulary owns it: a sign-in in this template really does happen in two phases,
  // and "the first phase of a sign-in", "the second phase, proven by a recovery code" and
  // "two-phase login" are all correct, load-bearing names for a real thing. A rule on
  // `/phase/i` would flag every one of them on a clean checkout, and a gate that flags
  // correct code is one that gets argued with instead of obeyed.
  //
  // So this is scoped to the word in front of it instead, which is where the two senses
  // part company. Forge's build-out is pointed at with a demonstrative or a relative-time
  // word — "this phase", "that phase's", "these phases", "a later phase", "an earlier
  // phase", "the next phase", "a future phase". The ceremony sense never takes one: it
  // takes an ordinal or a count ("the first phase of a sign-in", "the same second phase",
  // "the two phases", "two-phase login"). Checked against every occurrence in `template/`:
  // this fires on none of the ceremony uses and would have fired on the provenance ones.
  //
  // The relative-time list is the principle's own list, not the words that happened to
  // occur. "Later/earlier/previous/next" were the ones in the tree; "future", "prior",
  // "upcoming", "subsequent" and "following" are the same part of speech doing the same
  // job, and leaving them out would have made the stated criterion wider than the rule.
  // None of them occurs today, so including them costs nothing against the ceremony uses.
  //
  // What it does not reach, named rather than left to be found later: "for a phase", "for
  // one phase", "two phases later" and "every phase that adds an action" are the same
  // register and go uncaught — no qualifier distinguishes them from "the two phases", and
  // that ambiguity is real rather than an oversight. A ceremony comment that wrote "the
  // next phase of the sign-in" would be a false positive; none exists, and "the next step"
  // is the fix if one is ever wanted.
  //
  // The cost that is NOT hypothetical, and is the larger one: a maintainer of a generated
  // project writing "the next phase of rollout adds SSO" — about their own rollout, with
  // Forge nowhere in it — gets a finding here. The gate's own suite asserted that exact
  // sentence as clean until this rule, and the assertion was flipped deliberately rather
  // than carved out, because planned-work prose in shipped code is the thing this rule is
  // for and a carve-out would be a hole shaped like the commonest way to write it. The
  // escape is again one word ("the next stage of rollout"). A narrow rule that holds beats
  // a wide one somebody narrows under pressure — the trade `forge-process brief` makes
  // about the word "brief".
  ['forge-process phase provenance', /\b(?:this|that|these)\s+phases?\b|\b(?:later|earlier|previous|next|subsequent|future|prior|upcoming|following)\s+phases?\b/i],
  // "coordinator" has no ordinary use in this template's own domain vocabulary — a bare,
  // case-insensitive word is safe here in a way it is not for "brief" below, because there is
  // no common English sentence that needs the word "coordinator" for a reason unrelated to
  // Forge's own dispatching role. Routed through `matchesBoundedTerm` (BOUNDED_TERM_LABELS)
  // for the same reason `organizer`/`rsvp` are: a generated project could plausibly name a
  // class or variable after the role this template's own process calls "the coordinator"
  // (`TaskCoordinator`, `coordinatorService`), and a plain `\b` would miss that compound the
  // same way it missed `OrganizerInvitation` before the boundary fix.
  //
  // No plural `s?`, unlike `source-domain term`'s `organizers?`. The observed vocabulary is
  // never "coordinators" plural, and there is nothing to gain from matching one. An optional
  // plural also costs something: because the rules are case-insensitive, `s?` consumes the
  // capital `S` that starts the next word of a compound (`organizerService`), so the match
  // runs one character past the term and the trailing-boundary check sees a lowercase letter
  // after it. `matchesBoundedTerm` now boundary-checks the shorter alternative the pattern
  // could have matched instead (see `boundedAlternatives`), so `organizers?` no longer slips
  // such a compound — but a rule with no optional plural never has the problem at all.
  ['forge-process role', /coordinator/i],
  // "brief" alone is ordinary English ("kept it brief", "a brief pause") and this template's
  // own comments are exactly the kind of prose that uses it that way — a bare-word rule here
  // would be the gate that cries wolf until somebody turns it off. What is unambiguous is
  // "brief" as the NOUN naming a Forge task/phase dispatch document, and every occurrence
  // measured in this sweep had "task", "phase" or "coordinator" immediately before it ("this
  // task's brief", "the task brief", "a phase's brief"). Narrowed to that co-occurrence on
  // purpose: it will miss a bare "the brief" with none of those words nearby ("the brief this
  // suite implements", "the one the brief names") — a real gap, chosen deliberately, per
  // task-18's own report, because a rule that cannot tell the process sense from the ordinary
  // one reliably should catch less rather than cry wolf on "kept it brief."
  ['forge-process brief', /\b(?:task|phase|coordinator)'?s?\s+briefs?\b/i],
  ['stripe-style key', /\b(sk_|pk_live)/],
  // The non-TypeScript form of the populated-secret rule; `lineFindings` substitutes
  // POPULATED_SECRET_TS for this one wherever `isTypeScriptFile` says the file's own
  // rule applies — `.ts`/`.tsx`, and a `.vue` component's script block. See both
  // definitions above.
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
// It keeps a plain `\b` and is deliberately NOT routed through `matchesBoundedTerm` (see
// BOUNDED_TERM_LABELS), so it matches only where a non-word character separates the term:
// `events-overview.md` yes, `EventsOverview.md` no. Unlike `source-domain term`, `event`/
// `payment`/`ticket` have real DOM/platform homonyms (EventTarget, PaymentRequest, …), and the
// content rules only get away with a bare substring because every match is re-checked against
// `DOM_AND_PLATFORM_IDENTIFIERS` (see IDENTIFIER_SHAPE_LABELS). This path-only rule has no such
// accept-list: giving it the case-transition boundary flags a path named `EventTarget.ts` — a
// real DOM interface name, and a correct name for a file to have — with nothing to exempt it.
// A gate that flags a correctly named file is one that gets argued with instead of obeyed.
//
// The price of staying narrow is a false negative, and it is worth naming rather than leaving
// implicit: a source-project trace hiding in an event/payment/ticket-shaped file name with no
// separator goes uncaught. Kebab-case is this template's realistic leak shape for a path (see
// the paragraph above), so that miss is the cheaper side of the trade — but it is a miss, and
// the day an accept-list for path terms exists, this is the rule that should get it.
export const PATH_ONLY_RULES = [
  ['source-domain path term', /\b(events?|payments?|tickets?)\b/i],
  // The kebab-case shape `forge-process coordinate` (RULES, content-only by design) cannot
  // catch: a realistic leaked FILE is Forge's own report-naming convention
  // (`task-18-report.md`, copied into `template/` by accident the way `events-overview.md`
  // stands in for a leaked domain name above), lowercase and hyphenated, not the capitalized,
  // spaced prose shape ("Task 12") the content rule is deliberately narrowed to. A path is
  // never prose, so the collision risk that keeps the content rule narrow does not apply here
  // — case-insensitive and hyphen-separated is the realistic leak shape for a path, the same
  // reasoning `source-domain path term` gives just above.
  ['forge-process path coordinate', /\b(?:task|phase)-\d+\b/i],
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

/**
 * Whether a path is TypeScript source — the only file type the exemption above applies to.
 *
 * A `.vue` single-file component's `<script setup lang="ts">` block IS TypeScript, and the
 * argument the quoted-literal rule makes ("TypeScript has no unquoted string literals, so an
 * unquoted bare word after a colon is a reference to a binding, not a credential") applies to
 * it verbatim. Judging `.vue` by the non-TypeScript rule instead — as this function did before
 * this fix — misclassified every `.vue` script line as if it were YAML, and produced exactly
 * the false-positive class that rule is wrong for: `secret: secretInput.value` (a reference),
 * `route.query.token === 'string'` (the `=` of `===`), `const secret = ref('')` (an empty
 * ref) and a bare `secret: string` type annotation all flagged as populated secrets in a
 * `.vue` file while the identical TypeScript flagged none of them. Those false positives were
 * first dealt with by reshaping three files under `apps/webapp` around the gate — which is the
 * worse trade of the two, because it leaves the gate wrong, spreads the workaround across
 * however many `.vue` files arrive later, and teaches the next person that the gate's verdict
 * is something to write around rather than to trust. Fixing the classification here instead
 * costs one regex and removes the whole class.
 *
 * LATENT SUB-CLASS, deliberately left unhandled — pinned by a test, not silently accepted.
 * `.vue` also has a *template* block, where a binding is quoted by HTML attribute syntax, not
 * by TypeScript string-literal syntax: `:token="tokenRef"` is a reference (the value between
 * the quotes is a JS expression), but to POPULATED_SECRET_TS it is indistinguishable from a
 * quoted literal, and it flags. Telling script content apart from template content needs the
 * file's structure, not just the line's text, and this function — like the rest of this
 * gate — judges one line at a time with no memory of what came before it; doing otherwise
 * here would be exactly the kind of restructuring around a corner case this gate's own history
 * warns against. Nothing in `template/` or `tools/` binds a secret-named prop to a bare quoted
 * reference today (verified: no `:secret=`/`:token=`/`:password=`/`v-model:secret=` etc. exists
 * in any `.vue` file), so extending TypeScript treatment to `.vue` trades zero real coverage
 * for eliminating four measured false positives. If this shape is ever introduced, it will
 * over-flag (the strict direction this gate always prefers to a miss) and can be marked with
 * `sanitize:allow` like any other reviewed exemption.
 */
export function isTypeScriptFile(file) {
  return /\.(tsx?|vue)$/.test(file);
}

/**
 * Every rule label a line's *content* trips, in rule order. This is the whole per-line
 * judgement the scan below makes, extracted so it can be exercised directly: a gate whose
 * exemptions can only be tested by writing a fixture file into `template/` is a gate whose
 * exemptions do not get tested.
 *
 * The file is part of the judgement, not decoration: `PASSWORD = 'PASSWORD'` is an enum
 * member in a `.ts` file and a real credential in a compose file, and `secret: candidateSecret`
 * is a reference to a binding in a `.ts`/`.vue` file and a literal value in an env file.
 * TypeScript (and a `.vue` component's TypeScript script block — see `isTypeScriptFile`)
 * therefore gets its own populated-secret pattern (a value must be quoted) as well as the
 * self-named-value strip; `${...}` stripping is unconditional, because it exists *for* YAML.
 * Anything whose type is unknown is judged as a non-source file, which is the strict direction.
 *
 * @param line - one raw line, exactly as read from the file
 * @param file - the path it came from; anything but `.ts`/`.tsx`/`.vue` gets the unexempted rule
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
    if (IDENTIFIER_SHAPE_LABELS.has(label)) {
      if (matchesUnacceptedIdentifier(pattern, line)) labels.push(label);
      continue;
    }
    if (BOUNDED_TERM_LABELS.has(label)) {
      if (matchesBoundedTerm(pattern, line)) labels.push(label);
      continue;
    }
    if (pattern.test(line)) labels.push(label);
  }
  return labels;
}
// sanitize:rule-definitions-end

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
    if (IDENTIFIER_SHAPE_LABELS.has(label)) {
      if (matchesUnacceptedIdentifier(pattern, file)) labels.push(label);
      continue;
    }
    if (BOUNDED_TERM_LABELS.has(label)) {
      if (matchesBoundedTerm(pattern, file)) labels.push(label);
      continue;
    }
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
      scannedCount += 1;

      // A leftover file or directory *named* for the domain leaks via its path alone,
      // even with generic content inside — content-only scanning is blind to that. A
      // path cannot carry an inline allow marker, so a path finding is never
      // exemptible that way; it is reported with a `(path)` marker in place of a line
      // number to make clear it is not a content hit.
      for (const label of pathFindings(file)) {
        findings.push(`${file}:(path)  ${label}  ${file}`);
      }

      const buffer = await fs.readFile(file);
      if (buffer.includes(0)) continue;
      const lines = buffer.toString('utf8').split('\n');

      // This file's rule definitions are the one region allowed to spell the forbidden
      // vocabulary — see the comment on RULE_REGION_BEGIN. The allowance is this file's
      // alone: no other file under the roots gets a region, only inline markers.
      let ruleRegion = null;
      if (path.resolve(file) === SELF) {
        // Both halves of the region's integrity — the markers, and how far they reach. A
        // failure here is reported in the gate's own voice rather than as a stack trace,
        // because it is a finding about this file like any other: the allowance is no longer
        // the one that was reviewed.
        try {
          ruleRegion = ruleDefinitionRegion(lines);
          assertScannerOutsideRegion(lines, ruleRegion);
        } catch (error) {
          console.error(`Sanitization failed: ${error.message}`);
          process.exit(1);
        }
      }
      if (ruleRegion) {
        const span = ruleRegion.end - ruleRegion.start + 1;
        exemptions.push(
          `${file}:${ruleRegion.start}-${ruleRegion.end}  rule definitions (${span} line(s))`,
        );
      }

      lines.forEach((line, index) => {
        if (ruleRegion && index + 1 >= ruleRegion.start && index + 1 <= ruleRegion.end) return;
        // A marked line is a deliberate, reviewed exemption — skip every rule for it,
        // but record it so it shows up in the run's output rather than vanishing silently.
        if (line.includes(ALLOW_MARKER)) {
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
