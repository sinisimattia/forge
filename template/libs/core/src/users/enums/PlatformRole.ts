/**
 * A person's standing with respect to the deployment itself, never with respect
 * to anything inside it. It is deliberately not an organization role: those are
 * per-organization and live on a membership, so that one person can hold
 * different roles in different organizations. Platform administration is not
 * implied by any organization role and never will be.
 */
export enum PlatformRole {
  /** May operate the deployment. Every use of this power is recorded. */
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
  /** Everyone else. The default for a newly registered account. */
  PLATFORM_USER = 'PLATFORM_USER',
}
