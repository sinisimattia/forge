import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * The `refresh_tokens` row — the credential that renews a session, recorded so
 * that reusing a spent one is detectable.
 *
 * Core models no such thing, and that is the boundary holding: how a caller
 * demonstrates it holds a session is a transport concern. All of it lives here.
 *
 * The table is the shape it is because of one attack. A refresh token that has
 * already been exchanged is presented again — either the legitimate client
 * retried, or somebody stole it. The two are indistinguishable from the request
 * alone, so the record has to carry enough history to tell them apart after the
 * fact: `usedAt` says this one has been spent, and `replacedById` says what was
 * issued in its place, so the whole chain from a stolen token forward can be
 * walked and revoked. A table that only deleted spent tokens would see an
 * unknown token and have nothing to say.
 *
 * See `UserRecord` for the conventions every record class follows.
 */
@Entity('refresh_tokens')
@Unique('uq_refresh_tokens_token_hash', ['tokenHash'])
export class RefreshTokenRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_refresh_tokens_session_id')
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  /**
   * A hash of the token, never the token.
   *
   * The unique constraint above is what this column is looked up through on
   * every renewal — a unique constraint is a unique index, so no second index
   * is declared for it.
   */
  @Column({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  /** The token issued in this one's place, or `null` while this one is current. */
  @Column({ name: 'replaced_by_id', type: 'uuid', nullable: true })
  replacedById!: string | null;

  /** When this token was exchanged, or `null` if it has not been. */
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
