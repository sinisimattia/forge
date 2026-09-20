import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { User } from '../../users/entities/User';
import type { IOrganizationService } from '../contracts/IOrganizationService';
import type { Invitation } from '../entities/Invitation';
import type { Organization } from '../entities/Organization';
import type { InvitationId } from '../types/InvitationId';
import type { OrganizationId } from '../types/OrganizationId';

/** One isolated world, built fresh for each test. */
export interface OrganizationServiceContractContext {
  /** The implementation under test, holding exactly the world below. */
  service: IOrganizationService;
  /**
   * The organization every assertion is about. `owner` is its ONLY owner.
   *
   * It is the right-hand side of every comparison the suite makes about an
   * organization: what the service returns is checked against the world the
   * host promised, never against itself. A host that builds it by calling the
   * service under test turns those comparisons into a value compared with
   * itself — unfailable, and silently so.
   */
  organization: Organization;
  /** The sole OWNER — the subject of the last-owner invariant. */
  owner: User;
  /** An ADMIN of `organization`. */
  admin: User;
  /** An ordinary MEMBER of `organization`. */
  member: User;
  /**
   * Somebody who belongs to no organization at all.
   *
   * It is what makes "lists only organizations the actor belongs to" and "a
   * non-member gets the same answer as for an id that does not exist" failable,
   * and it is the account the suite has redeem an invitation.
   */
  outsider: User;
  /**
   * An address that is nobody's account and nobody's open invitation.
   *
   * The suite cannot invent one: a host is free to seed whatever accounts it
   * likes, and an address this suite made up could collide with one of them —
   * which would fail the invitation assertions with `ALREADY_A_MEMBER` and blame
   * the implementation for the host's choice of fixtures.
   */
  uninvitedEmail: string;
  /**
   * The token a recipient would present for this invitation.
   *
   * The host knows how its own invitations are redeemed and the suite must not:
   * core models the token as an opaque string, and a suite that built one would
   * be asserting a format core has no business knowing (D14).
   */
  tokenFor: (invitation: Invitation) => Promise<string>;
  /**
   * The instant this world considers now.
   *
   * Every expiry assertion is relative to it. Without it the suite would have to
   * read a clock, and an assertion about expiry that reads a clock is one that
   * passes or fails depending on how long the test took.
   */
  now: Date;
}

/** Runner primitives + the world factory the shared suite needs. */
export interface IOrganizationServiceContractDeps {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<unknown>) => void;
  expect: ConformanceExpect;
  /** Fresh world per call — it must contain exactly what it returns. */
  makeContext: () => Promise<OrganizationServiceContractContext>;
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
  /** A token that is well-formed for the host and redeems nothing. */
  absentToken: string;
}
