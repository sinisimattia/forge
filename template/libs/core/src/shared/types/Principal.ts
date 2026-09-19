import type { PlatformRole } from '../../users/enums/PlatformRole';
import type { UserId } from '../../users/types/UserId';

/**
 * Everything an access decision is allowed to know about whoever is asking.
 *
 * It is the *whole* input, deliberately: `can` looks nothing up, so a caller
 * that has not established a fact cannot have that fact considered. Adding a
 * field here is adding something every caller must now hydrate before it may
 * ask a question — which is the cost ADR-0006 accepts in exchange for one
 * statement of the rules that both the server and its clients can evaluate.
 *
 * It is not a {@link User}. A user is a record with a lifecycle; a principal is
 * the subset of it a decision reads, and keeping them apart is what lets a
 * caller that holds only two fields ask a question at all.
 */
export interface Principal {
  /** Whose request this is. */
  userId: UserId;
  /** Their standing with respect to the deployment. */
  platformRole: PlatformRole;
}

/**
 * The thing a decision is about, when it is about a particular record.
 *
 * Only the owner is modelled, because ownership is the only property of a
 * record any rule reads in this phase. A rule that needs more than this —
 * anything depending on the record's own state — is not expressible in a pure
 * function over a hydrated principal, and ADR-0006 says so outright: it belongs
 * with the domain that owns the record.
 */
export interface OwnedResource {
  /** The account the record belongs to. */
  ownerId: UserId;
}
