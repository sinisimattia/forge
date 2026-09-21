import type { OrganizationId } from '../../organizations/types/OrganizationId';
import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { UserId } from '../../users/types/UserId';
import type { IAuditService } from '../contracts/IAuditService';
import type { AuditEntry } from '../entities/AuditEntry';
import type { AuditAction } from '../enums/AuditAction';

/**
 * One isolated world, built fresh for each test.
 *
 * Three entries already recorded, and three because that is the smallest number
 * that makes every assertion below failable: two would let a page hold
 * everything there is, so `meta.total` could be the length of `data` and nobody
 * would know, and it would leave no room for the action filter and the actor
 * filter to name *different* entries — which is what makes narrowing by both
 * distinguishable from narrowing by either.
 *
 * Every promise here is asserted by the suite before it is leaned on, in the
 * block named for exactly that, with one exception which says so on its own doc.
 * A promise that were only documented would let a host that seeded its world
 * wrong disarm the tests silently: they would still pass, and they would be
 * proving nothing.
 */
export interface AuditServiceContractContext {
  /** The implementation under test, holding exactly the world described below. */
  service: IAuditService;

  /**
   * The actor every read in this suite is made on behalf of, entitled to read
   * across the deployment.
   *
   * Asserted rather than assumed: the first query test reads the whole history
   * back and counts it, so a reader who is not in fact entitled — one this
   * world's implementation would answer with an empty page — fails there.
   *
   * What this suite deliberately does *not* pin is what happens to an actor who
   * is **not** entitled. Refusal is a question about authorization, which is a
   * pure function in core and arrives in a later phase (ADR-0006); pinning an
   * answer here would fix it before the decision that owns it has been made.
   */
  readerId: UserId;

  /**
   * Exactly the entries the world holds before the suite records any, **newest
   * first**.
   *
   * As entities, because they are the right-hand side of the wire-shape
   * comparison — what the service returns is checked against the world the host
   * promised, never against itself.
   *
   * Their instants must be strictly decreasing across the array, which is what
   * makes "newest first" a claim about the world and not merely a restatement of
   * whatever order the host happened to list them in.
   *
   * **The one promise on this interface the suite cannot check.** The store
   * these came from must not already hold them in this order. The suite can see
   * the array and the answer, never the store in between, so an implementation
   * that returns rows in the order it received them and sorts nothing at all
   * passes every ordering assertion below when the host seeds them newest-first.
   * Said out loud rather than left implicit, because the exception is the
   * interesting part: seed them shuffled.
   */
  seeded: AuditEntry[];

  /**
   * An action exactly one seeded entry carries.
   *
   * It is what makes the action filter failable: an implementation that dropped
   * the filter returns all three, and one that returned nothing returns none.
   */
  filterAction: AuditAction;

  /**
   * An actor exactly one seeded entry names, and **not** the entry that carries
   * {@link filterAction}.
   *
   * The two filters have to land on different entries, or a query naming both
   * cannot tell an implementation that narrows by both from one that narrows by
   * either — the two agree on every world where the filters name the same row.
   */
  filterActorId: UserId;

  /**
   * An action **no** seeded entry carries.
   *
   * What the suite records with, so that a single narrowed query finds exactly
   * the entry it just wrote and nothing the world came with. Without it the
   * suite would have to identify its own entry by position, which is the
   * ordering property it is elsewhere trying to test.
   */
  freshAction: AuditAction;

  /**
   * A tenant {@link AuditServiceContractContext.seeded}'s newest entry carries.
   *
   * The host cannot seed `null` for this one, unlike every other nullable field
   * on a seeded entry: the wire-shape test compares the newest entry field by
   * field, and a `null` on both sides of that comparison is `null === null` —
   * an assertion about nothing, which is exactly the finding that provoked this
   * field's existence (measured by dropping `organizationId` from a
   * mapper, which left an entire conformance suite green). A world that seeded `null`
   * here would silently disarm the one comparison this field exists to make
   * failable.
   */
  organizationId: OrganizationId;
}

/** Runner primitives + the world factory the shared suite needs. */
export interface IAuditServiceContractDeps {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<unknown>) => void;
  expect: ConformanceExpect;
  /** Fresh world per call — it must contain exactly what it describes. */
  makeContext: () => Promise<AuditServiceContractContext>;
}
