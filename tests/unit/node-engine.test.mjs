import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRangeOf, nodeEngineReport, parseRange, satisfies } from '../helpers/node-engine.mjs';

// The range the template ships today is `>=22 <23`. It is quoted here as a FIXTURE — the
// thing under test — and nowhere else in the gate, which reads it from the generated
// project. If the template changes its range, these tests keep passing and the gate starts
// comparing against the new one, which is the whole point of the split.

test('a two-comparator conjunction admits exactly the declared major', () => {
  assert.equal(satisfies('22.0.0', '>=22 <23'), true);
  assert.equal(satisfies('22.11.0', '>=22 <23'), true);
  assert.equal(satisfies('22.99.99', '>=22 <23'), true);

  assert.equal(satisfies('21.9.0', '>=22 <23'), false);
  assert.equal(satisfies('23.0.0', '>=22 <23'), false);
  // The case this gate exists for: the Node this repository is developed on.
  assert.equal(satisfies('26.5.0', '>=22 <23'), false);
});

test('a leading v and a prerelease suffix are read, not refused', () => {
  assert.equal(satisfies('v22.11.0', '>=22 <23'), true);
  assert.equal(satisfies('23.0.0-nightly20260101', '>=22 <23'), false);
});

test('each comparator is applied with the right strictness', () => {
  assert.equal(satisfies('22.0.0', '>22'), false);
  assert.equal(satisfies('22.0.1', '>22'), true);
  assert.equal(satisfies('22.0.0', '<=22'), true);
  assert.equal(satisfies('22.0.1', '<=22'), false);
  assert.equal(satisfies('22.0.0', '=22'), true);
  assert.equal(satisfies('22.1.0', '=22'), false);
});

test('comparison runs position by position, so 22.9 does not outrank 22.10', () => {
  assert.equal(satisfies('22.9.0', '>=22.10'), false);
  assert.equal(satisfies('22.10.0', '>=22.10'), true);
});

// These four are the reason this helper exists at all. A range parser that answers "yes,
// satisfied" for syntax it cannot read reports a green that means nothing — the same defect
// as an inert grep that finds nothing and reads clean. Every unsupported form must be loud.
test('a range form this parser does not understand THROWS rather than passing', () => {
  assert.throws(() => satisfies('22.11.0', '^22.0.0'), /only understands/);
  assert.throws(() => satisfies('22.11.0', '22.x'), /only understands/);
  assert.throws(() => satisfies('22.11.0', '>=22 <23 || >=24'), /only understands|cannot read/);
  assert.throws(() => satisfies('22.11.0', ''), /empty/);
});

test('a bare version with no comparator is rejected, not guessed at', () => {
  // npm would read a bare `22.11.0` as an exact pin. This parser refuses instead of
  // choosing for it: guessing the operator is how a `<` gets read as a `<=`.
  assert.throws(() => parseRange('22.11.0'), /only understands/);
});

test('an unreadable version number is an error on either side of the comparison', () => {
  assert.throws(() => satisfies('lts/hydrogen', '>=22'), /the running Node version/);
  assert.throws(() => parseRange('>=twenty-two'), /engines\.node ">=twenty-two"/);
});

test('engineRangeOf refuses a package.json that declares nothing', () => {
  assert.equal(engineRangeOf({ engines: { node: '>=22 <23' } }), '>=22 <23');

  for (const missing of [{}, { engines: {} }, { engines: { node: '' } }, { engines: { node: 22 } }, null]) {
    assert.throws(
      () => engineRangeOf(missing, 'gateapp/package.json'),
      /declares no engines\.node/,
      `a package.json shaped like ${JSON.stringify(missing)} must not read as agreement`,
    );
  }
});

test('the report is null when the Node matches and names both sides when it does not', () => {
  assert.equal(
    nodeEngineReport({ declared: '>=22 <23', running: '22.11.0', where: 'gateapp/package.json' }),
    null,
  );

  const report = nodeEngineReport({
    declared: '>=22 <23', running: '26.5.0', where: 'gateapp/package.json',
  });
  assert.match(report, /NODE ENGINE MISMATCH/);
  // Both operands have to appear: a warning that says only "mismatch" sends the reader
  // looking for the two values it already had.
  assert.match(report, /gateapp\/package\.json declares {2}engines\.node = ">=22 <23"/);
  assert.match(report, /running under {2}node v26\.5\.0/);
});
