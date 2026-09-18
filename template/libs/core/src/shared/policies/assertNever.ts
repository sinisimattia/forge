/**
 * Exhaustiveness guard for a discriminated union.
 *
 * Used as the `default` of a `switch`, it is reachable only when the union has
 * grown a branch the switch does not handle — which the compiler reports as an
 * error at the call site, before the code ever runs. The throw is the runtime
 * backstop for a value that arrived from outside the type system.
 *
 * @param value - the branch that was not handled
 * @throws always
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated union member: ${JSON.stringify(value)}`);
}
