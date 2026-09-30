import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import {
  MfaMethodNotFoundError,
  MfaVerificationFailedError,
  RecoveryCodeAlreadyConsumedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import type { MfaMethodId, MfaProof } from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditService } from '../audit/audit.service';
import { toUserEntity } from '../users/to-user';
import { UserRecord } from '../users/user-record.entity';
import type { MfaChallengeMethodDto } from '../auth/dto/mfa-challenge-response.dto';
import { SecondFactorSettled } from '../auth/session/second-factor-settled';
import { IssuedCredentials, SessionService } from '../auth/session/session.service';
import { MfaChallengeRecord } from './entities/mfa-challenge-record.entity';
import { MfaMethodRecord } from './entities/mfa-method-record.entity';
import { MfaChallengePurpose } from './enums/MfaChallengePurpose';
import { mapMfaMethodRecord } from './mapMfaMethodRecord';
import { MfaChallengeService } from './mfa-challenge.service';
import { RecoveryCodes } from './recovery/recovery-codes';
import { TotpVerifier } from './totp/TotpVerifier';

/** What a completed second factor produces. The user is named, not carried: see {@link MfaVerificationService.completeLogin}. */
export interface MfaLoginCompletion {
  /** The session and the two credentials it was opened with. */
  readonly credentials: IssuedCredentials;
  /** Whose sign-in this completed — read off the challenge row, never off the request. */
  readonly userId: UserId;
}

/**
 * The second half of a two-phase sign-in: a challenge spent, a proof checked,
 * and only then a session.
 *
 * ## Who the account is, is decided by the challenge and by nothing else
 *
 * `POST /auth/mfa/verify` is `@Public()` — a caller reaching it has, by
 * definition, no session yet — so the only thing it can prove is possession of
 * a challenge token this server minted after a password verified. **Every
 * identity decision below therefore reads `row.userId`**, the value on the
 * consumed challenge, and nothing reads anything the request supplied. A
 * request carries a `methodId`, and that is a *selection* among the account's
 * own methods, never a statement about whose method it is.
 *
 * That is the whole of {@link MfaVerificationService.verifyProof}'s method
 * lookup, and it is the one line in this file that a security review is for:
 * `{ id: methodId, userId }`. Resolved by `id` alone, a method
 * belonging to *anybody* would answer — so anybody who can enrol a factor of
 * their own, which is everybody with an account, could complete **any other
 * account's** second factor by presenting their own method and a code they can
 * compute at will. The challenge token is the only thing they would need from
 * the victim, and it is minted by submitting that victim's password, which is
 * exactly the situation a second factor exists to survive. Scoped by
 * `userId`, a method belonging to somebody else is indistinguishable from one
 * that never existed: `MfaMethodNotFoundError`, which core's own TSDoc says is
 * deliberately the answer to both.
 * `__tests__/discriminating/d10-mfa-challenge-only.spec.ts` holds the test
 * that fails when the scoping goes.
 *
 * ## Six error types here, one answer at the boundary
 *
 * Everything this class throws — the three challenge errors it propagates from
 * {@link MfaChallengeService.consume}, `MfaMethodNotFoundError`,
 * `MfaVerificationFailedError` and `RecoveryCodeAlreadyConsumedError` (a spent
 * recovery code, which a code nobody was issued is not) — is a distinct,
 * nameable fact, kept distinct
 * for the audit trail's sake and for a developer reading a log. Six *types*,
 * and more causes than that: `MfaMethodNotFoundError` answers a method that
 * does not exist, one belonging to somebody else and an id that is not a UUID,
 * and `MfaVerificationFailedError` answers a proof that does not verify, a kind
 * of factor this route does not complete and an account that may no longer
 * authenticate at all. The collapsing starts here and finishes at the
 * boundary. **None of that
 * distinction may reach a caller.** `AuthController.verifyMfa` catches all of
 * them and answers one 401 with one body, the same settled arrangement
 * `AuthController.login` applies to `AuthenticationOutcome.reason`. See that
 * method, and `MfaChallengeService`'s own TSDoc, for the argument.
 */
@Injectable()
export class MfaVerificationService {
  public constructor(
    @InjectRepository(MfaMethodRecord)
    private readonly methods: Repository<MfaMethodRecord>,
    private readonly challenges: MfaChallengeService,
    private readonly totp: TotpVerifier,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @InjectRepository(UserRecord)
    private readonly users: Repository<UserRecord>,
    private readonly recoveryCodes: RecoveryCodes,
  ) {}

  /**
   * Spends a login challenge, checks the proof offered for one of that
   * account's own confirmed methods, and opens a session.
   *
   * The order is fixed and each step guards the next: the challenge is
   * consumed first, under the write lock `MfaChallengeService` takes, so a
   * challenge cannot be presented twice while a slow verification is in
   * flight; the method is resolved *within* the account the challenge names;
   * the proof is checked; `totp_last_step` is advanced so the same code
   * cannot be replayed inside its own window; and only then is a session
   * begun.
   *
   * The returned {@link MfaLoginCompletion} names the account rather than
   * carrying it, so nothing here has to read a `UserRecord` the controller is
   * about to read anyway — and so that this service, which handles secret
   * material, never has a user entity to accidentally log.
   *
   * **The row `consume` returns still carries `tokenHash`.** `spendChallenge`
   * binds it and reads only `row.userId` from it; nothing logs it, and
   * nothing should.
   *
   * @param challengeToken - the challenge as its holder presents it
   * @param methodId - which of the account's methods the proof is for
   * @param code - the proof
   * @param client - what could be told about the caller, for the session and the record
   * @returns the credentials the session was opened with, and whose it is
   * @throws MfaChallengeNotFoundError | MfaChallengeExpiredError |
   *   MfaChallengeAlreadyConsumedError when the challenge does not stand — see
   *   {@link MfaChallengeService.consume} for which means what
   * @throws MfaMethodNotFoundError when no confirmed method of **that account**
   *   answers to `methodId` — which is also the answer for a method belonging
   *   to somebody else, and for an id that is not a UUID at all
   * @throws MfaVerificationFailedError when the proof does not verify, for a
   *   method whose kind this route does not complete, and when the account may
   *   no longer authenticate at all — collapsed onto one error because the
   *   caller is owed none of the distinction
   */
  public async completeLogin(
    challengeToken: string,
    methodId: string,
    code: string,
    client: ClientContext,
  ): Promise<MfaLoginCompletion> {
    const userId = (await this.spendChallenge(challengeToken, client)).userId as UserId;

    // The proof is checked by the same method every other caller of a proof
    // goes through — see `verifyProof`. What is written there is what makes a
    // sign-in and a removal agree about what a valid proof is.
    const how = await this.recordingFailure(userId, client, 'totp', () => this.verifyProof(
      userId,
      { methodId: methodId as MfaMethodId, code },
    ));

    return this.openSession(userId, client, new Date(), how);
  }

  /**
   * The same second phase, proven by a WebAuthn assertion that **this class
   * does not itself check**.
   *
   * ## Why the proof arrives as a function
   *
   * An assertion is judged by `@simplewebauthn/server` against a stored public
   * key and the ceremony nonce on the challenge row, and that judging lives in
   * `webauthn/WebAuthnCeremonies.ts` — the one file that may name that library.
   * Everything *around* it is this class's, and is the same for a passkey as
   * for a code: the challenge is spent first, under
   * `MfaChallengeService`'s write lock; the account is read off the consumed
   * row and never off the request; its standing is re-checked; and only then is
   * a session opened, by the one `openSession` every other completion here
   * uses.
   *
   * So the collaboration is inverted rather than split. `WebAuthnCeremonies`
   * does not consume the challenge, does not decide the account and does not
   * open a session; it supplies `proveAssertion`, which is handed the account
   * the row named and the nonce the row carried, and either returns the audit
   * metadata or throws.
   *
   * **That inversion is the security property, not a style.** The alternative
   * shape — a public method here taking a `userId` somebody else resolved —
   * would compile, and truthfully:
   * `SecondFactorSettled.becauseTheFactorWasJustProven` is available to it,
   * because an assertion really is a proof. What it would not do is spend the
   * challenge, re-check that the account may still authenticate, or write the
   * two audit entries, and none of those is a type's job. There is no such
   * method, and this one cannot be reached without spending a `LOGIN`
   * challenge.
   *
   * @param challengeToken - the challenge as its holder presents it
   * @param client - what could be told about the caller, for the session and the record
   * @param proveAssertion - judges the assertion for the account the challenge
   *   names, against the nonce the challenge carried, and returns the audit
   *   metadata naming what it accepted. It must throw to refuse; returning is
   *   taken as "this assertion held".
   * @returns the credentials the session was opened with, and whose it is
   * @throws MfaChallengeNotFoundError | MfaChallengeExpiredError |
   *   MfaChallengeAlreadyConsumedError when the challenge does not stand
   * @throws MfaVerificationFailedError when the account may no longer
   *   authenticate — and whatever `proveAssertion` throws, which
   *   `WebAuthnCeremonies` collapses onto the same error
   */
  public async completeLoginWithWebAuthn(
    challengeToken: string,
    client: ClientContext,
    proveAssertion: (
      userId: UserId,
      webauthnChallenge: string | null,
    ) => Promise<Record<string, unknown>>,
  ): Promise<MfaLoginCompletion> {
    const row = await this.spendChallenge(challengeToken, client);
    const userId = row.userId as UserId;

    // Throws to refuse; there is no path past this line with an assertion that
    // did not hold. The nonce comes off the consumed row, so it is the one this
    // server minted for this ceremony and not one the request chose.
    const how = await this.recordingFailure(
      userId,
      client,
      'webauthn',
      () => proveAssertion(userId, row.webauthnChallenge),
    );

    return this.openSession(userId, client, new Date(), how);
  }

  /**
   * The same second phase, proven by a recovery code instead of a method's
   * code.
   *
   * A separate method with a separate parameter, and that is the discriminator:
   * which kind of proof this is was decided by the field the caller populated
   * (the `recoveryCode` member of core's `MfaProof`, in `mfa/types`), and nothing here — or in
   * {@link MfaVerificationService.completeLogin} — looks at a string's length or
   * format to decide. A recovery code handed to `completeLogin` as `code` is a
   * TOTP code that does not verify; a TOTP code handed here is a recovery code
   * nothing matches.
   *
   * The challenge is spent first, as in `completeLogin`, so a wrong code costs
   * the challenge and the person signs in again — the same price a wrong TOTP
   * code has. The audit entry carries `proof: 'recovery_code'` and no method id,
   * so a sign-in through this path can be told apart from one through a method.
   *
   * @param challengeToken - the challenge as its holder presents it
   * @param recoveryCode - one of the account's own unused recovery codes
   * @param client - what could be told about the caller
   * @returns the credentials the session was opened with, and whose it is
   * @throws MfaChallengeNotFoundError | MfaChallengeExpiredError |
   *   MfaChallengeAlreadyConsumedError when the challenge does not stand
   * @throws RecoveryCodeAlreadyConsumedError when the code is this account's and
   *   has been used — kept distinct from the next for the audit trail's sake
   * @throws MfaVerificationFailedError when the account may no longer
   *   authenticate, and when no such code was issued to it (which is also the
   *   answer for another account's code)
   */
  public async completeLoginWithRecoveryCode(
    challengeToken: string,
    recoveryCode: string,
    client: ClientContext,
  ): Promise<MfaLoginCompletion> {
    const userId = (await this.spendChallenge(challengeToken, client)).userId as UserId;

    // Scoped by the account the challenge names, exactly as the method lookup
    // in `verifyProof` is: a code issued to somebody else must not answer. Both
    // refusals `RecoveryCodes.consume` can throw propagate: the distinction is
    // for the audit trail, and the route flattens it.
    const how = await this.recordingFailure(
      userId,
      client,
      'recovery_code',
      () => this.verifyProof(userId, { recoveryCode }),
    );

    return this.openSession(userId, client, new Date(), how);
  }

  /**
   * Checks one {@link MfaProof} against one account's own second factors. **The
   * only place a proof is judged**: `completeLogin` and
   * `completeLoginWithRecoveryCode` reach it, and so do `MfaService.removeMethod`
   * and `MfaService.regenerateRecoveryCodes`.
   *
   * That is the point of it being one method. Sign-in and removal each ask "is
   * this a live proof of a second factor this account holds?", and two
   * implementations of that question can drift until one accepts what the other
   * refuses — at which point the weaker one is the way in. A removal that
   * accepted a stale code, or a method that was never confirmed, would let a
   * hijacked session strip the factor that defeats it.
   *
   * Which kind of proof this is was decided by the field the caller populated —
   * `'methodId' in proof` — and nothing here looks at a string's length or
   * format.
   *
   * A method proof is scoped by `userId` in the query (`{ id: methodId, userId }`,
   * the line the class TSDoc is about), refused when the method is unconfirmed,
   * and checked against `totpLastStep`, which is advanced in the same call so the
   * same code cannot be presented twice inside its window.
   *
   * @param userId - whose second factors may answer; never read from a request
   * @param proof - what the caller offered
   * @returns the audit metadata naming which proof was accepted
   * @throws MfaMethodNotFoundError when no confirmed method of **that account**
   *   answers to the proof's `methodId` (also another account's, and a
   *   non-UUID)
   * @throws MfaVerificationFailedError when the code does not verify, for a kind
   *   of method this cannot prove, and for a recovery code no one was issued
   * @throws RecoveryCodeAlreadyConsumedError when the recovery code is the
   *   account's and has been spent
   */
  public async verifyProof(userId: UserId, proof: MfaProof): Promise<Record<string, unknown>> {
    if ('recoveryCode' in proof) {
      await this.recoveryCodes.consume(userId, proof.recoveryCode);
      // Written here rather than at either caller because this is the one place
      // a code is spent: a sign-in and a removal both reach it, and both use up
      // one of a finite set. No client context is in scope for a caller that is
      // not a sign-in, so none is recorded; the sign-in's own entries carry it.
      await this.audit.record({
        organizationId: null,
        actorId: userId,
        action: AuditAction.RECOVERY_CODE_CONSUMED,
        resourceType: 'user',
        resourceId: userId,
        metadata: {},
        clientAddress: null,
        clientLabel: null,
        occurredAt: new Date(),
      });
      return { proof: 'recovery_code' };
    }

    const { methodId, code } = proof;

    // **Checked before the lookup, not by the lookup.** `mfa_methods.id` is a
    // `uuid` column, so Postgres answers a malformed id with `22P02 invalid
    // input syntax for type uuid` rather than with no row — a `QueryFailedError`
    // that leaves this method as a thrown database error, is answered `500`,
    // and is therefore a sixth answer on a route whose whole design is that
    // every refusal is identical. Refusing on shape first keeps that collapse
    // whole without making it depend on a driver's error class, and it is why
    // `VerifyMfaDto` can go on validating `methodId` as a plain string: a
    // malformed id is refused here, with the same 401 as every other guess,
    // rather than by `@IsUUID` with a distinguishable 422.
    if (!isUUID(methodId)) throw new MfaMethodNotFoundError(methodId);

    // The predicate this whole file is about. See the class TSDoc.
    const method = await this.methods.findOne({ where: { id: methodId, userId } });
    if (method === null) throw new MfaMethodNotFoundError(methodId);

    // An unconfirmed method is no gate at all — `decideAuthenticationStep`'s
    // own TSDoc makes the argument, and it counts nothing else when deciding
    // that a second factor is owed. It must not be completable either, or an
    // abandoned enrollment would be a second way in that the policy never
    // counted as a gate.
    if (method.confirmedAt === null) throw new MfaMethodNotFoundError(methodId);

    const now = new Date();
    const step = this.proveTotp(method, code, now);

    // Written before the caller acts on the verdict, so a failure between the
    // two leaves a spent code rather than an action whose code is still good.
    await this.claimStep(method.id, step, now);

    return { methodId: method.id, methodType: method.type };
  }

  /**
   * Records that `step` has been used, or refuses because somebody else got
   * there first.
   *
   * ## Why this is a conditional write and not a plain one
   *
   * `proveTotp` compared the step to the `totpLastStep` it *read*, which stops a
   * replay that arrives after the first use finished. It does nothing about two
   * requests in flight together: both read the old step, both accept, both
   * write — one code, two proofs, and where a sign-in and a last-factor removal
   * ride together, a session opened alongside the removal it authorised. So the
   * write itself carries the condition,
   *
   * ```
   * UPDATE mfa_methods SET totp_last_step = :step
   *  WHERE id = :id AND (totp_last_step IS NULL OR totp_last_step < :step)
   * ```
   *
   * and its affected-row count decides, as `RecoveryCodes.consume` and
   * `MfaChallengeService` decide theirs. TypeORM's `update` takes no
   * disjunction, so it is two statements — `IS NULL`, then `< :step` — and they
   * cannot both succeed: whichever wins leaves the column at `step`, which
   * neither predicate matches. The loser throws the same
   * `MfaVerificationFailedError` a wrong code does, so it is not distinguishable
   * from one.
   *
   * `mfa-verification.service.spec.ts` races two presentations of one code in a
   * world that honours row locks and in one that ignores them. This path takes
   * no lock, so both worlds are decided by the predicate alone; that spec shows
   * the implementation asks for the conditional write and refuses on its count,
   * not that Postgres serialises two statements — which is the database's
   * guarantee and not something `FakeDataSource` can demonstrate.
   *
   * @throws MfaVerificationFailedError when the step was claimed by another
   *   presentation between the read and this write
   */
  private async claimStep(methodId: string, step: number, now: Date): Promise<void> {
    const patch = { totpLastStep: String(step), lastUsedAt: now };
    let claimed = await this.methods.update({ id: methodId, totpLastStep: IsNull() }, patch);
    if (claimed.affected !== 1) {
      claimed = await this.methods.update(
        { id: methodId, totpLastStep: LessThan(String(step)) },
        patch,
      );
    }
    if (claimed.affected !== 1) throw new MfaVerificationFailedError();
  }

  /**
   * The methods a login challenge may be finished with, **without spending it**.
   *
   * This closes a gap the two doors into a challenge otherwise leave open: a
   * password sign-in is answered with the methods inline, and a federated one
   * is redirected with a token and nothing else, because a redirect has no
   * body. A code is presented with the id of the method that produced it, so
   * without this read a person arriving by redirect has no id to send.
   *
   * **The same list the password response carries, scoped the same way.** The
   * account is the one the challenge row names — never anything the request
   * supplied — and only its confirmed methods are returned, for the reason
   * `AuthService.signIn` gives, in the same three fields
   * ({@link MfaChallengeMethodDto}) and nothing else.
   *
   * **It consumes nothing.** The challenge stays live for the verification that
   * follows; {@link MfaChallengeService.peek} makes no write and takes no lock.
   *
   * The account is re-checked with the predicate {@link MfaVerificationService.spendChallenge}
   * uses, so a suspended account is refused here as it will be there and this
   * endpoint is not a way to list the methods of an account that can no longer
   * sign in. Every refusal is the errors the caller's boundary flattens to one
   * `401`; nothing is recorded, because nothing was attempted.
   *
   * @throws the errors {@link MfaChallengeService.peek} names
   * @throws MfaVerificationFailedError when the account may no longer authenticate
   */
  public async methodsForChallenge(challengeToken: string): Promise<MfaChallengeMethodDto[]> {
    const row = await this.challenges.peek(challengeToken, MfaChallengePurpose.LOGIN);

    const account = await this.users.findOne({ where: { id: row.userId } });
    if (account === null || !toUserEntity(account).canAuthenticate()) {
      throw new MfaVerificationFailedError();
    }

    // Confirmed rows only, and in the query: see
    // `SecondFactorSettled.confirmedMethodsOf`, which carries both reasons. Not
    // that helper itself, because this query is not the policy's — it orders by
    // `createdAt` and answers "which methods may this challenge be met with?",
    // where the policy answers "is one owed at all?".
    const enrolled = await this.methods.find({
      where: { userId: row.userId, confirmedAt: Not(IsNull()) },
      order: { createdAt: 'ASC' },
    });
    return enrolled.map(mapMfaMethodRecord).map((method) => ({
      id: method.id,
      type: method.type,
      label: method.label,
    }));
  }

  /**
   * Consumes the login challenge and re-checks that its account may still
   * authenticate. Every proof this class offers reaches the challenge row
   * through here, so no proof can skip either step by being added later.
   *
   * @returns the consumed row — whose `userId` names the account, and whose
   *   `webauthnChallenge` carries the ceremony nonce for the one caller that
   *   needs it. Read off the row, never off the request.
   */
  private async spendChallenge(
    challengeToken: string,
    client: ClientContext,
  ): Promise<MfaChallengeRecord> {
    const row = await this.challenges.consume(challengeToken, MfaChallengePurpose.LOGIN);

    // `signIn` checked this before minting; it is checked again here because a
    // suspension, a lock or an unverification landing inside the challenge's
    // window would otherwise not be honoured. The window is narrow and the
    // first factor really did pass at mint time — but "suspend this account" is
    // a security control, and a control that takes minutes to bind is a control
    // with a bypass.
    //
    // The invariant this belongs to is not local to this method: **spending a
    // `LOGIN` challenge means re-reading the account and asking
    // `User.canAuthenticate` of it**, wherever that spending happens, and
    // `account_unavailable` is the reason written down when the answer is no.
    // `WebAuthnCeremonies.loginOptions` spends one outside this class and holds
    // to it too. A leg that consumed a row and skipped this would be the
    // lenient one, and a suspension binding everywhere but one endpoint is a
    // suspension with a bypass.
    const account = await this.users.findOne({ where: { id: row.userId } });
    if (account === null || !toUserEntity(account).canAuthenticate()) {
      // The challenge did stand, so an account is established here and the
      // refusal is recorded against it, with the reason the caller is not given.
      await this.recordFailure(row.userId as UserId, client, null, 'account_unavailable');
      throw new MfaVerificationFailedError();
    }
    return row;
  }

  /**
   * Opens the session and records the sign-in. `how` is the audit metadata that
   * says which proof was offered.
   *
   * **The one place a session is opened without asking ADR-0012's policy
   * whether a second factor is owed, because this path *is* the second factor.**
   * Asking here would be circular: `spendChallenge` has just consumed a
   * `LOGIN` challenge that only a settled policy call could have minted, and
   * one of this class's proofs has just held. That is what
   * `SecondFactorSettled.becauseTheFactorWasJustProven` asserts, and its TSDoc
   * carries the argument.
   *
   * Everything that finishes a challenge reaches session issuance through this
   * method — the WebAuthn assertion included, which is why WebAuthn login added
   * no caller of `sessions.begin` of its own. Keep it that way: a proof that
   * opened its own session would be a path around both the audit entries below
   * and the re-check in `spendChallenge`.
   */
  private async openSession(
    userId: UserId,
    client: ClientContext,
    now: Date,
    how: Record<string, unknown>,
  ): Promise<MfaLoginCompletion> {
    const credentials = await this.sessions.begin(
      userId,
      client,
      SecondFactorSettled.becauseTheFactorWasJustProven(),
    );
    await this.audit.record({
      organizationId: null,
      actorId: userId,
      action: AuditAction.LOGIN_SUCCEEDED,
      resourceType: 'user',
      resourceId: userId,
      metadata: { sessionId: credentials.session.id, ...how },
      clientAddress: client.address,
      clientLabel: client.label,
      occurredAt: now,
    });
    await this.audit.record({
      organizationId: null,
      actorId: userId,
      action: AuditAction.MFA_CHALLENGE_SUCCEEDED,
      resourceType: 'user',
      resourceId: userId,
      metadata: { sessionId: credentials.session.id, ...how },
      clientAddress: client.address,
      clientLabel: client.label,
      occurredAt: now,
    });

    return { credentials, userId };
  }

  /**
   * Runs one proof, and writes down why it did not hold before the refusal
   * travels on.
   *
   * Only the refusals this class names are recorded. Anything else (a database
   * error, a bug) is rethrown untouched: it is not a fact about the second
   * factor, and an entry saying it was would be a false one. The original error
   * is always the one rethrown, so the route's collapse onto a single answer
   * sees exactly what it saw before.
   */
  private async recordingFailure<T>(
    userId: UserId,
    client: ClientContext,
    proof: string,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const reason = MfaVerificationService.reasonFor(error);
      if (reason !== null) await this.recordFailure(userId, client, proof, reason);
      throw error;
    }
  }

  /**
   * One `MFA_CHALLENGE_FAILED` entry. The reason is recorded and never returned:
   * the route answers every refusal identically.
   */
  private async recordFailure(
    userId: UserId,
    client: ClientContext,
    proof: string | null,
    reason: string,
  ): Promise<void> {
    await this.audit.record({
      organizationId: null,
      actorId: userId,
      action: AuditAction.MFA_CHALLENGE_FAILED,
      resourceType: 'user',
      resourceId: userId,
      metadata: proof === null ? { reason } : { reason, proof },
      clientAddress: client.address,
      clientLabel: client.label,
      occurredAt: new Date(),
    });
  }

  /** Which recorded reason a refusal is, or `null` when it is not one of the refusals about the factor. */
  private static reasonFor(error: unknown): string | null {
    if (error instanceof MfaMethodNotFoundError) return 'method_not_found';
    if (error instanceof RecoveryCodeAlreadyConsumedError) return 'recovery_code_already_consumed';
    if (error instanceof MfaVerificationFailedError) return 'verification_failed';
    return null;
  }

  /**
   * Checks `code` against a method, dispatching on its kind.
   *
   * Explicit equality per modelled `MfaMethodType` member, ending in an
   * unconditional refusal — the shape `mapMfaMethodRecord` and
   * `MfaChallengeService.consumeRow` both use, for the reason
   * `MfaMethodRecord`'s own TSDoc gives: `type` is plain `text` with no
   * `CHECK`, so a value neither member names is reachable in principle and a
   * ternary reading "not TOTP, so it must be WebAuthn" would answer such a row
   * by running a ceremony nobody asked for.
   *
   * `WEBAUTHN` refuses here rather than falling through to the same place,
   * and the difference is not cosmetic: a WebAuthn method is proven by an
   * assertion against a stored public key, over the ceremony nonce the
   * challenge row carries — not by a code in a request body. There is no
   * reading of this method's arguments under which a WebAuthn factor is
   * proven, so the answer is a refusal. That ceremony now exists, and it does
   * not come through here: `POST /mfa/webauthn/verify` reaches
   * {@link MfaVerificationService.completeLoginWithWebAuthn}, which takes the
   * assertion's verdict from `webauthn/WebAuthnCeremonies.ts` and never a
   * `code`. This refusal is therefore permanent rather than provisional — a
   * `WEBAUTHN` method offered to `POST /auth/mfa/verify` is a proof nothing
   * there can judge.
   *
   * @param method - the row, already established to belong to the account and to be confirmed
   * @param code - the proof offered
   * @param now - the instant to judge the code at
   * @returns the time step the code was accepted for, to be persisted
   * @throws MfaVerificationFailedError when the code does not verify, when the
   *   row claims `TOTP` with no seed, and for every kind this route does not
   *   complete
   */
  private proveTotp(method: MfaMethodRecord, code: string, now: Date): number {
    if (method.type !== MfaMethodType.TOTP) throw new MfaVerificationFailedError();

    const seed = method.totpSecret;
    // `mapMfaMethodRecord` refuses this row on sight, and this path does not
    // go through it. A `TOTP` row with no seed is a login nothing can ever
    // complete; it is refused rather than handed to a verifier that would
    // throw somewhere less legible.
    if (seed === null) throw new MfaVerificationFailedError();

    // `bigint`, which the Postgres driver hands back as `string` — see the
    // column's own TSDoc. `null` means no code has ever been accepted.
    const lastStep = method.totpLastStep === null ? null : Number(method.totpLastStep);

    const result = this.totp.verify(seed, code, lastStep, now);
    if (!result.accepted) throw new MfaVerificationFailedError();
    return result.step;
  }
}
