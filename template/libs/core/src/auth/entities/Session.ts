import type { UserId } from '../../users/types/UserId';
import { SessionLifetimeError } from '../errors/SessionLifetimeError';
import type { SessionId } from '../types/SessionId';
import type { SessionJSON } from '../types/SessionJSON';
import type { SessionProps } from '../types/SessionProps';

/**
 * One continuous period during which a person is treated as signed in.
 *
 * A session is a domain fact: it began, it was last used, it ends at a
 * particular instant, and it can be ended early. How a caller *demonstrates*
 * that it holds a session — what the credential looks like, where it is kept,
 * how it is renewed — is not modelled here and never will be; that belongs to
 * whoever is doing the transporting.
 *
 * The entity carries no credential of any kind, and that is structural rather
 * than careful: there is no field for one, so no serialization of a session can
 * leak one, and the list of their own sessions a person reads is safe to show
 * them in full.
 */
export class Session {
  /** The session's identifier. */
  readonly id: SessionId;
  /** The person the session belongs to. */
  readonly userId: UserId;
  /** When the session began. */
  readonly createdAt: Date;
  /** When it was last used. */
  readonly lastUsedAt: Date;
  /** When it ends of its own accord. */
  readonly expiresAt: Date;
  /** When it was ended early, or `null` if it ran or is running its course. */
  readonly revokedAt: Date | null;
  /** The network address the session began from, as the implementation saw it. */
  readonly clientAddress: string | null;
  /** A short, opaque description of the client, for the owner to recognize. */
  readonly clientLabel: string | null;

  /**
   * @param props - the eight facts that make up a session
   * @throws SessionLifetimeError when the instants do not describe a period
   * that could have happened — one that ends no later than it begins, or one
   * last used before it began
   */
  constructor(props: SessionProps) {
    if (
      props.expiresAt.getTime() <= props.createdAt.getTime()
      || props.lastUsedAt.getTime() < props.createdAt.getTime()
    ) {
      throw new SessionLifetimeError(props.createdAt, props.lastUsedAt, props.expiresAt);
    }

    this.id = props.id;
    this.userId = props.userId;
    this.createdAt = props.createdAt;
    this.lastUsedAt = props.lastUsedAt;
    this.expiresAt = props.expiresAt;
    this.revokedAt = props.revokedAt;
    this.clientAddress = props.clientAddress;
    this.clientLabel = props.clientLabel;
  }

  /**
   * Whether the session may still be used at `now`.
   *
   * `now` is a parameter rather than something read from the clock, so that the
   * answer is a function of its arguments and the boundary can be tested at all.
   * The instant of expiry itself is not active: a session that ends at noon is
   * over at noon, and the alternative leaves a moment whose membership depends
   * on which comparison a reader happens to write.
   *
   * @param now - the instant to judge the session at
   * @returns whether it is neither ended early nor run out
   */
  isActive(now: Date): boolean {
    return this.revokedAt === null && this.expiresAt.getTime() > now.getTime();
  }

  /** The wire shape: instants as ISO-8601 strings. */
  toJSON(): SessionJSON {
    return {
      id: this.id,
      userId: this.userId,
      createdAt: this.createdAt.toISOString(),
      lastUsedAt: this.lastUsedAt.toISOString(),
      expiresAt: this.expiresAt.toISOString(),
      revokedAt: this.revokedAt?.toISOString() ?? null,
      clientAddress: this.clientAddress,
      clientLabel: this.clientLabel,
    };
  }

  /**
   * Rebuilds a session from its wire shape, re-running every invariant.
   *
   * @param json - a session as it crosses a serialization boundary
   * @returns the same session as a real entity, instants revived
   */
  static fromJSON(json: SessionJSON): Session {
    return new Session({
      id: json.id,
      userId: json.userId,
      createdAt: new Date(json.createdAt),
      lastUsedAt: new Date(json.lastUsedAt),
      expiresAt: new Date(json.expiresAt),
      revokedAt: json.revokedAt === null ? null : new Date(json.revokedAt),
      clientAddress: json.clientAddress,
      clientLabel: json.clientLabel,
    });
  }
}
