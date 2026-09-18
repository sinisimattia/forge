import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * The `email_verification_tokens` row — a single-use credential proving that
 * whoever holds it can read the address it was sent to.
 *
 * `consumedAt` rather than deleting the row on use, and the difference matters:
 * a deleted row makes a second presentation of a spent token indistinguishable
 * from a forged one, and the two deserve different answers. Expiry and
 * consumption are separate columns for the same reason — "this expired" and
 * "you already used this" are different facts about what happened.
 *
 * See `UserRecord` for the conventions every record class follows.
 */
@Entity('email_verification_tokens')
@Unique('uq_email_verification_tokens_token_hash', ['tokenHash'])
export class EmailVerificationTokenRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_email_verification_tokens_user_id')
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
