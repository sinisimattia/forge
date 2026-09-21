/**
 * How a federated sign-in assertion resolved.
 *
 * One member per ending {@link decideFederatedSignIn} can reach — see that
 * function's own TSDoc for why the four are checked in the order they are.
 */
export enum FederatedSignInOutcome {
  /** The subject was already linked to an account; that account signs in. */
  SIGN_IN_EXISTING = 'SIGN_IN_EXISTING',
  /** A verified address nobody holds; a new account is provisioned for it. */
  PROVISION_NEW = 'PROVISION_NEW',
  /**
   * A verified address belongs to an existing account the subject is not
   * linked to. Refused, and **not linked**: a provider proving an address
   * proves nothing about an account here that happens to answer to the same
   * string.
   */
  REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT = 'REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT',
  /** The address is absent, or the provider has not itself verified it. */
  REFUSE_UNVERIFIED_EMAIL = 'REFUSE_UNVERIFIED_EMAIL',
}
