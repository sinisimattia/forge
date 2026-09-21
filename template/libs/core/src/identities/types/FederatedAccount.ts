import type { AuthProvider } from '../enums/AuthProvider';

/**
 * What a federated provider asserted about the person in front of it.
 *
 * "Federated" rather than any protocol's name: how the assertion travelled is
 * the consuming application's business, and naming a protocol here would put a
 * transport into the one package whose value is that it carries none.
 *
 * Every field is what the provider *said*. Nothing here is established fact
 * until a rule in this package has decided what it means — which is the whole
 * reason {@link decideFederatedSignIn} exists as a separate step.
 */
export interface FederatedAccount {
  /** Which provider made the assertion. Never {@link AuthProvider.PASSWORD}. */
  readonly provider: AuthProvider;
  /**
   * The provider's own identifier for the account.
   *
   * Opaque, case-sensitive to whoever issued it, and **the only part of this
   * assertion that identifies anybody**. Stable across an address change at the
   * provider, which is precisely why it and not the address is what an identity
   * is keyed on.
   */
  readonly subject: string;
  /** The address the provider associates with the account, or `null` if it disclosed none. */
  readonly email: string | null;
  /**
   * Whether the provider says it has itself proven that address.
   *
   * A provider will hand over an address it has never verified. Treating one as
   * identity is an account-takeover path: anyone who can add an unverified
   * address at that provider could then claim the account holding it here.
   */
  readonly emailVerified: boolean;
  /** A human-readable name, if the provider disclosed one. Never used to identify. */
  readonly displayName: string | null;
}
