import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';

/**
 * The `auth_identities` row — one way a particular user can prove who they are.
 *
 * This is where the record classes stop being a transcription of a core entity.
 * Core's `AuthIdentity` has no field for a password derivation and never will
 * (ADR-0005): it models *which* proof exists, not the proof. The three columns
 * at the bottom of this class are that proof, and they exist only here, which
 * is what makes it impossible for a serialized identity to leak one.
 *
 * See `UserRecord` for the conventions every record class follows.
 */
@Entity('auth_identities')
@Unique('uq_auth_identities_provider_account', ['provider', 'providerAccountId'])
// The migration is the schema's authority — `synchronize` is off and nothing
// here creates anything. This mirrors it so that the two rules this table
// enforces are both visible from the class a reader has open, and so that the
// partial one is not mistaken for the table-level `@Unique` above it. They are
// different rules: this one permits several GITHUB identities on one account and
// forbids a second PASSWORD one. `migration-sql.spec.ts` compares this predicate
// against the migration's, so the mirror cannot quietly stop matching.
@Index('uq_auth_identities_one_password_per_user', ['userId'], {
  unique: true,
  where: "provider = 'PASSWORD'",
})
export class AuthIdentityRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_auth_identities_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'provider', type: 'text' })
  provider!: AuthProvider;

  /**
   * How this provider names the account: the normal-form address for
   * `PASSWORD`, the provider's own subject identifier otherwise.
   */
  @Column({ name: 'provider_account_id', type: 'text' })
  providerAccountId!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** When this identity was last used successfully, or `null` if never. */
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  /**
   * A one-way derivation of the password — never the password, and never
   * anything from which it can be recovered.
   *
   * `null` for every provider but `PASSWORD`, where the proof is held by
   * somebody else. Nullable rather than split into a second table: a password
   * identity and a federated one are the same kind of thing to everything that
   * reads them, and a join that is `NULL` three times out of four buys nothing.
   */
  @Column({ name: 'secret_hash', type: 'text', nullable: true })
  secretHash!: string | null;

  /** Which derivation produced `secretHash`, so a stored one can be recognized. */
  @Column({ name: 'secret_algorithm', type: 'text', nullable: true })
  secretAlgorithm!: string | null;

  /**
   * The cost parameters it was produced with.
   *
   * Stored beside the derivation rather than read from configuration at
   * verification time, because configuration changes: a derivation produced
   * under last year's parameters still has to verify, and then be re-derived
   * under this year's. Without this column that upgrade is not possible and
   * the old parameters become permanent.
   */
  @Column({ name: 'secret_params', type: 'jsonb', nullable: true })
  secretParams!: Record<string, unknown> | null;
}
