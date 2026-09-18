import type { IBreachedPasswordRegistry } from '__FORGE_SCOPE__/core/identities/contracts';

/**
 * {@link IBreachedPasswordRegistry} that knows nothing, and therefore answers
 * `false` to everything.
 *
 * ADR-0008's second instance, after `FileMailer`: the template binds no corpus
 * and carries no account, so this is what a generated project ships until
 * somebody writes a real adapter. The seam exists and is wired; the knowledge
 * behind it does not.
 *
 * **It is not a stub that can be left alone.** Every password a generated
 * project accepts is judged only on its shape — `DEFAULT_PASSWORD_POLICY` asks
 * for twelve characters and nothing else — so `hunter2hunter2` is accepted
 * today and is in every published corpus there is. That check is the single
 * highest-value strength test available, which is precisely why core states the
 * question as a port rather than letting a composition rule stand in for it.
 *
 * ## What a real implementation owes, and the trap it is walking into
 *
 * `IBreachedPasswordRegistry`'s own comment is emphatic and easy to read past:
 * *an implementation must never send the secret itself anywhere it would be
 * readable.* Whoever wires up a real corpus arrives here holding a plaintext
 * password and an HTTP client, and the obvious two lines — POST the password to
 * a lookup service — are the whole of the failure. The password then exists in
 * that service's logs, in any proxy between, and in whatever that service does
 * with what it receives; a check meant to establish that a secret is not public
 * has itself published it.
 *
 * The established way of asking the question without disclosing the answer is
 * k-anonymity: hash the secret, send a short *prefix* of the digest, receive
 * every suffix the corpus holds under that prefix, and complete the match
 * locally. The remote side learns only that somebody asked about one of a large
 * bucket of digests. A real implementation of this port either does that, or
 * holds the corpus locally and never speaks to anybody.
 *
 * Two further obligations that are this port's and not its caller's:
 *
 * - **Never fail the caller.** A registry that is unreachable must answer
 *   `false`, not throw. The caller is on a registration or a password-change
 *   path, and an outage in an advisory check is not a reason to refuse somebody
 *   an account.
 * - **Bound the wait.** `AuthService.register` consults this port before it
 *   touches the database, deliberately, so that a policy failure and an
 *   existing-address answer take the same time. A registry that blocks for ten
 *   seconds hands that timing back and adds a way to stall the process.
 */
export class NoOpBreachedPasswordRegistry implements IBreachedPasswordRegistry {
  /**
   * Always `false`: this registry knows of no corpus, so it can report no
   * secret as appearing in one.
   *
   * `false` rather than a throw, because the seam is meant to be inert rather
   * than absent — a generated project must be able to call this port on its
   * live registration path from the day it is generated, and swapping in a real
   * adapter must change nothing but the binding.
   */
  public isKnownBreached(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/**
 * The DI token {@link IBreachedPasswordRegistry} is bound under.
 *
 * A `Symbol` for the reason {@link MAILER} gives: the port is an interface and
 * has no runtime value Nest could use as a token on its own, and a symbol
 * cannot collide with a token another module picks by coincidence of spelling.
 */
export const BREACHED_PASSWORD_REGISTRY = Symbol('BREACHED_PASSWORD_REGISTRY');
