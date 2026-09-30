import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * The `mfa_recovery_codes` row — a single-use credential that stands in for
 * whichever second factor a person cannot currently produce.
 *
 * `consumedAt` rather than deleting the row on use, matching
 * `EmailVerificationTokenRecord` and every other single-use credential in
 * this schema: a deleted row makes a second presentation of a spent code
 * indistinguishable from one that was never issued, and the two deserve
 * different answers. There is no `state` column — `consumedAt` being `null`
 * or an instant is the whole of a code's lifecycle, with no third value a
 * reader would need to fail closed on.
 *
 * `codeHash` is a hash of the code, never the code — the same reason
 * `RefreshTokenRecord`, `EmailVerificationTokenRecord` and
 * `OAuthAuthorizationRequestRecord` all store a hash rather than the
 * credential itself.
 *
 * See `UserRecord` for the conventions every record class follows.
 */
@Entity('mfa_recovery_codes')
@Unique('uq_mfa_recovery_codes_code_hash', ['codeHash'])
export class MfaRecoveryCodeRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_mfa_recovery_codes_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** A hash of the code, never the code. */
  @Column({ name: 'code_hash', type: 'text' })
  codeHash!: string;

  /** When it was used, or `null` if it has not been. */
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
