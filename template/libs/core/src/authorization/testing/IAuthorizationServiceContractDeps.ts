import type { OrganizationId } from '../../organizations/types/OrganizationId';
import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { UserId } from '../../users/types/UserId';
import type { IAuthorizationService } from '../contracts/IAuthorizationService';
import type { GrantId } from '../types/GrantId';
import type { ResourceType } from '../types/ResourceType';

/** One isolated world, built fresh for each test. */
export interface AuthorizationServiceContractContext {
  /** The implementation under test, holding exactly the world below. */
  service: IAuthorizationService;
  /**
   * The organization every assertion is about.
   *
   * **It holds no grant when the world is built**, and neither does
   * `otherOrganizationId`. Every count the suite asserts is a count of what the
   * suite itself issued; a world that seeded a grant would make those counts
   * off by however many it seeded, and blame the implementation for it.
   */
  organizationId: OrganizationId;
  /**
   * A second organization, which `actorId` may also act in.
   *
   * It is what makes "listing is scoped to one organization" and "another
   * tenant's grant is as absent as one that was never issued" failable. Without
   * a second tenant, every such assertion is about a world with nothing to leak
   * from.
   */
  otherOrganizationId: OrganizationId;
  /**
   * Who issues every grant the suite makes. A member of both organizations, and
   * **not** the same person as `subjectUserId` — the suite asserts that, because
   * "the actor is recorded as the issuer" cannot fail in a world where the actor
   * and the subject are one person.
   */
  actorId: UserId;
  /** The subject of every grant: a member of both organizations. */
  subjectUserId: UserId;
  /**
   * A member of `otherOrganizationId` and **not** of `organizationId`.
   *
   * Not simply somebody who belongs to nothing: a refusal that only holds for a
   * person with no memberships at all says nothing about tenants. This person
   * exists, belongs somewhere, and still may not be granted here — which is what
   * makes the refusal about the boundary rather than about the account.
   */
  outsiderId: UserId;
  /**
   * A resource type this world's store accepts.
   *
   * The suite cannot invent one. {@link ResourceType} is an unvalidated branded
   * string precisely because core does not know what a deployment's records are
   * called, so a store that recognizes only its own nouns would reject one the
   * suite made up — failing the suite for the host's vocabulary rather than for
   * the implementation's behavior.
   */
  resourceType: ResourceType;
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
export interface IAuthorizationServiceContractDeps {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<unknown>) => void;
  expect: ConformanceExpect;
  /** Fresh world per call — it must contain exactly what it returns. */
  makeContext: () => Promise<AuthorizationServiceContractContext>;
  /**
   * Well-formed for the host's store, present in no world it builds.
   *
   * The suite cannot invent one: what counts as well-formed differs between
   * stores, and a store that validates the shape of an id would reject a made-up
   * string before ever looking for it — failing the suite for the wrong reason,
   * with the wrong error.
   */
  absentGrantId: GrantId;
}
