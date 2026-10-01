import { createHash, randomBytes } from 'node:crypto';
import type { IMfaService } from '__FORGE_SCOPE__/core/mfa/contracts';
import { MfaMethod } from '__FORGE_SCOPE__/core/mfa/entities';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import { MfaEnrollmentDecision, MfaRemovalDecision } from '__FORGE_SCOPE__/core/mfa/enums';
import {
  MfaMethodAlreadyConfirmedError,
  MfaMethodNotFoundError,
  MfaReauthenticationRequiredError,
  MfaVerificationFailedError,
  RecoveryCodeAlreadyConsumedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import { decideMfaEnrollment, decideMfaRemoval } from '__FORGE_SCOPE__/core/mfa/policies';
import type {
  MfaMethodId,
  MfaMethodJSON,
  MfaProof,
  RecoveryCodeBatch,
  TotpEnrollmentOffer,
} from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

/** A cheap, deterministic stand-in for a real digest — sha256 is on `node:crypto`. */
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * A reference implementation over Maps of wire rows.
 *
 * It stores rows rather than entities, and a shared TOTP secret beside them
 * rather than on the entity itself — the same separation `MfaMethod`'s own
 * TSDoc describes for a real implementation's store. Verifying a TOTP code
 * is a plain string comparison here, the same simplification
 * `InMemoryAuthService` makes for a password: this suite exists to pin
 * *behavior*, and the actual RFC 6238 algorithm is the backend's `TotpVerifier`,
 * pinned against RFC 6238 Appendix B by the backend's own suite.
 *
 * Recovery codes are the one place this double does not simplify: they are
 * hashed before being stored, because the security suite's whole point is to
 * catch an implementation that skipped exactly that step.
 */
export class InMemoryMfaService implements IMfaService {
  private readonly methods = new Map<string, MfaMethodJSON>();
  private readonly totpSecrets = new Map<string, string>();
  /** Digests of every code a batch ever minted for a user, whether spent or not. */
  private readonly everIssued = new Map<string, Set<string>>();
  /** Digests of the codes from the latest batch that have not yet been spent. */
  private readonly unspent = new Map<string, Set<string>>();
  /** `methodId:code` for every TOTP code that has proved something — a code proves once. */
  private readonly spentCodes = new Set<string>();
  private issued = 0;

  private nextId(prefix: string): string {
    this.issued += 1;
    return `${prefix}-${this.issued}`;
  }

  /**
   * Puts an already-confirmed method into the world, with the secret it
   * verifies against — for the security suite, which needs a world no
   * caller of the contract could build for itself (see DEC-1).
   */
  seedConfirmedMethod(row: MfaMethodJSON, secret: string): void {
    this.methods.set(row.id, row);
    this.totpSecrets.set(row.id, secret);
  }

  /** The raw values persisted for a user's current recovery codes — digests, if correct. */
  storedRecoveryCodeValuesFor(userId: UserId): readonly string[] {
    return Array.from(this.unspent.get(userId) ?? []);
  }

  async listMethods(actorId: UserId): Promise<MfaMethod[]> {
    return this.entitiesFor(actorId);
  }

  async beginTotpEnrollment(actorId: UserId, label: string): Promise<TotpEnrollmentOffer> {
    const id = this.nextId('method') as MfaMethodId;
    const secret = randomBytes(10).toString('hex');
    // Constructed through the entity, so MfaLabelRequiredError is thrown for
    // a blank label the same way a real implementation's would be.
    const method = new MfaMethod({
      id,
      userId: actorId,
      type: MfaMethodType.TOTP,
      label,
      createdAt: new Date(),
      confirmedAt: null,
      lastUsedAt: null,
    });
    this.methods.set(id, method.toJSON());
    this.totpSecrets.set(id, secret);

    return {
      methodId: id,
      otpauthUri: `otpauth://totp/Example:${String(actorId)}?secret=${secret}&issuer=Example`,
      qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      secret,
    };
  }

  async confirmTotpEnrollment(
    actorId: UserId,
    methodId: MfaMethodId,
    code: string,
    proof: MfaProof | null,
  ): Promise<RecoveryCodeBatch | null> {
    const row = this.ownedRow(actorId, methodId);
    if (row.confirmedAt !== null) throw new MfaMethodAlreadyConfirmedError(methodId);

    // Asked of the account's methods as they stand, with this one still
    // unconfirmed, and with `false`: whether a proof is owed at all.
    const owed = decideMfaEnrollment(this.entitiesFor(actorId), false)
      !== MfaEnrollmentDecision.ALLOWED;
    if (owed && proof === null) throw new MfaReauthenticationRequiredError();

    if (this.totpSecrets.get(methodId) !== code) throw new MfaVerificationFailedError();
    // After the new method's own code, so a mistyped one does not spend the proof.
    if (owed && proof !== null && !(await this.verifyProof(actorId, proof))) {
      throw new MfaVerificationFailedError();
    }
    this.spentCodes.add(`${methodId}:${code}`);

    const hadConfirmedMethod = Array.from(this.methods.values())
      .some((other) => other.userId === actorId && other.confirmedAt !== null);
    this.methods.set(methodId, { ...row, confirmedAt: new Date().toISOString() });

    return hadConfirmedMethod ? null : this.mintRecoveryCodes(actorId);
  }

  async removeMethod(
    actorId: UserId,
    methodId: MfaMethodId,
    proof: MfaProof | null,
  ): Promise<void> {
    this.ownedRow(actorId, methodId);
    const provisional = decideMfaRemoval(this.entitiesFor(actorId), methodId, false);

    if (provisional !== MfaRemovalDecision.ALLOWED) {
      if (proof === null) throw new MfaReauthenticationRequiredError();
      if (!(await this.verifyProof(actorId, proof))) throw new MfaVerificationFailedError();
    }

    this.methods.delete(methodId);
    this.totpSecrets.delete(methodId);
  }

  async regenerateRecoveryCodes(actorId: UserId, proof: MfaProof): Promise<RecoveryCodeBatch> {
    if (!(await this.verifyProof(actorId, proof))) throw new MfaVerificationFailedError();
    return this.mintRecoveryCodes(actorId);
  }

  private ownedRow(actorId: UserId, methodId: MfaMethodId): MfaMethodJSON {
    const row = this.methods.get(methodId);
    if (row === undefined || row.userId !== actorId) throw new MfaMethodNotFoundError(methodId);
    return row;
  }

  private entitiesFor(actorId: UserId): MfaMethod[] {
    return Array.from(this.methods.values())
      .filter((row) => row.userId === actorId)
      .map((row) => MfaMethod.fromJSON(row));
  }

  /**
   * Verifies a proof against whichever branch it populates.
   *
   * @throws RecoveryCodeAlreadyConsumedError when the recovery code was
   * real but has already been spent — distinguishable from a code that was
   * simply never issued, which returns `false` like any other wrong proof
   */
  private async verifyProof(actorId: UserId, proof: MfaProof): Promise<boolean> {
    if ('methodId' in proof) {
      const row = this.methods.get(proof.methodId);
      if (row === undefined || row.userId !== actorId || row.confirmedAt === null) return false;
      if (this.spentCodes.has(`${proof.methodId}:${proof.code}`)) return false;
      if (this.totpSecrets.get(proof.methodId) !== proof.code) return false;
      this.spentCodes.add(`${proof.methodId}:${proof.code}`);
      return true;
    }

    const hit = digest(proof.recoveryCode);
    const unspent = this.unspent.get(actorId);
    if (unspent?.has(hit) === true) {
      unspent.delete(hit);
      return true;
    }
    if (this.everIssued.get(actorId)?.has(hit) === true) {
      throw new RecoveryCodeAlreadyConsumedError();
    }
    return false;
  }

  private mintRecoveryCodes(actorId: UserId): RecoveryCodeBatch {
    const codes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex'));
    const digests = new Set(codes.map(digest));
    this.everIssued.set(actorId, digests);
    this.unspent.set(actorId, new Set(digests));
    return { codes };
  }
}
