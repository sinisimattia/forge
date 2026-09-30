import { MfaMethod } from '__FORGE_SCOPE__/core/mfa/entities';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import type { MfaMethodId } from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { MfaMethodRecord } from './entities/mfa-method-record.entity';

/**
 * One row to one entity — and the only thing standing between a corrupted
 * `mfa_methods` row and the code that acts on it. `type` is plain `text`
 * with no `CHECK` (see `1758000005000-Mfa.ts`'s own TSDoc for why, deliberate
 * rather than unfinished), so a row whose `type` names nothing
 * `MfaMethodType` models — or that names a real member but is missing the
 * material that member requires — is reachable in principle: corruption, a
 * future writer, a botched migration.
 *
 * Dispatch below is explicit equality per modelled `MfaMethodType` member,
 * matching the shape `OAuthAuthorizationPurpose` is dispatched on in
 * `oauth.service.ts`, ending in an unconditional throw. Never a `default`
 * that proceeds and never a ternary that reads "not TOTP, so it must be
 * WebAuthn" — a value this function has never seen is not "the other one",
 * and a ternary that treats it that way is how a corrupted column ends up
 * driving a decision nobody modelled for it.
 *
 * ## Why a missing secret is refused here, not left to fail at sign-in
 *
 * A `TOTP` row with a null `totpSecret` is not a method that merely fails to
 * verify the next time someone tries it. It is an account whose login now
 * demands a factor no code path can ever supply — a lockout. Refusing that
 * the moment the row is read, from a call site somebody can see the
 * exception from, is strictly better than refusing it at the next sign-in
 * attempt made by the person it has trapped, where all anyone observes is a
 * method that used to work no longer working. The `WEBAUTHN` branch refuses
 * for the same reason: a credential id or public key that is null can never
 * produce a valid assertion, so the row is already the lockout, whether or
 * not anyone has tried to use it yet.
 *
 * @param record - the stored row
 * @returns the same method as a domain entity, with every invariant
 *   `MfaMethod`'s constructor enforces already run
 * @throws Error when `type` names nothing `MfaMethodType` models, or when the
 *   row's material does not match the type it claims
 */
export function mapMfaMethodRecord(record: MfaMethodRecord): MfaMethod {
  if (record.type === MfaMethodType.TOTP) {
    if (record.totpSecret === null) {
      throw new Error(
        `mfa_methods row ${record.id} claims type TOTP but totp_secret is null — `
        + 'a login that can never be completed, refused at read rather than at the next sign-in.',
      );
    }
  } else if (record.type === MfaMethodType.WEBAUTHN) {
    if (record.webauthnCredentialId === null || record.webauthnPublicKey === null) {
      throw new Error(
        `mfa_methods row ${record.id} claims type WEBAUTHN but is missing its credential id `
        + 'or public key — a login that can never be completed, refused at read rather than '
        + 'at the next sign-in.',
      );
    }
  } else {
    throw new Error(
      `mfa_methods row ${record.id} names a type no MfaMethodType member is: "${record.type}".`,
    );
  }

  return new MfaMethod({
    id: record.id as MfaMethodId,
    userId: record.userId as UserId,
    type: record.type,
    label: record.label,
    createdAt: record.createdAt,
    confirmedAt: record.confirmedAt,
    lastUsedAt: record.lastUsedAt,
  });
}
