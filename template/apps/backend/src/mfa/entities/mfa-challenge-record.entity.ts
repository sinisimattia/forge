import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { MfaChallengePurpose } from '../enums/MfaChallengePurpose';

/**
 * The `mfa_challenges` row — a single-use token that ties a completed
 * password step, or an authenticated session, to the second-factor round
 * that finishes it.
 *
 * `tokenHash`, not `token`, matching `OAuthAuthorizationRequestRecord`'s
 * `stateHash`: a leak of this table must not be a set of usable pending
 * authentications.
 *
 * `purpose` is declared as `MfaChallengePurpose` here as a claim about what
 * this class *writes* — TypeORM has no way to enforce it — and never a
 * guarantee about what a `SELECT` reads back: the column is plain `text`
 * with no `CHECK` (see `1758000005000-Mfa.ts`), so a row this class did not
 * write can hold a string neither member of `MfaChallengePurpose` is.
 * Whatever reads this field has to dispatch on it fail-closed, the same
 * shape `MfaChallengePurpose`'s own TSDoc argues for.
 *
 * `consumedAt` rather than deleting the row on use, matching every other
 * single-use credential in this schema — see `EmailVerificationTokenRecord`.
 *
 * See `UserRecord` for the conventions every record class follows.
 */
@Entity('mfa_challenges')
@Unique('uq_mfa_challenges_token_hash', ['tokenHash'])
export class MfaChallengeRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_mfa_challenges_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** A hash of the token, never the token. */
  @Column({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  @Column({ name: 'purpose', type: 'text' })
  purpose!: MfaChallengePurpose;

  /**
   * The WebAuthn ceremony nonce, or `null` for a challenge that never entered
   * one.
   *
   * **The one security-relevant column in these tables held in the clear, and
   * the only one that can be.** `tokenHash` above is a digest because nothing
   * ever needs the token back — a presented token is hashed and the digests
   * are compared. This value is the opposite: the authenticator signs over it
   * and returns it inside `clientDataJSON`, so
   * `verifyAuthenticationResponse`'s `expectedChallenge` must be the nonce
   * itself, byte for byte. A digest here would be a value no ceremony could
   * ever be checked against, and there is no keyed construction that helps:
   * the comparison happens against what the browser sends, not against what
   * this server stores.
   *
   * What that costs is bounded, and it is not a second copy of the token. A
   * reader of this table learns the nonce of a ceremony in flight, which buys
   * them nothing on its own: completing it still needs an assertion signed by
   * the private key the authenticator holds and never releases, over this
   * nonce, on this deployment's origin. The row is single-use, expires within
   * `MFA_CHALLENGE_TTL_MS`, and the token that selects it — the thing an
   * attacker would actually need — is still only ever a digest here.
   */
  @Column({ name: 'webauthn_challenge', type: 'text', nullable: true })
  webauthnChallenge!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** When it was used, or `null` if it has not been. */
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
