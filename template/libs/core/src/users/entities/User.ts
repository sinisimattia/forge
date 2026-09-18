import { normalizeEmail } from '../../shared/policies/normalizeEmail';
import { PlatformRole } from '../enums/PlatformRole';
import { UserStatus } from '../enums/UserStatus';
import { DisplayNameRequiredError } from '../errors/DisplayNameRequiredError';
import { EmailRequiredError } from '../errors/EmailRequiredError';
import { InvalidEmailError } from '../errors/InvalidEmailError';
import type { UserId } from '../types/UserId';
import type { UserJSON } from '../types/UserJSON';
import type { UserProps } from '../types/UserProps';

/**
 * A person. One `User` is one human being, independent of how many ways they
 * have of proving it — those are auth identities, and a user with none is
 * possible only transiently.
 *
 * The entity carries no secret material of any kind. That is structural rather
 * than careful: there is no field for a secret, so no serialization of a user
 * can leak one.
 */
export class User {
  readonly id: UserId;
  /** Normal form, per `normalizeEmail`. Two users can never differ only by case. */
  readonly email: string;
  /** The name shown to other people, stored trimmed. */
  readonly displayName: string;
  /** Whether the account may be used at all. */
  readonly status: UserStatus;
  /** The person's standing with respect to the deployment. */
  readonly platformRole: PlatformRole;
  /** When the address was proven, or `null` if it has not been. */
  readonly emailVerifiedAt: Date | null;
  /** When the account came into being. */
  readonly createdAt: Date;
  /** When the account was last changed. */
  readonly updatedAt: Date;
  /** Set by a soft delete. The record is retained; the account is unusable. */
  readonly deletedAt: Date | null;

  /**
   * @param props - the nine facts that make up an account
   * @throws EmailRequiredError when the address is absent or only whitespace
   * @throws InvalidEmailError when the value cannot be an address at all
   * @throws DisplayNameRequiredError when the display name is only whitespace
   */
  constructor(props: UserProps) {
    const email = normalizeEmail(props.email);
    if (email === '') throw new EmailRequiredError();
    if (!User.looksLikeAnAddress(email)) throw new InvalidEmailError(props.email);
    if (props.displayName.trim() === '') throw new DisplayNameRequiredError();

    this.id = props.id;
    this.email = email;
    this.displayName = props.displayName.trim();
    this.status = props.status;
    this.platformRole = props.platformRole;
    this.emailVerifiedAt = props.emailVerifiedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.deletedAt = props.deletedAt;
  }

  /**
   * A deliberately shallow check: exactly one `@`, something either side, no
   * whitespace. Anything stricter rejects addresses that are legal and in use;
   * the only real proof that an address exists is that someone received a
   * message at it, which is what verification is for.
   */
  private static looksLikeAnAddress(value: string): boolean {
    const parts = value.split('@');
    return parts.length === 2 && parts[0] !== '' && parts[1] !== '' && !/\s/.test(value);
  }

  /** Whether the address has been proven. */
  get isEmailVerified(): boolean {
    return this.emailVerifiedAt !== null;
  }

  /** Whether the account has been soft-deleted. */
  get isDeleted(): boolean {
    return this.deletedAt !== null;
  }

  /**
   * Whether this account may be authenticated at all.
   *
   * All three conditions are load-bearing and each has its own failure mode:
   * an unverified account would let someone claim an address that is not
   * theirs, a suspended one would ignore an administrator's decision, and a
   * deleted one would resurrect an account its owner asked to be removed.
   */
  canAuthenticate(): boolean {
    return this.status === UserStatus.ACTIVE && this.isEmailVerified && !this.isDeleted;
  }

  /** The wire shape: instants as ISO-8601 strings. */
  toJSON(): UserJSON {
    return {
      id: this.id,
      email: this.email,
      displayName: this.displayName,
      status: this.status,
      platformRole: this.platformRole,
      emailVerifiedAt: this.emailVerifiedAt?.toISOString() ?? null,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      deletedAt: this.deletedAt?.toISOString() ?? null,
    };
  }

  /**
   * Rebuilds a user from its wire shape, re-running every invariant.
   *
   * @param json - a user as it crosses a serialization boundary
   * @returns the same user as a real entity, instants revived
   */
  static fromJSON(json: UserJSON): User {
    return new User({
      id: json.id,
      email: json.email,
      displayName: json.displayName,
      status: json.status,
      platformRole: json.platformRole,
      emailVerifiedAt: json.emailVerifiedAt === null ? null : new Date(json.emailVerifiedAt),
      createdAt: new Date(json.createdAt),
      updatedAt: new Date(json.updatedAt),
      deletedAt: json.deletedAt === null ? null : new Date(json.deletedAt),
    });
  }
}
