/**
 * A way of proving you are a particular person.
 *
 * All four members exist from the start even though only
 * {@link AuthProvider.PASSWORD} is implemented in this phase. The alternative —
 * adding members later — would mean a stored value changing meaning, and every
 * persisted identity being rewritten. A provider that is not configured is
 * simply one that no identity refers to.
 *
 * The values are the member names rather than ordinals for the same reason: a
 * numeric enum stores a position, so reordering the members silently reassigns
 * every row already written (ADR-0005).
 */
export enum AuthProvider {
  /** A secret only the person knows, verified against a stored derivation of it. */
  PASSWORD = 'PASSWORD',
  /** A federated provider, reached through its own adapter. */
  GOOGLE = 'GOOGLE',
  /** A federated provider, reached through its own adapter. */
  GITHUB = 'GITHUB',
  /** Any other provider reached through the generic protocol adapter. */
  OIDC = 'OIDC',
}
