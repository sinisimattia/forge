import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineFindings, pathFindings } from '../../tools/sanitize.mjs';

// The gate's value is entirely in what it refuses, so every case below is stated as a
// line a real file could contain, and asserted in both directions: the lines that must
// still be caught, and the lines the rules deliberately tolerate. The exemptions
// narrowing the populated-secret rule are the reason this file exists — they can be
// widened by one character, and nothing else in the repository would notice.
const labels = (line) => lineFindings(line).join(',');
const flagged = (line) => lineFindings(line).length > 0;

test('a populated secret is flagged in each shape a real credential takes', () => {
  assert.equal(labels("  password: 'hunter2',"), 'populated secret');
  assert.equal(labels('DB_PASS: correct-horse-battery'), 'populated secret');
  assert.equal(labels('JWT_SECRET=s3cr3t-value'), 'populated secret');
  // Two rules, both of which should speak up about this line.
  assert.equal(
    labels("const API_KEY = 'sk_live_51HxxxxxxxxxxYYYYYYYY'"),
    'stripe-style key,populated secret',
  );
});

test('a key, a private key block and a source-project trace are flagged', () => {
  assert.equal(labels('-----BEGIN RSA PRIVATE KEY-----'), 'private key');
  assert.equal(labels('BEGIN PRIVATE KEY'), 'private key');
  assert.equal(labels('const publishable = pk_live_abcdef;'), 'stripe-style key');
  assert.equal(labels('https://github.com/example/voku'), 'source-project trace');
  assert.equal(labels('// extracted from Voku'), 'source-project trace');
});

test('a value that cannot be a secret is not flagged', () => {
  // An unsubstituted token, an interpolation, and an empty value: the three original
  // exemptions, all of which are structurally incapable of carrying a credential.
  assert.equal(flagged('DB_PASSWORD=__FORGE_NAME__'), false);
  assert.equal(flagged('  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}'), false);
  assert.equal(flagged('POSTGRES_PASSWORD:'), false);
  assert.equal(flagged('API_KEY='), false);
});

test('a string enum member naming itself is not a populated secret', () => {
  assert.equal(flagged("  PASSWORD = 'PASSWORD',"), false);
  assert.equal(flagged('  PASSWORD = "PASSWORD",'), false);
  assert.equal(flagged("  SECRET: 'SECRET',"), false);
});

test('a TypeScript type annotation is not a populated secret', () => {
  assert.equal(flagged('  secret: string;'), false);
  assert.equal(flagged('  readonly token: string,'), false);
  assert.equal(flagged('  apiSecret?: string;'), false);
  assert.equal(flagged('  token: string | undefined'), false);
  assert.equal(flagged('function sign(secret: string): string'), false);
});

// The edges are the point. An exemption is only as good as the cases it refuses to
// cover, and each of these is one character away from a case it does cover.
test('a value that merely starts like its key is still flagged', () => {
  assert.equal(labels("  PASSWORD = 'PASSWORD_FILE_PATH',"), 'populated secret');
  assert.equal(labels("  SECRET = 'SECRETS_MANAGER_ARN',"), 'populated secret');
});

test('a bare word after a colon that is not a primitive type is still flagged', () => {
  assert.equal(labels('PASSWORD: hunter2'), 'populated secret');
  assert.equal(labels('  token: hunter2,'), 'populated secret');
  // `=` never introduces an annotation, so the annotation exemption must not reach it.
  assert.equal(labels('  secret = string'), 'populated secret');
});

test('a line carrying both an exempt shape and a real secret is still flagged', () => {
  // Why the exemptions strip spans rather than skipping the line: one exempt match must
  // never buy amnesty for the rest of the line.
  assert.equal(
    labels("  { PASSWORD = 'PASSWORD', API_KEY = 'live-key-value' }"),
    'populated secret',
  );
  assert.equal(labels('  secret: string; token: hunter2'), 'populated secret');
});

test('the ordinary English the rules deliberately tolerate is not flagged', () => {
  assert.equal(flagged('Eventually the emitted events settle and we issue tickets.'), false);
  assert.equal(flagged('app.enableCors({ origin: true, credentials: true });'), false);
  assert.equal(flagged('This payment-free, event-free sentence is ordinary prose.'), false);
});

test('a leaked domain name is flagged in the shapes it actually takes', () => {
  assert.equal(labels('const eventId = 1;'), 'source-domain identifier');
  assert.equal(labels('export class PaymentService {}'), 'source-domain type name');
  assert.equal(labels('EVENT_CREATED = 1'), 'source-domain constant');
  assert.equal(labels("import './events.module';"), 'source-domain module');
  assert.equal(labels('an rsvp from an organizer'), 'source-domain term');
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
test('the CLI entry point still runs the scan and reports clean', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const output = execFileSync(process.execPath, [path.join(repoRoot, 'tools', 'sanitize.mjs')], {
    encoding: 'utf8',
  });
  assert.match(output, /^Sanitization: clean \(\d+ file\(s\) scanned/);
});
