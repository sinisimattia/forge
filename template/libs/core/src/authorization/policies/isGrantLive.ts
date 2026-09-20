import type { ResourceGrant } from '../types/ResourceGrant';

/**
 * Whether a grant is still in force as of `now`.
 *
 * **The instant is a parameter and not a clock read here**, and that is the
 * point of this function existing at all rather than the rule being a line
 * inside `can`. `can` must stay pure — the same principal and the same resource
 * returning the same answer is what lets the server decide a request and a
 * client predict what the server would say — and a function that reads a clock
 * cannot promise that. So the rule lives here, the caller supplies the instant,
 * and the hydrator is the one place it runs: `Principal.grants` is documented as
 * live as of hydration, which is a promise this function is how you keep.
 *
 * A grant with no expiry never lapses. The boundary is exclusive: a grant
 * expiring at an instant is already over at that instant, matching
 * `Invitation.isExpiredAt`, so that two things that lapse in this domain do not
 * disagree about what their last moment was.
 *
 * @param grant - the grant to judge
 * @param now - the instant to judge it as of, supplied by the caller
 * @returns whether the grant is still in force
 */
export function isGrantLive(grant: ResourceGrant, now: Date): boolean {
  if (grant.expiresAt === null) return true;
  return now.getTime() < grant.expiresAt.getTime();
}
