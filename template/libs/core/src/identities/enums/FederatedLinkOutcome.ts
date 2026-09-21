/**
 * How a request to link a federated subject to the account making it resolved.
 *
 * One member per ending {@link decideFederatedLink} can reach.
 */
export enum FederatedLinkOutcome {
  /** Nothing holds this subject yet; it is linked to the actor. */
  LINK = 'LINK',
  /** The actor already holds this subject; linking again is a no-op, not a failure. */
  ALREADY_LINKED_TO_ACTOR = 'ALREADY_LINKED_TO_ACTOR',
  /** Somebody else holds this subject; refused. */
  LINKED_TO_ANOTHER_ACCOUNT = 'LINKED_TO_ANOTHER_ACCOUNT',
}
