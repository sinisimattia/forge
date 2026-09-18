import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The `sessions` row — one continuous period during which a person is treated
 * as signed in.
 *
 * Carries no credential, exactly as core's `Session` carries none. What a
 * caller presents to demonstrate it holds this session is a refresh token, and
 * refresh tokens live in their own table with only a hash of themselves stored.
 * The consequence is worth stating: the whole of this table can be shown to the
 * person it belongs to, which is what makes a "your active sessions" screen
 * possible without a redaction step nobody would remember to keep correct.
 *
 * See `UserRecord` for the conventions every record class follows.
 */
@Entity('sessions')
export class SessionRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_sessions_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz' })
  lastUsedAt!: Date;

  /** When the session ends of its own accord. */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** When it was ended early, or `null` if it ran or is running its course. */
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  /** The network address the session began from, as the application saw it. */
  @Column({ name: 'client_address', type: 'text', nullable: true })
  clientAddress!: string | null;

  /** A short, opaque description of the client, for the owner to recognize. */
  @Column({ name: 'client_label', type: 'text', nullable: true })
  clientLabel!: string | null;
}
