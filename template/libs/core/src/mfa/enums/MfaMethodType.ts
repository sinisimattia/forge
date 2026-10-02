/**
 * A kind of second factor a method can be.
 *
 * Both members exist from the start even though a deployment may offer only
 * one of them. The alternative — adding a member later — would mean a stored
 * value changing meaning, and every persisted method being rewritten. A kind
 * nothing offers is simply one that no method refers to.
 *
 * The values are the member names rather than ordinals for the same reason: a
 * numeric enum stores a position, so reordering the members silently
 * reassigns every row already written.
 */
export enum MfaMethodType {
  /** A time-based one-time code, from a shared secret the person's app holds. */
  TOTP = 'TOTP',
  /** A key pair held by an authenticator, proven by signing a challenge. */
  WEBAUTHN = 'WEBAUTHN',
}
