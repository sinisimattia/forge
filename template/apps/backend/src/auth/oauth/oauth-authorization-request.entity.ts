import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';

/**
 * The `oauth_authorization_requests` row — the record that ties a provider's
 * callback back to the request that sent the browser there in the first
 * place. See the migration that creates this table
 * (`db/migrations/1758000004000-OAuthAuthorizationRequests.ts`) for the
 * reasoning behind each column; this class mirrors its shape rather than
 * repeating the argument.
 *
 * Core models no such thing, the same boundary `RefreshTokenRecord` and
 * `EmailVerificationTokenRecord` hold: how a sign-in or a link is carried
 * across a redirect to a third party is a transport concern, not a domain one.
 *
 * See `UserRecord` for the conventions every record class follows.
 */
@Entity('oauth_authorization_requests')
@Unique('uq_oauth_authorization_requests_state', ['stateHash'])
export class OAuthAuthorizationRequestRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** A hash of the state value, never the state. */
  @Column({ name: 'state_hash', type: 'text' })
  stateHash!: string;

  /**
   * The PKCE verifier, in the clear.
   *
   * The opposite kind of secret from `stateHash`: this is what the server
   * proves to the provider at the token exchange, so it must be recoverable
   * here, where the state is only ever compared. Hashing this column would
   * make the exchange it exists for impossible.
   */
  @Column({ name: 'code_verifier', type: 'text' })
  codeVerifier!: string;

  @Column({ name: 'provider', type: 'text' })
  provider!: AuthProvider;

  /**
   * What this request is for, fixed at creation so the callback cannot infer
   * — or have edited into — its own purpose from anything the caller sent.
   */
  @Column({ name: 'purpose', type: 'text' })
  purpose!: string;

  /** Set only for a link, so a deleted account leaves no pending link behind. */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  /** Where the browser returns to once this request completes, if anywhere. */
  @Column({ name: 'redirect_to', type: 'text', nullable: true })
  redirectTo!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Index('ix_oauth_authorization_requests_expires_at')
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** When this request was consumed, or `null` if it has not been. */
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
}
