import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';

/**
 * The `mfa_methods` row — one second factor a user has enrolled, together
 * with whichever secret material proves it.
 *
 * Core's `MfaMethod` holds none of that material (see its own TSDoc): no
 * shared secret, no public key, no signature counter. Those five columns —
 * `totpSecret`, `totpLastStep`, `webauthnCredentialId`, `webauthnPublicKey`,
 * `webauthnCounter` — exist only here, which is what makes it structurally
 * impossible for a served `MfaMethod` to leak one: the only way a row becomes
 * a core `MfaMethod` is `mapMfaMethodRecord`, and it copies none of the five.
 *
 * Several places read them directly off a record, and that is the point rather
 * than a leak: checking a proof needs the material, and a reader that has it is
 * holding a `MfaMethodRecord`, which by construction never leaves this side of
 * that boundary.
 *
 * `type` is declared as `MfaMethodType` here as a claim about what this class
 * *writes* — TypeORM has no way to enforce it — and never a guarantee about
 * what a `SELECT` reads back: the column is plain `text` with no `CHECK`
 * (see `1758000005000-Mfa.ts`), so a row a future migration or a bad write
 * left behind can hold a string neither `MfaMethodType` member is. Reading
 * this field is only safe through `mapMfaMethodRecord`, which refuses
 * anything else rather than passing it on.
 *
 * `totpLastStep` and `webauthnCounter` are `bigint` columns, which the
 * Postgres driver returns as `string` rather than `number` — a 64-bit value
 * does not fit a JS `number` without losing precision — so both are typed
 * `string | null` here, not `number | null`.
 *
 * See `UserRecord` for the conventions every record class follows.
 */
@Entity('mfa_methods')
@Unique('uq_mfa_methods_webauthn_credential', ['webauthnCredentialId'])
export class MfaMethodRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_mfa_methods_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'type', type: 'text' })
  type!: MfaMethodType;

  @Column({ name: 'label', type: 'text' })
  label!: string;

  /** The shared TOTP secret, or `null` for a `WEBAUTHN` method. */
  @Column({ name: 'totp_secret', type: 'text', nullable: true })
  totpSecret!: string | null;

  /** The last time step this method accepted a code for, or `null` if none yet. */
  @Column({ name: 'totp_last_step', type: 'bigint', nullable: true })
  totpLastStep!: string | null;

  /** The WebAuthn credential id, or `null` for a `TOTP` method. */
  @Column({ name: 'webauthn_credential_id', type: 'text', nullable: true })
  webauthnCredentialId!: string | null;

  /** The WebAuthn credential's public key, or `null` for a `TOTP` method. */
  @Column({ name: 'webauthn_public_key', type: 'text', nullable: true })
  webauthnPublicKey!: string | null;

  /** The WebAuthn signature counter, or `null` for a `TOTP` method. */
  @Column({ name: 'webauthn_counter', type: 'bigint', nullable: true })
  webauthnCounter!: string | null;

  /** When enrollment was completed by a successful proof, or `null` if it never was. */
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  /** When this method was last used successfully, or `null` if never. */
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
