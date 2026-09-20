/**
 * Does the Node running this gate satisfy the Node the generated project asks for?
 *
 * The generated-project gate runs under whatever Node the developer happens to have.
 * Locally that is node 26; the template declares `engines.node` as a range that does not
 * include it, and both Dockerfiles pin node 22. CI is unaffected (`setup-node@v4`, node 22),
 * so the exposure is bounded to local runs — but a local green then means "this template
 * passed on a Node it says it does not support", and a Node-22-only failure is invisible to
 * exactly the person most likely to meet it.
 *
 * Everything here is derived from the generated project's OWN `package.json`. Nothing in this
 * file restates the range. Two claims went stale in Phase 2 because they were copies of a
 * value that had moved, and a hard-coded `>=22 <23` here would be a third: it would keep
 * reporting "supported" for a Node the template had since stopped supporting.
 *
 * Zero dependencies (ADR-0002), so the comparator subset is written out rather than delegated
 * to semver. That subset is deliberately small, and {@link satisfies} THROWS on anything it
 * does not understand rather than returning `true`. A range parser that silently answers
 * "satisfied" for a syntax it cannot read is the check that passes because it never ran —
 * the defect this whole step exists to remove.
 */

/** Comparators this parser understands. Longest first: `>=` must win over `>`. */
const OPERATORS = ['>=', '<=', '>', '<', '='];

/**
 * Splits `"22.11.0"` or `"22"` into a numeric triple.
 *
 * A prerelease or build suffix is dropped, not rejected: `process.versions.node` never
 * carries one on a released binary, and a nightly should be judged by its numbers rather
 * than refused outright.
 */
function toTriple(version, context) {
  const core = String(version).trim().replace(/^v/, '').split(/[-+]/)[0];
  const parts = core.split('.');
  if (parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error(`${context}: cannot read "${version}" as a version number`);
  }
  const [major = '0', minor = '0', patch = '0'] = parts;
  return [Number(major), Number(minor), Number(patch)];
}

/** -1, 0 or 1, comparing two triples position by position. */
function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Parses a space-separated conjunction of simple comparators, e.g. `">=22 <23"`.
 *
 * Throws on `||`, `^`, `~`, `x`-ranges, hyphen ranges and anything else — see the file
 * header. If the template ever adopts one of those, this throw is the signal to teach the
 * parser that form deliberately, and the gate goes red until someone does.
 */
export function parseRange(spec) {
  const text = String(spec ?? '').trim();
  if (text === '') throw new Error('engines.node is empty');
  return text.split(/\s+/).map((term) => {
    const operator = OPERATORS.find((candidate) => term.startsWith(candidate));
    if (!operator) {
      throw new Error(
        `engines.node: this gate only understands >=, <=, >, < and = comparators, not "${term}"`,
      );
    }
    return { operator, bound: toTriple(term.slice(operator.length), `engines.node "${term}"`) };
  });
}

/** Does `version` satisfy every comparator in `spec`? Throws if `spec` cannot be parsed. */
export function satisfies(version, spec) {
  const actual = toTriple(version, 'the running Node version');
  return parseRange(spec).every(({ operator, bound }) => {
    const order = compare(actual, bound);
    switch (operator) {
      case '>=': return order >= 0;
      case '<=': return order <= 0;
      case '>': return order > 0;
      case '<': return order < 0;
      case '=': return order === 0;
      // Unreachable: parseRange rejects every other operator before we get here.
      default: throw new Error(`unreachable comparator ${operator}`);
    }
  });
}

/**
 * Reads `engines.node` out of a package.json that has already been parsed.
 *
 * Absent or non-string is an ERROR, not a pass. The whole value of this check is that it
 * reads the range from the project rather than restating it, so a project that has stopped
 * declaring one leaves the check with nothing to compare against — and a comparison against
 * nothing must not look like agreement.
 */
export function engineRangeOf(packageJson, where = 'package.json') {
  const declared = packageJson?.engines?.node;
  if (typeof declared !== 'string' || declared.trim() === '') {
    throw new Error(`${where} declares no engines.node — there is nothing to check this Node against`);
  }
  return declared;
}

/**
 * `null` when the running Node satisfies the declared range; otherwise the report to print.
 *
 * Returning a message rather than throwing is the decision recorded in ADR terms in the
 * decision log: the gate WARNS on a mismatch and FAILS only when the declaration itself is
 * missing or unreadable. Failing on the mismatch would make the gate unrunnable for every
 * developer on a newer Node, and a gate nobody can run is a gate that gets deleted — while
 * the thing actually at risk is not the run, it is the CONCLUSION drawn from the run. So the
 * run proceeds and its conclusion is qualified, loudly, in the gate's own output.
 */
export function nodeEngineReport({ declared, running, where }) {
  if (satisfies(running, declared)) return null;
  return [
    '!!! NODE ENGINE MISMATCH — read the gate result accordingly !!!',
    `  ${where} declares  engines.node = "${declared}"`,
    `  this gate is running under  node v${String(running).replace(/^v/, '')}`,
    '  Every result below was produced on a Node this template does not claim to support.',
    '  A failure that only happens on the declared Node would not appear here, and the person',
    '  most likely to meet it is the one running `npm run dev:up`, where the Dockerfiles pin it.',
  ].join('\n');
}
