import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { User } from '../../users/entities/User';
import type { IOrganizationService } from '../contracts/IOrganizationService';
import type { Invitation } from '../entities/Invitation';
import type { Organization } from '../entities/Organization';
import type { InvitationId } from '../types/InvitationId';
import type { OrganizationId } from '../types/OrganizationId';

/**
 * One isolated world for the tenant-isolation suite, built fresh for each test.
 *
 * ## Two tenants, and why one would not do
 *
 * Every assertion in this suite is of the form "a request made inside tenant A,
 * naming something that belongs to tenant B, must not reach it". A world with
 * one organization has no other side for such a request to fail to reach, so
 * every one of those assertions would be vacuously satisfied by an
 * implementation with no tenant scoping whatsoever — it would find nothing
 * because there is nothing, not because it looked in the right place.
 *
 * So this world holds two organizations **with disjoint memberships**: nobody
 * named below belongs to both. That is an obligation on the host, and it is the
 * one obligation this suite cannot check for itself, because the only way to
 * ask is through methods that are themselves under test. Seed somebody into
 * both and the refusals below stop being refusals; the suite would report green
 * for an implementation that scopes nothing.
 *
 * ## Why only a server can build it
 *
 * Phase 2's DEC-1 splits conformance by who can honestly satisfy an assertion.
 * Tenant isolation is a property of a *server*: an implementation that reaches
 * its data over the wire could satisfy the assertions below only by refusing on
 * its own account, and a client refusing proves the client refuses. So this
 * suite is driven by the implementation that owns the store and by nothing
 * else, exactly as `runIAuthServiceSecurityContract` is — and the missing second
 * driver is the design, not an omission to be tidied up.
 */
export interface OrganizationServiceSecurityContractContext {
  /** The implementation under test, holding exactly the world below. */
  service: IOrganizationService;

  /**
   * Tenant A: the organization every request in this suite is made *from*.
   *
   * It is the right-hand side of every comparison, never something the service
   * under test just produced — a world built by calling the implementation
   * would compare it with itself.
   */
  organization: Organization;
  /** A's sole OWNER, and a member of nothing else. */
  owner: User;
  /** An ordinary MEMBER of A, and a member of nothing else. */
  member: User;

  /**
   * Tenant B: the organization every request in this suite names but must not
   * reach. Its membership is disjoint from A's.
   */
  otherOrganization: Organization;
  /** B's sole OWNER, and a member of nothing else. */
  otherOwner: User;
  /** An ordinary MEMBER of B, and a member of nothing else. */
  otherMember: User;

  /**
   * An invitation B has issued and nobody has redeemed, addressed to
   * {@link OrganizationServiceSecurityContractContext.outsider}.
   *
   * It is what makes the *write*-side assertions failable, and those are the
   * ones that matter most. A refusal to *read* another tenant's invitation is
   * caught by a membership check on the way in; a refusal to *revoke* one is
   * caught only by the invitation lookup itself carrying the organization the
   * caller named into its predicate. That second fault — every check on the way
   * in passes, and then the target row is resolved by its own id alone — is the
   * one that can actually leak, and it needs a real invitation belonging to the
   * other tenant to have anything to leak.
   */
  otherInvitation: Invitation;
  /**
   * The value B's invitation's recipient holds.
   *
   * Supplied by the host for the reason the shared suite's `tokenFor` gives:
   * core models the token as an opaque string and must not know how one is
   * produced (D14).
   */
  otherInvitationToken: string;

  /**
   * Somebody who belongs to neither organization, holding the address
   * {@link OrganizationServiceSecurityContractContext.otherInvitation} was sent
   * to — so they can redeem it, which is how the suite checks that redeeming an
   * invitation lands the new member in the *inviting* organization and nowhere
   * else.
   */
  outsider: User;

  /**
   * The instant this world considers now.
   *
   * Every assertion about an invitation still being open is relative to it.
   * Without it the suite would have to read a clock, and an assertion about
   * expiry that reads a clock is one that passes or fails depending on how long
   * the test took.
   */
  now: Date;
}

/** Runner primitives + the world factory the tenant-isolation suite needs. */
export interface IOrganizationServiceSecurityContractDeps {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<unknown>) => void;
  expect: ConformanceExpect;
  /** Fresh world per call — it must contain exactly what it returns. */
  makeContext: () => Promise<OrganizationServiceSecurityContractContext>;
  /**
   * Well-formed for the host's store, present in no world it builds.
   *
   * The suite cannot invent one: what counts as well-formed differs between
   * stores, and a store that validates the shape of an id would reject a made-up
   * string before ever looking for it — failing the suite for the wrong reason,
   * with the wrong error.
   */
  absentOrganizationId: OrganizationId;
  /** Likewise, for an invitation. */
  absentInvitationId: InvitationId;
}
