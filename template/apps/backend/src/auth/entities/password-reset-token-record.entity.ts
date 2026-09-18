import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * The `password_reset_tokens` row — a single-use credential that lets whoever
 * holds it set a new password on the account it names.
 *
 * Structurally identical to `EmailVerificationTokenRecord` and deliberately a
 * separate table rather than one table with a `purpose` column. The two have
 * the same shape and different consequences: this one replaces a credential,
 * that one proves an address, and one lifetime, one expiry policy and one
 * revocation rule covering both is a decision nobody would make on purpose.
 * Separate tables also mean a bug that leaks one kind of token cannot be made
 * to produce the other.
 *
 * See `UserRecord` for the conventions every record class follows, and
 * `EmailVerificationTokenRecord` for why consumption is a column rather than a
 * deletion.
 */
@Entity('password_reset_tokens')
@Unique('uq_password_reset_tokens_token_hash', ['tokenHash'])
export class PasswordResetTokenRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_password_reset_tokens_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** A hash of the token, never the token. */
  @Column({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** When it was used, or `null` if it has not been. */
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
