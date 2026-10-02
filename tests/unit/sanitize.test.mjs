import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lineFindings,
  pathFindings,
  ruleDefinitionRegion,
  assertScannerOutsideRegion,
  DOM_AND_PLATFORM_IDENTIFIERS,
  isTypeScriptFile,
} from '../../tools/sanitize.mjs';

// The gate's value is entirely in what it refuses, so every case below is stated as a
// line a real file could contain, and asserted in both directions: the lines that must
// still be caught, and the lines the rules deliberately tolerate. The narrowings of the
// populated-secret rule are the reason this file exists — they can be widened by one
// character, and nothing else in the repository would notice.
//
// Every case names the file it is in, because the file is part of the judgement: TypeScript
// is judged by its own populated-secret rule (a value must be quoted) plus the
// self-named-value exemption, so the same text means different things in `AuthProvider.ts`
// and in `compose.yaml`.
const TS = 'libs/core/src/identities/enums/AuthProvider.ts';
const VUE = 'apps/webapp/app/pages/reset-password.vue';
const YAML = 'compose.yaml';
const ENV = '.env.example';

const labels = (line, file) => lineFindings(line, file).join(',');
const flagged = (line, file) => lineFindings(line, file).length > 0;
const pathFlagged = (p) => pathFindings(p).length > 0;

test('a populated secret is flagged in each shape a real credential takes', () => {
  assert.equal(labels("  password: 'hunter2',", TS), 'populated secret');
  assert.equal(labels('DB_PASS: correct-horse-battery', YAML), 'populated secret');
  assert.equal(labels('JWT_SECRET=s3cr3t-value', ENV), 'populated secret');
  // Two rules, both of which should speak up about this line.
  assert.equal(
    labels("const API_KEY = 'sk_live_51HxxxxxxxxxxYYYYYYYY'", TS),
    'stripe-style key,populated secret',
  );
});

// The key list spelled its multi-word names with underscores only, so their camelCase
// spellings — the conventional casing for backend config in this stack — never matched, and
// the populated-secret rule missed them entirely. `apiKey` and `privateKey` looked covered
// only because their *values* are distinctive enough for the stripe-key and private-key rules
// to catch; give them an ordinary-looking value, as `dbPass` and `accessKey` have, and nothing
// spoke at all. The separator is now optional, which also picks up the kebab-case spelling
// that appears in YAML.
test('a multi-word secret key is flagged in camelCase and kebab-case too', () => {
  assert.equal(labels("  dbPass: 'correct-horse-battery',", TS), 'populated secret');
  assert.equal(labels("  accessKey: 'AKIAIOSFODNN7EXAMPLE',", TS), 'populated secret');
  assert.equal(labels("  apiKey: 'plain-looking-value',", TS), 'populated secret');
  assert.equal(labels("  privateKey: 'plain-looking-value',", TS), 'populated secret');
  assert.equal(labels('api-key: plain-looking-value', YAML), 'populated secret');
  assert.equal(labels('access-key: plain-looking-value', YAML), 'populated secret');
  // The UPPER_SNAKE spellings these were always meant to cover, unchanged.
  assert.equal(labels('API_KEY=plain-looking-value', ENV), 'populated secret');
  assert.equal(labels('DB_PASS: correct-horse-battery', YAML), 'populated secret');
  // And the single-word keys, which never needed a separator, still behave as they did.
  assert.equal(labels("  secret: 'x',", TS), 'populated secret');
  assert.equal(labels('TOKEN=x', ENV), 'populated secret');
});

test('a key, a private key block and a source-project trace are flagged', () => {
  assert.equal(labels('-----BEGIN RSA PRIVATE KEY-----', ENV), 'private key');
  assert.equal(labels('BEGIN PRIVATE KEY', ENV), 'private key');
  assert.equal(labels('const publishable = pk_live_abcdef;', TS), 'stripe-style key');
  assert.equal(labels('https://github.com/example/voku', 'README.md'), 'source-project trace');
  assert.equal(labels('// extracted from Voku', TS), 'source-project trace');
});

test('a value that cannot be a secret is not flagged', () => {
  // An unsubstituted token, an interpolation, and an empty value: the three original
  // exemptions, all of which are structurally incapable of carrying a credential, and
  // all of which apply to every file type — they exist for YAML and env files.
  assert.equal(flagged('DB_PASSWORD=__FORGE_NAME__', ENV), false);
  assert.equal(flagged('  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}', YAML), false);
  assert.equal(flagged('POSTGRES_PASSWORD:', YAML), false);
  assert.equal(flagged('API_KEY=', ENV), false);
  // The same three under the TypeScript rule, which carries its own copies of the token and
  // empty-value exemptions rather than inheriting them.
  assert.equal(flagged("  password: '__FORGE_NAME__',", TS), false);
  assert.equal(flagged('  password: `${resolvedSecret}`,', TS), false);
  assert.equal(flagged("  password: '',", TS), false);
});

// DOCUMENTED LIMITATION, pinned here so the next reader finds the decision rather than
// rediscovering the gap and "fixing" it into a false positive. The rule requires the key to be
// *immediately* followed by its separator, so a key carrying a suffix slips, in every file
// type. Making the key suffix-tolerant was tested against the whole tree and ruled against: it
// false-positives on our own shipped source. The last two assertions are verbatim lines from
// template/ that a suffix-tolerant key would flag — the first under the gate as it stood
// before the quoted-literal rule, the second under the gate as it stands now.
test('a key carrying a suffix is a documented miss, not an oversight', () => {
  assert.equal(flagged("  PASSWORD_HASH: 'actual-secret',", TS), false);
  assert.equal(flagged('PASSWORD_HASH: actual-secret', YAML), false);
  assert.equal(flagged('export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {', TS), false);
  assert.equal(flagged("const PASSWORD_ACCOUNT_AS_GIVEN = '  Ada@Example.COM ';", TS), false);
});

test('a string enum member naming itself is not a populated secret in TypeScript', () => {
  assert.equal(flagged("  PASSWORD = 'PASSWORD',", TS), false);
  assert.equal(flagged('  PASSWORD = "PASSWORD",', TS), false);
  assert.equal(flagged("  SECRET: 'SECRET',", TS), false);
});

// These still pass, but no longer because a list of tolerated primitive type names says so —
// that exemption is gone. They pass for the general reason: in TypeScript a populated secret
// must be a quoted literal, and an annotation's type is never quoted. The cases are kept
// because they are the behaviour that matters; only the mechanism underneath them changed.
test('a TypeScript type annotation is not a populated secret in TypeScript', () => {
  assert.equal(flagged('  secret: string;', TS), false);
  assert.equal(flagged('  readonly token: string,', TS), false);
  assert.equal(flagged('  apiSecret?: string;', TS), false);
  assert.equal(flagged('  token: string | undefined', TS), false);
  assert.equal(flagged('function sign(secret: string): string', TS), false);
  assert.equal(flagged('  isKnownBreached(secret: string): Promise<boolean>;', TS), false);
});

// The narrowings above are facts about source code: an enum member published in the source,
// and a value that must be quoted because TypeScript has no unquoted string literals. Neither
// holds in YAML or an env file, where the rule was written and is correct as written — so
// neither may reach one. `secret: string` in a compose file is a key with the literal value
// `string`. These cases pin that scoping: it is a decision, not an accident.
test('the source-code narrowings do not reach YAML or env files', () => {
  assert.equal(labels("  PASSWORD = 'PASSWORD',", YAML), 'populated secret');
  assert.equal(labels("  PASSWORD = 'PASSWORD',", ENV), 'populated secret');
  assert.equal(labels('  secret: string', YAML), 'populated secret');
  assert.equal(labels('  POSTGRES_PASSWORD: "password"', YAML), 'populated secret');
  assert.equal(labels("JWT_SECRET='secret'", ENV), 'populated secret');
  assert.equal(labels('  DB_PASSWORD: "password"', 'compose.dev.yml'), 'populated secret');
  // Unknown file type is judged as a non-source file — the strict direction.
  assert.equal(labels('  POSTGRES_PASSWORD: "password"', 'deploy.conf'), 'populated secret');
  assert.equal(labels('  POSTGRES_PASSWORD: "password"', ''), 'populated secret');
});

// The edges are the point. An exemption is only as good as the cases it refuses to
// cover, and each of these is one character away from a case it does cover.
test('a value that merely starts like its key is still flagged', () => {
  assert.equal(labels("  PASSWORD = 'PASSWORD_FILE_PATH',", TS), 'populated secret');
  assert.equal(labels("  SECRET = 'SECRETS_MANAGER_ARN',", TS), 'populated secret');
});

test('a key that merely ends like a secret key is not self-named', () => {
  // The key alternation matches by substring, so without a leading boundary the regex
  // would start inside the longer name and find a value equal to *that* — exempting a
  // real credential in TypeScript too.
  assert.equal(labels('  POSTGRES_PASSWORD: "password"', TS), 'populated secret');
  assert.equal(labels("  const DB_PASSWORD = 'password';", TS), 'populated secret');
});

// A credential that happens to be spelled like its key is still a credential. The `i`
// this exemption once carried applied to the backreference too, so `PASSWORD = 'password'`
// and `password: 'password'` — a hardcoded dev credential in a config object — wore the
// enum member's exemption. Only the shipped shape is exempt: UPPER_SNAKE key, value
// spelled identically.
test('a self-named value is exempt only in the exact case of its key', () => {
  assert.equal(labels("const PASSWORD = 'password';", TS), 'populated secret');
  assert.equal(labels("const SECRET = 'secret';", TS), 'populated secret');
  assert.equal(labels("  password: 'password',", TS), 'populated secret');
  assert.equal(labels("  PASSWORD: 'Password',", TS), 'populated secret');
  // The shape the exemption exists for, unchanged.
  assert.equal(flagged("  PASSWORD = 'PASSWORD',", TS), false);
});

// The whole UPPER_SNAKE key is what the value is compared against, not the secret word
// buried inside it. An earlier form captured only the alternation and blocked a match that
// started mid-name with a lookbehind. That kept `POSTGRES_PASSWORD = 'password'` flagged,
// which was the point, and it also flagged `INVALID_SECRET = 'INVALID_SECRET'` — a member
// of exactly the shape the exemption exists for, since the character before `SECRET` is an
// underscore. Comparing the value against the whole key does both jobs and says the rule
// more directly: a key is self-named when the value IS the key.
test('a self-named member whose key carries a prefix is still self-named', () => {
  assert.equal(flagged("  INVALID_SECRET = 'INVALID_SECRET',", TS), false);
  assert.equal(flagged("  EMAIL_TOKEN: 'EMAIL_TOKEN',", TS), false);
  // The cases the earlier anchor was added for, unchanged.
  assert.equal(labels('  POSTGRES_PASSWORD: "password"', TS), 'populated secret');
  assert.equal(labels("  const DB_PASSWORD = 'password';", TS), 'populated secret');
  // And still source-only: the same member in YAML is a credential.
  assert.equal(labels("  INVALID_SECRET = 'INVALID_SECRET',", YAML), 'populated secret');
});

// In TypeScript a populated secret must be a QUOTED literal, because TypeScript has no
// unquoted string literals: an unquoted bare word after a colon is a reference to a binding,
// not a credential. This is the rule that dissolves the `secret: <reference>` false-positive
// class — a whole task's worth of them, which had already pushed working code into shapes
// chosen by the gate rather than by the domain.
test('an unquoted value in TypeScript is a reference to a binding, not a credential', () => {
  assert.equal(flagged('  secret: candidateSecret,', TS), false);
  assert.equal(flagged('  token: refreshToken,', TS), false);
  assert.equal(flagged('    return { secret: hashedSecret, token: issuedToken };', TS), false);
  assert.equal(flagged('  const secret = candidateSecret;', TS), false);
  // Quote the very same value and it is a literal again, so it flags.
  assert.equal(labels("  secret: 'candidateSecret',", TS), 'populated secret');
});

// FALSE POSITIVES, fixed. `isTypeScriptFile` used to be `/\.tsx?$/`, so a `.vue` single-file
// component's `<script setup lang="ts">` block — which IS TypeScript — was judged by the rule
// written for YAML and env files, where an unquoted value after a colon or equals genuinely is
// a literal. Every shape below is a reference or an annotation, not a credential, and each one
// is the mirror image of a case already pinned above for `.ts`; only the file extension
// differs. Before the classifier was corrected, three template files were restructured to
// work around these false positives rather than the gate being fixed — which is why the
// cases are pinned here: the misclassification is the kind that gets accommodated silently.
test('a .vue file is judged as TypeScript, not as YAML — the misclassification is fixed', () => {
  assert.ok(isTypeScriptFile('component.vue'));
  assert.ok(isTypeScriptFile('Nested/Path/Thing.vue'));
  // A reference passed straight through, exactly as it would read in the .ts case above.
  assert.equal(flagged('secret: secretInput.value,', VUE), false);
  // The `=` of `===`, not an assignment.
  assert.equal(flagged("route.query.token === 'string' ? route.query.token : ''", VUE), false);
  // An empty ref — no quoted secret was ever written down.
  assert.equal(flagged("const secret = ref('');", VUE), false);
  // A bare type annotation, not a value.
  assert.equal(flagged('secret: string;', VUE), false);
  // A multi-word key (camelCase), unquoted — still a reference, not a literal.
  assert.equal(flagged('const accessKey = computed(() => currentAccessKey.value);', VUE), false);
  // A real, quoted credential in a .vue script is still caught — the fix does not create a
  // hole, it removes a false positive that only existed because the file type was misjudged.
  assert.equal(labels("const secret = 'hunter2';", VUE), 'populated secret');
  assert.equal(labels("  password: 'hunter2',", VUE), 'populated secret');
});

// LATENT AND DELIBERATELY UNHANDLED, pinned so it is a decision and not a rediscovery. A .vue
// *template* binding is quoted by HTML attribute syntax, not by a TypeScript string literal —
// `:token="tokenRef"` is a reference (the quotes delimit the attribute, not a JS string), but
// POPULATED_SECRET_TS cannot tell that apart from a genuine quoted literal, because doing so
// would need to know which part of the file it is looking at (script vs. template), and this
// gate judges one line at a time with no memory of the file's structure. Nothing in template/
// or tools/ binds a secret-named prop to a bare reference today, so this trades zero real
// coverage for the four false positives the fix above removes — but the trade only holds while
// the shape stays hypothetical, so it is pinned here rather than left to be found by surprise.
// If this ever needs to pass, it is a `sanitize:allow` case like any other reviewed exemption,
// not a reason to widen the rule.
test('a .vue template binding quoted by HTML syntax is a documented, unhandled false positive', () => {
  assert.equal(labels(':token="tokenRef"', VUE), 'populated secret');
  assert.equal(labels(':password="candidateSecret"', VUE), 'populated secret');
});

// RE-ARGUED. `PASSWORD: hunter2` and `token: hunter2` were pinned here as FLAGGING in a `.ts`
// file, to stop the type-annotation exemption widening from a closed list of primitive type
// names to "any bare word after a colon" — a widening that would have exempted `token: hunter2`
// along with `token: string`. That protection was real and is why those pins existed.
//
// The quoted-literal rule removes the thing they guarded: there is no list of tolerated type
// names left to widen, because in TypeScript nothing unquoted matches at all. So the original
// assertions invert — and they must, since `PASSWORD: hunter2` in TypeScript is a reference to
// a binding named `hunter2`, which is the exact false-positive class this change exists to end.
//
// But the pins were never really about the text `hunter2`. They were about a credential spelled
// `<secret key>: hunter2` not escaping the gate. That protection is kept, re-expressed twice:
// in TypeScript, in the only form the credential can actually take there (quoted); and
// unquoted, in the file types where an unquoted value genuinely is a literal and the original
// rule still applies unchanged. Widening either rule to swallow these fails this test, which is
// what the originals were for.
test('the credential the bare-word pins protected is still flagged, in each form it can take', () => {
  assert.equal(labels("PASSWORD: 'hunter2'", TS), 'populated secret');
  assert.equal(labels('  token: "hunter2",', TS), 'populated secret');
  assert.equal(labels('  secret: `hunter2`,', TS), 'populated secret');
  // Unquoted, the same lines are references in TypeScript — and still literals everywhere else.
  assert.equal(flagged('PASSWORD: hunter2', TS), false);
  assert.equal(labels('PASSWORD: hunter2', YAML), 'populated secret');
  assert.equal(labels('  token: hunter2,', ENV), 'populated secret');
  assert.equal(labels('DB_PASS: correct-horse-battery', 'deploy.conf'), 'populated secret');
});

// A quoted initializer sitting behind a type annotation is a real credential shape, and it was
// flagged before the quoted-literal rule (by accident: the annotation's own type name counted
// as the value). Keeping it flagged is why the rule accepts `KEY: <type> = <quoted>` as well as
// `KEY: <quoted>` — otherwise this change would have quietly traded one false negative in.
test('a quoted initializer behind a type annotation is still a populated secret', () => {
  assert.equal(labels("  private readonly secret: string = 'dev-secret';", TS), 'populated secret');
  assert.equal(labels("  token: string | undefined = 'literal';", TS), 'populated secret');
  // The annotation alone is still not a value.
  assert.equal(flagged('  secret: string | undefined;', TS), false);
  // The annotation stops at its own declaration: a `,` or `;` ends it, so an unrelated default
  // further along the line is not attributed to the annotated secret parameter.
  assert.equal(flagged("function f(secret: string, name = 'bob') {}", TS), false);
  assert.equal(flagged("  { secret: string; name = 'bob' }", TS), false);
});

// FALSE POSITIVE, fixed. `stripInterpolations` removes every `${...}` span, so a template
// literal like `` `${webappUrl}/reset-password?token=${value}` `` reduces to
// `` `/reset-password?token=` `` — the enclosing literal's own CLOSING backtick lands
// immediately after `token=`. The old POPULATED_SECRET_TS pattern asked only "is the next
// character a quote, and the one after that not a quote", so it read that closing backtick as
// the OPENING quote of a fresh one-character literal and flagged it, even though nothing here
// is hard-coded — no key is ever assigned a literal value. Requiring an actual matching close
// (the same quote character, after real content) is what tells the two apart.
test('an interpolated value inside a template literal is not a populated secret', () => {
  assert.equal(
    flagged('const link = `${webappUrl}/reset-password?token=${value}`;', TS),
    false,
  );
  assert.equal(flagged('const link = `${base}/verify?token=${t}`;', TS), false);
  assert.equal(flagged('password=${pw}`;', TS), false);
  // The isolated shape the fix turns on: a quote character with nothing after it to close it
  // is not a literal, no matter how it got there.
  assert.equal(flagged('token=`;', TS), false);
  // A real secret in the very same delimiter is still caught — the fix requires a genuine
  // closing quote of the same type, and one is right there.
  assert.equal(labels('const password = `hunter2`;', TS), 'populated secret');
});

// The miss this false positive sits next to, and NOT widened into a catch. `token=abc`, with
// no quote character at all after the separator, does not match — by the same "unquoted is a
// reference" design as the rest of this file's TypeScript rule, not because of anything this
// fix changed. Widening it was investigated and rejected: this exact shape already exists as a
// harmless real fixture — `template/apps/backend/src/mail/__tests__/FileMailer.spec.ts` reads
// `body: 'Open this link: https://example.com/verify?token=abc'` — so any pattern that catches
// `token=abc` here catches that fixture too, trading a documented gap for a new false positive.
test('a hard-coded literal inside a template literal, unquoted at the key site, is a documented miss', () => {
  assert.equal(flagged('const link = `${base}/verify?token=abc`;', TS), false);
});

test('a line carrying both an exempt shape and a real secret is still flagged', () => {
  // Why the exemption strips spans rather than skipping the line: one exempt match must
  // never buy amnesty for the rest of the line.
  assert.equal(
    labels("  { PASSWORD = 'PASSWORD', API_KEY = 'live-key-value' }", TS),
    'populated secret',
  );
  assert.equal(labels("  SECRET: 'SECRET', token: 'hunter2'", TS), 'populated secret');
});

test('the ordinary English the rules deliberately tolerate is not flagged', () => {
  assert.equal(flagged('Eventually the emitted events settle and we issue tickets.', 'a.md'), false);
  assert.equal(flagged('app.enableCors({ origin: true, credentials: true });', TS), false);
  assert.equal(flagged('This payment-free, event-free sentence is ordinary prose.', 'a.md'), false);
});

test('a leaked domain name is flagged in the shapes it actually takes', () => {
  assert.equal(labels('const eventId = 1;', TS), 'source-domain identifier');
  assert.equal(labels('export class PaymentService {}', TS), 'source-domain type name');
  assert.equal(labels('EVENT_CREATED = 1', TS), 'source-domain constant');
  assert.equal(labels("import './events.module';", TS), 'source-domain module');
  assert.equal(labels('an rsvp from an organizer', 'a.md'), 'source-domain term');
});

// FALSE POSITIVES, fixed. `event`, `payment` and `ticket` are how the source domain leaks
// (eventId, EventCard, RefundPayment), but they are ALSO how the DOM and a couple of platform
// APIs spell their own, unrelated vocabulary — lexically the same characters, so no regex can
// tell the two apart. The fix is a closed accept-list of the exact DOM/platform identifiers,
// checked against the WHOLE identifier a match sits inside. Every one of these names comes
// straight from the two lists this task was handed: the DOM event-handling calls and their
// conventional parameter names, the base Event/EventTarget/EventEmitter infrastructure, the
// Payment Request API, and every specific *Event interface currently reachable from this
// stack's targets (browser DOM, Vue/Nuxt synthetic events).
test('DOM event-handling calls are not flagged as a domain leak', () => {
  assert.equal(flagged('el.addEventListener("click", handler);', TS), false);
  assert.equal(flagged('el.removeEventListener("click", handler);', TS), false);
  assert.equal(flagged('el.dispatchEvent(new CustomEvent("open"));', TS), false);
  assert.equal(flagged('function onEvent(nativeEvent: Event) {}', TS), false);
  assert.equal(flagged('const eventListener = (e: Event) => {};', TS), false);
  assert.equal(flagged('const eventName = "click";', TS), false);
});

test('the base DOM Event type and its infrastructure are not flagged as a domain leak', () => {
  assert.equal(flagged('function handle(e: Event) {}', TS), false);
  assert.equal(flagged('const target: EventTarget = el;', TS), false);
  assert.equal(flagged('let listener: EventListener;', TS), false);
  assert.equal(flagged('const source = new EventSource(url);', TS), false);
  assert.equal(flagged('const init: EventInit = { bubbles: true };', TS), false);
  assert.equal(flagged("import { EventEmitter } from 'node:events';", TS), false);
});

// The Payment Request API — the browser platform's own "Payment" vocabulary, not the source
// domain's payment entity.
test('the Payment Request API is not flagged as a domain leak', () => {
  assert.equal(flagged('const request: PaymentRequest = new PaymentRequest(m, d);', TS), false);
  assert.equal(flagged('async function onResponse(r: PaymentResponse) {}', TS), false);
});

// Every specific *Event interface this stack's targets can produce (browser DOM, Vue/Nuxt
// synthetic events). One assertion per interface named in this task's false-positive list —
// each is its own case, not folded into a loop, so a single accept-list typo or omission
// names the exact interface that regressed rather than an opaque loop failure.
test('every specific DOM event interface is not flagged as a domain leak', () => {
  assert.equal(flagged('function on(e: UIEvent) {}', TS), false);
  assert.equal(flagged('function on(e: CustomEvent) {}', TS), false);
  assert.equal(flagged('function on(e: KeyboardEvent) {}', TS), false);
  assert.equal(flagged('function on(e: MouseEvent) {}', TS), false);
  assert.equal(flagged('function on(e: PointerEvent) {}', TS), false);
  assert.equal(flagged('function on(e: SubmitEvent) {}', TS), false);
  assert.equal(flagged('function on(e: InputEvent) {}', TS), false);
  assert.equal(flagged('function on(e: FocusEvent) {}', TS), false);
  assert.equal(flagged('function on(e: TouchEvent) {}', TS), false);
  assert.equal(flagged('function on(e: WheelEvent) {}', TS), false);
  assert.equal(flagged('function on(e: DragEvent) {}', TS), false);
  assert.equal(flagged('function on(e: ClipboardEvent) {}', TS), false);
  assert.equal(flagged('function on(e: ProgressEvent) {}', TS), false);
  assert.equal(flagged('function on(e: MessageEvent) {}', TS), false);
  assert.equal(flagged('function on(e: CloseEvent) {}', TS), false);
  assert.equal(flagged('function on(e: ErrorEvent) {}', TS), false);
  assert.equal(flagged('function on(e: PopStateEvent) {}', TS), false);
  assert.equal(flagged('function on(e: HashChangeEvent) {}', TS), false);
  assert.equal(flagged('function on(e: StorageEvent) {}', TS), false);
  assert.equal(flagged('function on(e: AnimationEvent) {}', TS), false);
  assert.equal(flagged('function on(e: TransitionEvent) {}', TS), false);
  assert.equal(flagged('function on(e: CompositionEvent) {}', TS), false);
  assert.equal(flagged('function on(e: BeforeUnloadEvent) {}', TS), false);
});

// DECISION, pinned. UIEvent already survived the two identifier-shape rules before this
// change — by accident, not by anyone's design: `[a-z](Event...)` needs a lowercase letter
// immediately before "Event" and finds the uppercase "I" instead, and `\bEvent...` needs a
// word boundary immediately before "Event" and finds none (word characters on both sides of
// "UIEvent"). An accidental pass is indistinguishable from a deliberate one until someone
// writes it down, so UIEvent is listed on the accept-list explicitly — it is the ancestor of
// every other *Event interface above and belongs there on its own merits, independent of
// whichever other rule also happens to miss it.
test('UIEvent surviving is now a deliberate accept-list entry, not an accident of the regex', () => {
  assert.ok(DOM_AND_PLATFORM_IDENTIFIERS.has('UIEvent'));
});

// The point of checking the WHOLE identifier, not the substring a rule matched: a domain leak
// that merely shares a prefix with an accepted DOM identifier must still trip. `EventCard`
// contains the same "Event" the accept-list's `EventTarget` does; `RefundPayment` contains the
// same "Payment" `PaymentRequest` does. Only an exact, whole-identifier match is exempt.
//
// `RefundPayment` now also trips `source-domain term` alongside `source-domain identifier` —
// a second, independent true positive this task's camelCase/PascalCase boundary fix surfaces,
// not a regression: "Refund" is a real `source-domain term` entry (no innocent generic use,
// unlike "event"/"payment"/"ticket") and `RefundPayment` is exactly the no-separator compound
// shape that rule was blind to before this task.
test('a domain leak sharing a prefix with an accepted DOM identifier still trips', () => {
  assert.equal(labels('export class EventCard {}', TS), 'source-domain type name');
  assert.equal(
    labels('export class RefundPayment {}', TS),
    'source-domain term,source-domain identifier',
  );
  assert.equal(labels('export interface TicketTier {}', TS), 'source-domain type name');
});

// Every identifier this task named as a required catch, each in the shape it would actually
// leak in. `EventsService` needs its realistic NestJS constructor-injection shape — the bare
// lowerCamelCase parameter name alone (`eventsService`) does not, on its own, match any
// identifier-shape rule (no capital letter follows "events", and no capital "Event" appears);
// it is caught because its declared TYPE (`EventsService`) is right there on the same line, as
// it always would be in real constructor-injection code. That is unchanged by this task — it
// is how the rule worked before this fix and is not something the accept-list touches.
test('every identifier this fix must not let through is still flagged', () => {
  assert.equal(labels('const eventId = 1;', TS), 'source-domain identifier');
  assert.equal(labels('let myEvent = load();', TS), 'source-domain identifier');
  assert.equal(labels('export class EventCard {}', TS), 'source-domain type name');
  assert.equal(
    labels('constructor(private readonly eventsService: EventsService) {}', TS),
    'source-domain type name',
  );
  assert.equal(labels('const ticketId = ticket.id;', TS), 'source-domain identifier');
  assert.equal(labels('export interface TicketTier {}', TS), 'source-domain type name');
  assert.equal(labels('const paymentIntent = createIntent();', TS), 'source-domain identifier');
  // See the comment on the previous test: `RefundPayment` now also trips `source-domain
  // term`, a genuine second catch this task's fix surfaces, not a regression.
  assert.equal(
    labels('export class RefundPayment {}', TS),
    'source-domain term,source-domain identifier',
  );
});

// The rules this task does not touch at all — a bare "event"/"Event"/"payment"/"ticket" in
// ordinary prose, and CORS's own `credentials` config flag — keep behaving exactly as before.
test('the ordinary English and platform config the rules already tolerated still is', () => {
  assert.equal(flagged('preventDefault(); onkeydown(); $event;', TS), false);
  assert.equal(flagged('Eventually the eventual type resolves.', 'a.md'), false);
  assert.equal(flagged('class="pointer-events-none"', TS), false);
});

// pathFindings runs the same identifier-shape rules against a file PATH, and the accept-list
// applies there too: a file legitimately named after a DOM interface must not be flagged, but
// a file named after the domain leak still must be — even sharing the same "Event" prefix.
test('the accept-list applies to paths as well as line content', () => {
  assert.deepEqual(pathFindings('template/apps/webapp/src/composables/EventTarget.ts'), []);
  assert.deepEqual(pathFindings('template/apps/webapp/src/components/EventCard.vue'), [
    'source-domain type name',
  ]);
});

test('paths are held to the path-only rules as well as the content rules', () => {
  assert.deepEqual(pathFindings('template/docs/events-overview.md'), ['source-domain path term']);
  assert.deepEqual(pathFindings('template/libs/core/src/users/entities/User.ts'), []);
});

// The scan must run when the file is the entry point and must not run when it is
// imported — this test file itself is the proof of the second half, since importing the
// module above neither walked the tree nor exited this process. The first half is worth
// a real invocation: a guard that silently stopped matching would turn `npm run
// sanitize` into a gate that scans nothing and reports nothing, which is exactly the
// vacuous pass the script's own zero-file check exists to prevent.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gate = path.join(repoRoot, 'tools', 'sanitize.mjs');

test('the CLI entry point still runs the scan and reports clean', () => {
  const output = execFileSync(process.execPath, [gate], { encoding: 'utf8' });
  assert.match(output, /^Sanitization: clean \(\d+ file\(s\) scanned/);
});

// Invoked through a symlink, the guard used to match nothing: no scan, no output, exit 0.
// A gate that passes silently because of how it was invoked is worse than one that fails.
test('the entry point is recognised through a symlink', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sanitize-'));
  try {
    const link = path.join(dir, 'san-link.mjs');
    fs.symlinkSync(gate, link);
    const output = execFileSync(process.execPath, [link], { encoding: 'utf8' });
    assert.match(output, /^Sanitization: clean \(\d+ file\(s\) scanned/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The gate used to skip its own file entirely, which meant a clean run said nothing at all
// about this one script — the rules that apply to every other file under `tools/` were
// unenforced exactly where the vocabulary is most likely to be typed. It is scanned now, with
// one marked region allowed: the rule definitions, which cannot avoid spelling the terms.
// Everything outside that region is held to the rules like any other file.
test('the gate scans its own file outside its rule-definition region', () => {
  const lines = fs.readFileSync(gate, 'utf8').split('\n');
  const region = ruleDefinitionRegion(lines);
  assertScannerOutsideRegion(lines, region);
  const unexpected = [];
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (lineNumber >= region.start && lineNumber <= region.end) return;
    if (line.includes('sanitize:allow')) return;
    for (const label of lineFindings(line, gate)) {
      unexpected.push(`${lineNumber}  ${label}  ${line.trim()}`);
    }
  });
  assert.deepEqual(unexpected, []);
  assert.deepEqual(pathFindings(gate), []);
});

// The region is an allowance, not a second exclusion: it has to be visible in the run's own
// output, the same way every inline marker is, or it becomes a whole-file skip wearing a
// narrower name.
test('the run reports the rule-definition region as a deliberate allowance', () => {
  const output = execFileSync(process.execPath, [gate], { encoding: 'utf8' });
  assert.match(output, /sanitize\.mjs:\d+-\d+ {2}rule definitions/);
});

// A region delimited by markers can be silently widened by moving one of them, or silently
// deleted by dropping one. Neither is allowed to degrade into a pass.
test('a malformed rule-definition region is refused, not tolerated', () => {
  const begin = '// sanitize:rule-definitions-begin';
  const end = '// sanitize:rule-definitions-end';
  assert.throws(() => ruleDefinitionRegion(['a', 'b']), /exactly one/);
  assert.throws(() => ruleDefinitionRegion([begin, 'b']), /exactly one/);
  assert.throws(() => ruleDefinitionRegion([begin, begin, end]), /exactly one/);
  assert.throws(() => ruleDefinitionRegion([end, begin]), /before/);
  assert.deepEqual(ruleDefinitionRegion(['x', begin, 'y', end, 'z']), { start: 2, end: 4 });
});

// Counting the markers and ordering them says nothing about how much they enclose, and the
// failure that matters is extent: move the end marker to the bottom of the file and the
// whole-file exemption is back, wearing a region's name and changing nothing visible but a
// number in the run's output. The oracle below is the gate's own scanner declarations, read
// out of the source independently of where the markers sit — so a marker that moves over one
// of them fails here instead of quietly redefining what the test expects.
test('the region cannot be widened over the scanner machinery', () => {
  const lines = fs.readFileSync(gate, 'utf8').split('\n');
  const region = ruleDefinitionRegion(lines);
  const declaration = (text) => {
    const index = lines.findIndex((line) => line.startsWith(text));
    assert.notEqual(index, -1, `no line starts with ${text}`);
    return index + 1;
  };
  for (const text of ['export function pathFindings(', 'async function main(', 'function isEntryPoint(']) {
    const line = declaration(text);
    assert.ok(line > region.end, `${text} is at ${line}, inside the region ${region.start}-${region.end}`);
  }
  assert.ok(declaration('const ROOTS =') < region.start);

  // The same check the gate runs on every scan, against the widened region a moved end
  // marker would produce.
  assert.throws(
    () => assertScannerOutsideRegion(lines, { start: region.start, end: lines.length }),
    /encloses .+ the scanner itself is never exempt/,
  );
  // An anchor that silently stops matching is a guard that silently stops guarding.
  assert.throws(() => assertScannerOutsideRegion([], region), /exactly once/);
  assertScannerOutsideRegion(lines, region);
});

// The template ships organizations, and an invitation is how somebody joins one, so
// organization invitations are a first-class concept in every generated
// project and the gate cannot treat the noun as evidence of a leak. What it must
// still catch is the shape a leak actually takes — a domain compound — which for this
// concept is the qualifier in front of it, not the word itself.
test('the template\'s own invitation vocabulary is admitted', () => {
  assert.equal(flagged('export class Invitation {', TS), false);
  assert.equal(flagged("import { InvitationsService } from './invitations.service';", TS), false);
  assert.equal(flagged('  INVITATION_ACCEPTED = \'INVITATION_ACCEPTED\',', TS), false);
  assert.equal(pathFlagged('apps/backend/src/organizations/invitations.controller.ts'), false);
});

// The narrowing above must not become a hole. A source-project trace is still a trace
// wherever it appears, including on a line that also says "invitation".
test('a source-project trace on an invitation line is still flagged', () => {
  assert.equal(labels('// see voku for the original invitation flow', TS), 'source-project trace');
});

// Triage item 3 from Phase 3: the bare-word `source-domain term` rule used plain `\b` on
// both sides, and `\b` in JS is a word/non-word transition only — letters are "word"
// characters regardless of case, so it is blind to the one separator a no-space compound
// identifier actually uses: a lowercase-to-uppercase transition. `organizer`/`rsvp`/
// `stripe`/`refund` slipped every PascalCase or camelCase compound they appeared inside
// (`OrganizerInvitation`, `organizerInvitation`) even though the kebab- and snake-case
// spellings of the same compound (`organizer-invitation`, `organizer_invitation`) were
// already caught, because `-`/`_` are non-word characters `\b` already fires on.
//
// NOTE: the brief for this task illustrated the shape with `OrganizationInvitation` —
// but neither "organization" nor "invitation" is a banned term (invitation is this
// template's own vocabulary, deliberately removed from RULES; see above), so that exact
// string does not trip any rule before or after this fix and would be a check that can
// never fail. Restated here with `organizer` (a real `source-domain term` entry) so the
// case is one this fix is actually observed to flip from failing to passing.
test('a banned term is caught inside a PascalCase identifier', () => {
  // The exact shape that slipped: no separator, capital boundary.
  assert.equal(labels('export class OrganizerInvitation {}', TS), 'source-domain term');
});

test('a banned term is caught inside a camelCase identifier', () => {
  assert.equal(labels('const organizerInvitation = 1;', TS), 'source-domain term');
});

// The boundary is symmetric: the transition matters on the way INTO the term too, not just
// on the way out of it (the two cases above both happen to test the trailing side, since
// the term there is the first word in the identifier). `myOrganizerId` puts "Organizer"
// mid-compound, so only the lowercase-to-uppercase transition on its leading side — not a
// non-letter or start-of-string — can supply the boundary.
test('a banned term is caught when it starts mid-compound, not just when it leads', () => {
  assert.equal(labels('const myOrganizerId = 1;', TS), 'source-domain term');
});

test('a word that merely contains the term as a substring is not a violation', () => {
  // The rule must not fire on a longer word that happens to contain the letters with no
  // case transition on either side — otherwise the next person turns it off rather than
  // narrowing it. Neither side of "organizer" here is a boundary: "re" before it and
  // "less" after it are both plain lowercase continuations.
  assert.equal(flagged('const reorganizerless = 1;', TS), false);
});

// A digit is a boundary on either side, which is wider than `\b` gives — a digit is a word
// character, so `\borganizer\b` matches neither spelling below. The widening falls out of
// `isLetter` being letters-only rather than word-character-wide, so it has always been live
// and was never written down or exercised. Pinned here so a later narrowing of `isLetter`
// cannot drop it silently.
test('a banned term is caught against a digit on either side', () => {
  assert.equal(labels('const organizer1 = 1;', TS), 'source-domain term');
  assert.equal(labels('const x1organizer = 1;', TS), 'source-domain term');
});

// The lowercase-to-uppercase transition is not the only compound boundary an identifier
// uses: an acronym run supplies one too. `API|Organizer` has no lowercase character before
// the term, so the leading test's lower-to-upper transition never fires and the whole
// compound slipped. The standard acronym rule is that a word begins at an uppercase letter
// followed by a lowercase one — the `O` of `Organizer`, which `r` follows.
test('a banned term is caught after an acronym run', () => {
  assert.equal(labels('class APIOrganizerService {}', TS), 'source-domain term');
  // The trailing side of the same compound: already caught, pinned so the leading-side
  // widening cannot regress it.
  assert.equal(labels('class OrganizerAPIService {}', TS), 'source-domain term');
});

// The other half of what `APIOrganizerService` needed. `organizers?` is case-insensitive, so
// its optional plural swallows the capital `S` that starts the next word, and the match ends
// one character inside `Service` — where the trailing-boundary check finds a lowercase `e`
// and refuses. A match whose last character is uppercase after a lowercase one has over-run
// into the next word, and that capital is the boundary.
test('an optional plural that swallows the next word\'s capital still bounds', () => {
  assert.equal(labels('const organizerService = 1;', TS), 'source-domain term');
  assert.equal(labels('const refundService = 1;', TS), 'source-domain term');
  // The same over-run in an all-caps spelling. Recognising the swallowed capital by its own
  // shape caught only the lowercase spelling; retrying the shorter alternative the pattern
  // could have matched closes the class instead of one more spelling of it.
  assert.equal(labels('class REFUNDService {}', TS), 'source-domain term');
  assert.equal(labels('class ORGANIZERService {}', TS), 'source-domain term');
});

// An all-caps run offers no boundary, in either direction, for the same reason a lowercase
// run does not: there is no case transition anywhere in `APIORGANIZER`, so nothing marks the
// term off from the letters before it. This is the uppercase twin of `reorganizerless`, not
// a variant of the over-run above — the shorter alternative is retried here too and is still
// unbounded on its leading side. Pinned because the alternative, treating any uppercase
// neighbour as a boundary, would flag an ordinary ALL_CAPS word that merely contains a term.
test('a term buried in an all-caps run is not a violation, either side', () => {
  assert.equal(flagged('class APIORGANIZERService {}', TS), false);
  assert.equal(flagged('const REORGANIZERLESS = 1;', TS), false);
});

// Forge's own process vocabulary. This leaked into template/ three times in one phase
// despite an explicit instruction not to (task-18's own report) — the briefs handed to
// implementers are extracted verbatim from a planning document that legitimately contains
// dozens of the same references, so the instruction and the contamination arrive together.
test('a Forge task or phase coordinate is flagged, capitalized and spaced', () => {
  assert.equal(
    labels('// Task 12 registered OAuthService here.', TS),
    'forge-process coordinate',
  );
  assert.equal(
    labels('// Phase 3 added organizations to core.', TS),
    'forge-process coordinate',
  );
  assert.equal(labels('See Task 6 for the carried finding.', 'a.md'), 'forge-process coordinate');
  // Plural with a range — the shape a citation of several at once takes ("Tasks 10–14").
  // The singular-only form of this rule saw straight past it.
  assert.equal(
    labels('// the grant codes of Tasks 10–14 arrived together', TS),
    'forge-process coordinate',
  );
  assert.equal(
    labels('// Phases 2 and 3 are where the audit table came from', TS),
    'forge-process coordinate',
  );
});

// NOT the bare, lowercase word — ordinary English this template's own comments are full of,
// and a coincidental digit nearby must not turn it into a false positive either.
test('the ordinary English word "task"/"phase" is not flagged', () => {
  assert.equal(flagged('This suite exercises none of the invitation mail.', TS), false);
  assert.equal(flagged('Complete the task 12 hours from now.', TS), false);
  assert.equal(flagged('There are 12 open tasks on the board.', TS), false);
  // Lowercase, so the plural widening above does not reach it either.
  assert.equal(flagged('Retry the 3 tasks 5 minutes apart.', TS), false);
});

// The register with no coordinate in it at all. "Task 12" is a citation; "this task" is the
// same sentence about the work that produced a line, written without numbering it — and it
// is the shape that actually shipped. Thirty-three of them reached `template/` while
// `forge-process coordinate` reported clean on every one, because a comment explaining why
// a line looks the way it does rarely says which numbered unit of work wrote it.
test('"this task" is flagged — the process register without a coordinate', () => {
  assert.equal(
    labels('// Read-only, unlike every other composable this task adds.', TS),
    'forge-process task provenance',
  );
  assert.equal(
    labels("// which is what this task's own injection proved", TS),
    'forge-process task provenance',
  );
  assert.equal(
    labels('A webapp-local form is out of scope for this task.', 'a.md'),
    'forge-process task provenance',
  );
  // Case-insensitive, unlike `forge-process coordinate`: there is no capitalized/lowercase
  // split to exploit here — a sentence opening "This task" is the same register.
  assert.equal(
    labels('This task ships six pages and tests three.', 'a.md'),
    'forge-process task provenance',
  );
  // One intervening word, which is all it took to walk past the adjacent-only form of this
  // rule. Both of these shipped inside `template/` with the gate green.
  assert.equal(
    labels('// the ADR-0008 failure this whole task exists to prevent', TS),
    'forge-process task provenance',
  );
  assert.equal(
    labels("// The brief for this file's task named the debt", TS),
    'forge-process task provenance',
  );
});

// The same register spelled with "phase". Scoped to the qualifiers that can only mean a
// unit of Forge's build-out, because the bare word cannot be separated from the generated
// application's own ceremony vocabulary — see the rule's comment.
test('a qualified Forge "phase" is flagged', () => {
  assert.equal(
    labels('// Only PASSWORD is implemented in this phase.', TS),
    'forge-process phase provenance',
  );
  assert.equal(
    labels('// a question for authorization in a later phase', TS),
    'forge-process phase provenance',
  );
  assert.equal(
    labels('// An earlier phase modelled this as one string field.', TS),
    'forge-process phase provenance',
  );
  assert.equal(
    labels('the message behind that phase\'s central security property', 'a.md'),
    'forge-process phase provenance',
  );
  // Plural, and the "a/an + adjective" slot both ways round.
  assert.equal(labels('// shipped in a previous phase', TS), 'forge-process phase provenance');
  assert.equal(labels('// two later phases rewrote it', TS), 'forge-process phase provenance');
  // This one used to be asserted as NOT flagged, on the grounds that it is ordinary
  // English. It is ordinary English about *planned work*, which is the register a generated
  // project has no use for, so it is now a finding.
  assert.equal(
    labels('The next phase of rollout adds SSO.', 'a.md'),
    'forge-process phase provenance',
  );
  // Relative-time words and a demonstrative that the first cut of this rule missed, though
  // the principle it states — a qualifier, never an ordinal — covers them. None occurs in
  // the tree; they are here so the rule matches the criterion it claims.
  assert.equal(labels('// a future phase may add SSO', TS), 'forge-process phase provenance');
  assert.equal(labels('// a prior phase modelled it that way', TS), 'forge-process phase provenance');
  assert.equal(labels('// the upcoming phase owns this', TS), 'forge-process phase provenance');
  assert.equal(labels('// the following phase ships the route', TS), 'forge-process phase provenance');
  assert.equal(labels('// these phases each added an action', TS), 'forge-process phase provenance');
});

// The generated application's own vocabulary: a sign-in really does happen in two phases,
// and every one of these appears in `template/` today. The rule must not reach them.
test('the ceremony sense of "phase" is not flagged', () => {
  assert.equal(flagged('// The second half of a two-phase sign-in.', TS), false);
  assert.equal(flagged("describe('the first phase of a sign-in', () => {", TS), false);
  assert.equal(flagged("describe('the second phase of a sign-in', () => {", TS), false);
  assert.equal(flagged('// suspended between the two phases.', TS), false);
  assert.equal(flagged('// The same second phase, proven by a recovery code.', TS), false);
  assert.equal(flagged('// makes login two-phase once the method is confirmed', TS), false);
});

// The rule is the bare phrase and nothing cleverer, so an ordinary English "task" that is
// not preceded by "this" stays unflagged — which is most of them.
test('"task" without the demonstrative is not flagged', () => {
  assert.equal(flagged('The task runner is configured in nx.json.', TS), false);
  assert.equal(flagged('Each task in the queue is retried once.', TS), false);
  assert.equal(flagged('const taskQueue = [];', TS), false);
  // No word boundary between "task" and "Queue", so the demonstrative form does not reach
  // into a compound identifier either.
  assert.equal(flagged('// this taskQueue drains on shutdown', TS), false);
  // The intervening-word allowance is exactly one word, so a "this" further off than that
  // does not drag an unrelated "task" in with it.
  assert.equal(flagged('// this is the only task the runner schedules', TS), false);
});

test('"coordinator" used in the process sense is flagged, including mid-compound', () => {
  // Two labels: "this task" is `forge-process task provenance` as well, and both are true.
  assert.equal(
    labels('// The coordinator dispatched this task.', TS),
    'forge-process task provenance,forge-process role',
  );
  // The same camelCase/PascalCase boundary fix `source-domain term` needed: no separator
  // marks the word off from its neighbour, only a case change.
  assert.equal(labels('class TaskCoordinator {}', TS), 'forge-process role');
  assert.equal(labels('const coordinatorService = 1;', TS), 'forge-process role');
});

test('"coordinate"/"coordinated"/"coordinates" are not flagged — a different word', () => {
  assert.equal(flagged('The x coordinate is out of range.', TS), false);
  assert.equal(flagged('The two services coordinate through an event bus.', TS), false);
  assert.equal(flagged('Retries are coordinated by the caller.', TS), false);
});

// "brief" alone is ordinary English and must not be flagged — only its process-sense
// co-occurrence with "task"/"phase"/"coordinator" is unambiguous enough to catch reliably.
test('"brief" is flagged only beside "task"/"phase"/"coordinator"', () => {
  // `forge-process task provenance` is also true of this line — "this task" is in it — so both
  // fire, for the same reason the coordinator case below reports two.
  assert.equal(
    labels("// Asserted per this task's brief —", TS),
    'forge-process task provenance,forge-process brief',
  );
  assert.equal(labels('// which the task brief names as the other half', TS), 'forge-process brief');
  assert.equal(labels("// the one the phase's brief names", TS), 'forge-process brief');
  // Both rules are true statements about this line — "coordinator" alone is also flagged by
  // `forge-process role` — so both labels fire, the same way a stripe key inside a populated
  // secret trips two rules elsewhere in this file.
  assert.equal(
    labels("// the coordinator's brief said so", TS),
    'forge-process role,forge-process brief',
  );
});

test('the ordinary English uses of "brief" are not flagged', () => {
  assert.equal(flagged('Kept the summary brief on purpose.', TS), false);
  assert.equal(flagged('A brief pause before the retry.', TS), false);
  assert.equal(flagged('This is explained briefly above.', TS), false);
  // A bare noun-sense "the brief", with no task/phase/coordinator nearby, is the documented
  // miss this narrowing accepts — see the rule's own comment for why.
  assert.equal(flagged('The brief this suite implements asked for a test reading:', TS), false);
});

test('a Forge task/phase coordinate in prose content is flagged as a path too', () => {
  assert.deepEqual(pathFindings('template/docs/Task 20/notes.md'), ['forge-process coordinate']);
});

// A realistic leaked FILE takes Forge's own report-naming convention: lowercase, hyphenated,
// not the capitalized prose shape above. Path-only, the same way `source-domain path term`
// covers the kebab-case shape a leaked domain-named file would realistically take.
test('a kebab-case Forge task/phase report filename is flagged, path-only', () => {
  assert.deepEqual(pathFindings('template/docs/task-20-report.md'), [
    'forge-process path coordinate',
  ]);
  assert.deepEqual(pathFindings('template/docs/phase-3-plan.md'), [
    'forge-process path coordinate',
  ]);
  // Content rules still apply to a path too — deliberately not exempted, the same guarantee
  // `pathFindings` already gives every RULES entry.
  assert.deepEqual(pathFindings('template/docs/Task 20 report.md'), [
    'forge-process coordinate',
  ]);
});
