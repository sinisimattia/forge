import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { MfaMethod } from '__FORGE_SCOPE__/core/mfa/entities';
import type { IMfaService } from '__FORGE_SCOPE__/core/mfa/contracts';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import { MfaRemovalDecision } from '__FORGE_SCOPE__/core/mfa/enums';
import {
  MfaLabelRequiredError,
  MfaMethodAlreadyConfirmedError,
  MfaMethodNotFoundError,
  MfaReauthenticationRequiredError,
  MfaVerificationFailedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import { decideMfaRemoval } from '__FORGE_SCOPE__/core/mfa/policies';
import type {
  MfaMethodId,
  MfaProof,
  RecoveryCodeBatch,
  TotpEnrollmentOffer,
} from '__FORGE_SCOPE__/core/mfa/types';
import { UserNotFoundError } from '__FORGE_SCOPE__/core/users/errors';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditService } from '../audit/audit.service';
import { UserRecord } from '../users/user-record.entity';
import { MfaMethodRecord } from './entities/mfa-method-record.entity';
import { mapMfaMethodRecord } from './mapMfaMethodRecord';
import { MfaVerificationService } from './mfa-verification.service';
import { RecoveryCodes } from './recovery/recovery-codes';
import { TotpVerifier } from './totp/TotpVerifier';
import { generateTotpSecret } from './totp/totp-authenticator';
import { buildOtpauthUri, renderQrSvg } from './totp/totp-enrollment';

/**
 * A person's own second factors: turning one on, taking one off, and replacing
 * the recovery codes.
 *
 * ## An unconfirmed method gates nothing
 *
 * {@link MfaService.beginTotpEnrollment} writes a row with `confirmedAt: null`,
 * and that row must not change what signing in asks of the person. Somebody who
 * starts an enrollment and closes the tab has proven nothing, and if the
 * half-finished row made their next sign-in demand a factor they cannot supply,
 * an enrollment they never completed would have locked them out of their own
 * account. Nothing in this class enforces that — it is a property of what the
 * sign-in path *counts*: `decideAuthenticationStep` is given confirmed methods
 * only, and the query every sign-in path goes through —
 * `SecondFactorSettled.confirmedMethodsOf`, in
 * `auth/session/second-factor-settled.ts` — selects with
 * `confirmedAt: Not(IsNull())`. It is
 * pinned at the transport by `mfa.controller.spec.ts` (enrol, then sign in, and
 * get a session).
 *
 * ## The secret leaves once
 *
 * The shared secret is returned by {@link MfaService.beginTotpEnrollment} and by
 * nothing else. {@link MfaService.listMethods} returns entities, and `MfaMethod`
 * has no field one could be carried in.
 *
 * ## Removal: the proof is the second factor, and it is checked by the sign-in's own verifier
 *
 * Taking off the last confirmed method turns the second factor off, so it costs
 * a live proof of one: a code from any confirmed method, or an unused recovery
 * code — **not the password**. An account created through a federated provider
 * may have no password to present, and the threat is a session that is already
 * hijacked, against which a phished password is no barrier (spec §16.1).
 * `POST /mfa/recovery-codes` carries the same requirement, because a fresh
 * batch invalidates the codes the rightful owner is holding.
 *
 * The proof is verified by {@link MfaVerificationService.verifyProof} — the
 * method `POST /auth/mfa/verify` uses — and this class contains no second
 * implementation of it. Only the *verdict* reaches `decideMfaRemoval`, which is
 * pure and cannot verify anything; handing it "a proof was attached" would make
 * every removal allowed.
 */
@Injectable()
export class MfaService implements IMfaService {
  /** The name an authenticator app shows for this deployment. Read once, at construction. */
  private readonly issuer: string;

  public constructor(
    @InjectRepository(MfaMethodRecord)
    private readonly methods: Repository<MfaMethodRecord>,
    @InjectRepository(UserRecord)
    private readonly users: Repository<UserRecord>,
    private readonly totp: TotpVerifier,
    private readonly recoveryCodes: RecoveryCodes,
    private readonly verification: MfaVerificationService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    // `getOrThrow` at construction, so a deployment with no issuer refuses to
    // boot rather than starting and failing on the first enrollment — the same
    // arrangement `OAuthController` makes for `PUBLIC_WEBAPP_URL`. The value is
    // configuration and never a literal here: a name baked into a template is
    // the name every project generated from it would show in its users'
    // authenticator apps.
    this.issuer = config.getOrThrow<string>('MFA_ISSUER');
  }

  /**
   * The actor's own methods, confirmed or not, oldest first.
   *
   * A row `mapMfaMethodRecord` refuses (a type nothing models, or a `TOTP` row
   * with no secret) makes this throw, and so answers `500`, rather than being
   * skipped: a listing that quietly omitted a method the account actually holds
   * would be a wrong answer about the account's own security.
   */
  public async listMethods(actorId: UserId): Promise<MfaMethod[]> {
    const rows = await this.methods.find({
      where: { userId: actorId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((row) => mapMfaMethodRecord(row));
  }

  /**
   * Mints a secret and an unconfirmed method to hold it.
   *
   * The id is minted here rather than left to the column's default, so that it
   * is known to be a UUID before anything is inserted —
   * {@link MfaService.confirmTotpEnrollment} refuses any other shape before it
   * queries, and the store is not the thing that should decide what an id looks
   * like.
   *
   * The account is read first because its address goes in the label an
   * authenticator app shows. That read is also why an actor with no user row is
   * refused here in the service, where `FakeDataSource` (no foreign keys — its
   * item 7) would otherwise have let the insert through and only Postgres would
   * have refused it.
   *
   * @throws MfaLabelRequiredError when the label is empty or only whitespace
   * @throws UserNotFoundError when the actor has no user row
   */
  public async beginTotpEnrollment(actorId: UserId, label: string): Promise<TotpEnrollmentOffer> {
    const trimmed = label.trim();
    if (trimmed === '') throw new MfaLabelRequiredError();

    const account = await this.users.findOne({ where: { id: actorId } });
    if (account === null) throw new UserNotFoundError(actorId);

    const secret = generateTotpSecret();
    const id = randomUUID();

    await this.methods.insert({
      id,
      userId: actorId,
      type: MfaMethodType.TOTP,
      label: trimmed,
      totpSecret: secret,
      totpLastStep: null,
      webauthnCredentialId: null,
      webauthnPublicKey: null,
      webauthnCounter: null,
      // The line the whole class TSDoc is about.
      confirmedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    });

    const otpauthUri = buildOtpauthUri({ issuer: this.issuer, account: account.email, secret });
    return {
      methodId: id as MfaMethodId,
      otpauthUri,
      qrSvg: await renderQrSvg(otpauthUri),
      secret,
    };
  }

  /**
   * Proves the person holds a working copy of the secret, and only then trusts
   * the method.
   *
   * The code is checked with `lastStep` `null` — an unconfirmed method has never
   * accepted one — and the accepted step is stored as `totpLastStep` in the same
   * write that sets `confirmedAt`, so the code that confirmed the method cannot
   * be presented again at sign-in inside its own window.
   *
   * ## One transaction
   *
   * Confirming the method and issuing the account's first batch of recovery
   * codes commit together or not at all. A method confirmed with no codes issued
   * would be the worst state this feature can produce — a second factor on the
   * account and no way back in from a lost phone — so a failure writing the batch
   * rolls the confirmation back too, and `mfa.controller.spec.ts` asserts it.
   *
   * ## One winner
   *
   * The write is `UPDATE … WHERE id = ? AND confirmed_at IS NULL` and its
   * affected-row count decides: two confirmations racing on one method both pass
   * the read above it, and exactly one of them updates a row. The other is told
   * the method is already confirmed, as it would have been a moment later.
   *
   * ## Recovery codes: once per account
   *
   * A batch is minted when, after this confirmation, the account has exactly one
   * confirmed method — the one just confirmed. The account's `users` row is
   * locked (`SELECT … FOR UPDATE`) first, so two different methods confirmed at
   * the same instant by one account are serialised and only the first sees a
   * count of one. `FakeDataSource` models that lock (`lockedRows`) but not
   * Postgres's behaviour around it (its item 1), so the spec shows the service
   * asks for the lock, not that Postgres serialises the two.
   *
   * @throws MfaMethodNotFoundError when the id is not a UUID, is not theirs, or
   *   names a method that is not a TOTP method
   * @throws MfaMethodAlreadyConfirmedError when it was already confirmed
   * @throws MfaVerificationFailedError when the code does not verify
   */
  public async confirmTotpEnrollment(
    actorId: UserId,
    methodId: MfaMethodId,
    code: string,
  ): Promise<RecoveryCodeBatch | null> {
    // Before the lookup, not by it: `mfa_methods.id` is a `uuid` column, and
    // Postgres answers a malformed id with `22P02` — a driver error and a `500` —
    // rather than with no row. See `MfaVerificationService.verifyProof`.
    if (!isUUID(methodId)) throw new MfaMethodNotFoundError(methodId);

    // Scoped by the actor in the query itself, so another person's method is
    // indistinguishable from one that does not exist.
    const method = await this.methods.findOne({ where: { id: methodId, userId: actorId } });
    if (method === null || method.type !== MfaMethodType.TOTP) {
      throw new MfaMethodNotFoundError(methodId);
    }
    if (method.confirmedAt !== null) throw new MfaMethodAlreadyConfirmedError(methodId);

    const seed = method.totpSecret;
    // `mapMfaMethodRecord` would refuse this row on sight, and this path does not
    // go through it. Nothing can be proven against no seed.
    if (seed === null) throw new MfaVerificationFailedError();

    const now = new Date();
    const result = this.totp.verify(seed, code, null, now);
    if (!result.accepted) throw new MfaVerificationFailedError();

    return this.dataSource.transaction(async (manager) => {
      // The account's row, locked: two confirmations for one account take
      // turns, so the second counts confirmed methods after the first has
      // committed. Without it each could see a count of one and each issue a
      // batch, the later replacing the one the person was already shown.
      await manager.findOne(UserRecord, {
        where: { id: actorId },
        lock: { mode: 'pessimistic_write' },
      });

      const updated = await manager.update(
        MfaMethodRecord,
        { id: methodId, userId: actorId, confirmedAt: IsNull() },
        { confirmedAt: now, totpLastStep: String(result.step) },
      );
      if (updated.affected !== 1) throw new MfaMethodAlreadyConfirmedError(methodId);

      const confirmed = await manager.find(MfaMethodRecord, {
        where: { userId: actorId, confirmedAt: Not(IsNull()) },
      });
      const firstMethod = confirmed.length === 1;

      // In this transaction, so the entry and the confirmation commit together:
      // an entry that outlived a rolled-back confirmation would be a permanent
      // record of a factor that was never attached. `recoveryCodesIssued` says
      // whether the first set of recovery codes came with it, which is the one
      // moment codes are issued that is not a regeneration.
      await this.audit.recordIn(manager, {
        organizationId: null,
        actorId,
        action: AuditAction.MFA_METHOD_ADDED,
        resourceType: 'mfa_method',
        resourceId: methodId,
        metadata: { methodType: MfaMethodType.TOTP, recoveryCodesIssued: firstMethod },
        clientAddress: null,
        clientLabel: null,
        occurredAt: now,
      });

      if (!firstMethod) return null;

      // Joined to this transaction. If the batch cannot be written the
      // confirmation is rolled back with it: the person is left with an
      // unconfirmed method and no second factor on the account, and can try again.
      return { codes: await this.recoveryCodes.generate(actorId, manager) };
    });
  }

  /**
   * Removes one of the actor's own methods, demanding a live proof when — and
   * only when — `decideMfaRemoval` says the removal would leave the account
   * with no confirmed method.
   *
   * ## Order
   *
   * The method is looked up **within the actor's own methods first**, so
   * another person's method and an id that does not exist are the same
   * `MfaMethodNotFoundError` — decided before anything about what removing it
   * would cost, or the difference between "needs a proof" and "not found" would
   * say which ids are somebody's last method.
   *
   * The policy is then asked whether a proof is owed at all (with `false`). Only
   * if one is, and one was offered, is it verified — so a removal that costs
   * nothing never spends a recovery code or a TOTP step, and one that does
   * cannot be talked into skipping the check. The verdict of that verification,
   * and nothing weaker, is what the deciding call receives.
   *
   * ## Verified before the transaction, decided inside it
   *
   * Those first two steps read through the repositories and **finish before any
   * transaction opens**. Verifying spends a code or a TOTP step through the
   * repositories, which is a second connection; done inside the transaction it
   * would hold a pooled connection and the account's row lock while waiting for
   * another connection, so as many concurrent removals as the pool has
   * connections would each hold one and wait for a second — a deadlock — and
   * the lock would be held across the whole verification rather than across the
   * decision it protects. It is also why a spent code stays spent when the
   * removal is then refused or rolled back: the burn happened before the
   * transaction began, and the code has been shown to the server either way.
   *
   * The transaction then locks the actor's `users` row — the lock
   * `confirmTotpEnrollment` and `regenerateRecoveryCodes` take — re-reads the
   * methods, and decides **again** with the verdict it was handed, because the
   * first read is a snapshot that a concurrent removal may have changed. Two
   * removals of an account's last two methods take turns: unlocked, each would
   * count the other as the survivor and both would delete, leaving the account
   * with no second factor and no proof ever asked for. `mfa-removal.spec.ts`
   * overlaps two removals and shows exactly one succeeds; `FakeDataSource`
   * queues on the row, which shows the service asks for the lock and not what
   * Postgres does (its items 1 and 2).
   *
   * @throws MfaMethodNotFoundError when the id is not a UUID, is not theirs, or does not exist
   * @throws MfaReauthenticationRequiredError when a proof is owed and none was offered
   * @throws MfaVerificationFailedError when a proof was owed and does not verify,
   *   including one that names a method that is not the actor's confirmed one
   * @throws RecoveryCodeAlreadyConsumedError when the proof is a recovery code that was spent
   */
  public async removeMethod(
    actorId: UserId,
    methodId: MfaMethodId,
    proof: MfaProof | null,
  ): Promise<void> {
    // Before the lookup, for the reason `confirmTotpEnrollment` gives.
    if (!isUUID(methodId)) throw new MfaMethodNotFoundError(methodId);

    // A snapshot, read outside any transaction: it is only used to learn whether
    // a proof is owed, so that the proof can be verified before one is opened.
    const snapshot = (await this.methods.find({
      where: { userId: actorId },
      order: { createdAt: 'ASC' },
    })).map((row) => mapMfaMethodRecord(row));
    if (!snapshot.some((method) => method.id === methodId)) {
      throw new MfaMethodNotFoundError(methodId);
    }

    // "Is a proof owed?" — asked with `false`, and not a verdict on anything.
    let proofVerified = false;
    if (
      decideMfaRemoval(snapshot, methodId, false) !== MfaRemovalDecision.ALLOWED
      && proof !== null
    ) {
      // Throws when the proof is not good; there is no path past this line
      // with an unverified proof.
      await this.proveSecondFactor(actorId, proof);
      proofVerified = true;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.findOne(UserRecord, {
        where: { id: actorId },
        lock: { mode: 'pessimistic_write' },
      });

      const rows = await manager.find(MfaMethodRecord, {
        where: { userId: actorId },
        order: { createdAt: 'ASC' },
      });
      const methods = rows.map((row) => mapMfaMethodRecord(row));
      if (!methods.some((method) => method.id === methodId)) {
        throw new MfaMethodNotFoundError(methodId);
      }

      if (decideMfaRemoval(methods, methodId, proofVerified) !== MfaRemovalDecision.ALLOWED) {
        throw new MfaReauthenticationRequiredError();
      }

      await manager.delete(MfaMethodRecord, { id: methodId, userId: actorId });

      // Only a confirmed method was ever recorded as added, so only its removal
      // is an event the trail can describe. `methods` was read inside this
      // transaction, under the lock, so it is the row that was deleted.
      const removed = methods.find((method) => method.id === methodId);
      if (removed !== undefined && removed.isConfirmed()) {
        await this.audit.recordIn(manager, {
          organizationId: null,
          actorId,
          action: AuditAction.MFA_METHOD_REMOVED,
          resourceType: 'mfa_method',
          resourceId: methodId,
          metadata: { methodType: removed.type, reauthenticated: proofVerified },
          clientAddress: null,
          clientLabel: null,
          occurredAt: new Date(),
        });
      }
    });
  }

  /**
   * Replaces every recovery code the actor holds, after a live proof.
   *
   * ## Concurrent regeneration
   *
   * `RecoveryCodes.generate` deletes and then inserts, and two overlapping calls
   * under READ COMMITTED can each delete and each insert, leaving twenty live
   * codes. The write therefore runs in a transaction that first takes the
   * actor's `users` row lock — the same lock `confirmTotpEnrollment` takes — so
   * two regenerations, or a regeneration and a first confirmation, take turns
   * and the second one's delete removes the first one's batch.
   *
   * The proof is verified before the lock is taken: a code that does not
   * verify has no business holding the account's row.
   *
   * @throws MfaVerificationFailedError when the proof does not verify, including
   *   one that names a method that is not the actor's confirmed one
   * @throws RecoveryCodeAlreadyConsumedError when the proof is a recovery code that was spent
   */
  public async regenerateRecoveryCodes(
    actorId: UserId,
    proof: MfaProof,
  ): Promise<RecoveryCodeBatch> {
    await this.proveSecondFactor(actorId, proof);

    return this.dataSource.transaction(async (manager) => {
      await manager.findOne(UserRecord, {
        where: { id: actorId },
        lock: { mode: 'pessimistic_write' },
      });
      const codes = await this.recoveryCodes.generate(actorId, manager);
      await this.audit.recordIn(manager, {
        organizationId: null,
        actorId,
        action: AuditAction.RECOVERY_CODES_REGENERATED,
        resourceType: 'user',
        resourceId: actorId,
        metadata: {},
        clientAddress: null,
        clientLabel: null,
        occurredAt: new Date(),
      });
      return { codes };
    });
  }

  /**
   * Judges a proof through {@link MfaVerificationService.verifyProof} and
   * answers a refusal in the contract's own terms.
   *
   * A proof naming a method that is not the actor's confirmed one comes back
   * from the verifier as `MfaMethodNotFoundError`, which is right for a sign-in
   * and wrong here: on these two calls the method a `MfaMethodNotFoundError`
   * names is the one in the *path*, and a caller must be able to tell a bad
   * target from a bad proof. Every way a proof can fail to hold is
   * `MfaVerificationFailedError` — a spent recovery code alone keeps its own
   * error, which is a distinct, useful fact to a signed-in person.
   */
  private async proveSecondFactor(actorId: UserId, proof: MfaProof): Promise<void> {
    try {
      await this.verification.verifyProof(actorId, proof);
    } catch (error) {
      if (error instanceof MfaMethodNotFoundError) throw new MfaVerificationFailedError();
      throw error;
    }
  }
}
