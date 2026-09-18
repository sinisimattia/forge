import { normalizeEmail } from '../../shared/policies/normalizeEmail';
import type { UserId } from '../../users/types/UserId';
import { AuthProvider } from '../enums/AuthProvider';
import { IdentityAccountIdRequiredError } from '../errors/IdentityAccountIdRequiredError';
import type { AuthIdentityId } from '../types/AuthIdentityId';
import type { AuthIdentityJSON } from '../types/AuthIdentityJSON';
import type { AuthIdentityProps } from '../types/AuthIdentityProps';

/**
 * One way a particular user can prove who they are.
 *
 * Deliberately empty of secret material. The derivation of a password lives
 * beside the record that stores it and is never part of this entity, so no
 * serialization of an identity can leak one: there is no field for it. A caller
 * that needs to *verify* a password does not need to see it, which is why
 * verification is a capability of the implementation rather than a property of
 * the entity (ADR-0005).
 */
export class AuthIdentity {
  /** The identity's identifier. */
  readonly id: AuthIdentityId;
  /** The person this identity proves. */
  readonly userId: UserId;
  /** Which kind of proof this is. */
  readonly provider: AuthProvider;
  /**
   * How this provider names the account: the normal-form address for
   * {@link AuthProvider.PASSWORD}, the provider's own subject identifier
   * otherwise. Unique per provider.
   */
  readonly providerAccountId: string;
  /** When the identity was linked. */
  readonly createdAt: Date;
  /** When this identity was last used successfully, or `null` if never. */
  readonly lastUsedAt: Date | null;

  /**
   * @param props - the six facts that make up an identity
   * @throws IdentityAccountIdRequiredError when the account identifier is
   * absent or only whitespace
   */
  constructor(props: AuthIdentityProps) {
    const providerAccountId = AuthIdentity.stabilize(props.provider, props.providerAccountId);
    if (providerAccountId === '') throw new IdentityAccountIdRequiredError(props.provider);

    this.id = props.id;
    this.userId = props.userId;
    this.provider = props.provider;
    this.providerAccountId = providerAccountId;
    this.createdAt = props.createdAt;
    this.lastUsedAt = props.lastUsedAt;
  }

  /**
   * The one place an account identifier is put into its stable form.
   *
   * A password identity is named by an address, so it takes the domain's one
   * definition of address identity — without it `Ada@Example.com` and
   * `ada@example.com` would be two password identities for one address, and the
   * second would be a way to reach an account the first already reached. Every
   * other provider issues its own subject identifier, which is opaque and
   * case-sensitive to whoever issued it, so it is only trimmed.
   */
  private static stabilize(provider: AuthProvider, providerAccountId: string): string {
    return provider === AuthProvider.PASSWORD
      ? normalizeEmail(providerAccountId)
      : providerAccountId.trim();
  }

  /** The wire shape: instants as ISO-8601 strings. */
  toJSON(): AuthIdentityJSON {
    return {
      id: this.id,
      userId: this.userId,
      provider: this.provider,
      providerAccountId: this.providerAccountId,
      createdAt: this.createdAt.toISOString(),
      lastUsedAt: this.lastUsedAt?.toISOString() ?? null,
    };
  }

  /**
   * Rebuilds an identity from its wire shape, re-running every invariant.
   *
   * @param json - an identity as it crosses a serialization boundary
   * @returns the same identity as a real entity, instants revived
   */
  static fromJSON(json: AuthIdentityJSON): AuthIdentity {
    return new AuthIdentity({
      id: json.id,
      userId: json.userId,
      provider: json.provider,
      providerAccountId: json.providerAccountId,
      createdAt: new Date(json.createdAt),
      lastUsedAt: json.lastUsedAt === null ? null : new Date(json.lastUsedAt),
    });
  }
}
