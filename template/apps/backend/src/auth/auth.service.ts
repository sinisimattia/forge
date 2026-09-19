import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { IAuthService } from '__FORGE_SCOPE__/core/auth/contracts';
import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import { AuthenticationRejectionReason, AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import {
  ConsumedTokenError,
  ExpiredTokenError,
  InvalidCredentialsError,
} from '__FORGE_SCOPE__/core/auth/errors';
import type {
  AuthenticationAttempt,
  AuthenticationOutcome,
  ClientContext,
  RegisterInput,
  SessionId,
} from '__FORGE_SCOPE__/core/auth/types';
import type { IBreachedPasswordRegistry } from '__FORGE_SCOPE__/core/identities/contracts';
import { WeakPasswordError } from '__FORGE_SCOPE__/core/identities/errors';
import { DEFAULT_PASSWORD_POLICY, evaluatePassword } from '__FORGE_SCOPE__/core/identities/policies';
import { normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { UserNotFoundError } from '__FORGE_SCOPE__/core/users/errors';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditService } from '../audit/audit.service';
import { generateOpaqueToken, hashOpaqueToken } from '../common/crypto';
import { BREACHED_PASSWORD_REGISTRY } from '../identities/breached-passwords';
import { IdentitiesService } from '../identities/identities.service';
import {
  MAILER,
  buildAccountExistsMessage,
  buildResetPasswordMessage,
  buildVerifyEmailMessage,
  type IMailer,
} from '../mail';
import { toUserEntity } from '../users/to-user';
import { UserRecord } from '../users/user-record.entity';
import { EmailVerificationTokenRecord } from './entities/email-verification-token-record.entity';
import { PasswordResetTokenRecord } from './entities/password-reset-token-record.entity';
import { IssuedCredentials, SessionService } from './session/session.service';

/** How long a verification credential stands, in seconds. */
export const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;

/**
 * How long a recovery credential stands, in seconds.
 *
 * Much shorter than a verification credential, because it does much more: it
 * replaces the password on an account without proving anything else. It sits in
 * a mailbox for as long as it is valid, and a mailbox somebody else reaches is
 * the ordinary way accounts are taken.
 */
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

/**
 * An attempt's outcome together with the credentials it produced, if any.
 *
 * `AuthenticationOutcome` carries no credential of any kind, deliberately — see
 * its own comment. An implementation that also has to hand a caller something to
 * present later carries it beside that shape and takes it out before returning,
 * which is exactly what {@link AuthService.authenticate} does with this type.
 */
export interface SignInResult {
  /** What the domain is told. */
  outcome: AuthenticationOutcome;
  /** What the transport is given, present only when the attempt succeeded. */
  credentials: IssuedCredentials | null;
}

/**
 * {@link IAuthService} over this backend's tables.
 *
 * Three of its methods — registering, re-sending a verification, and asking for
 * a password reset — resolve identically whether or not the address is known.
 * That is one rule applied three times, and every one of them is written so the
 * *work done* is the same too, not just the answer: an endpoint that returns the
 * same body but returns it in a tenth of the time for an unknown address is the
 * same oracle, read off a stopwatch instead of a response.
 */
@Injectable()
export class AuthService implements IAuthService {
  private readonly webappUrl: string;

  public constructor(
    @InjectRepository(UserRecord)
    private readonly users: Repository<UserRecord>,
    @InjectRepository(EmailVerificationTokenRecord)
    private readonly verifications: Repository<EmailVerificationTokenRecord>,
    @InjectRepository(PasswordResetTokenRecord)
    private readonly resets: Repository<PasswordResetTokenRecord>,
    private readonly identities: IdentitiesService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
    @Inject(MAILER) private readonly mailer: IMailer,
    @Inject(BREACHED_PASSWORD_REGISTRY) private readonly breached: IBreachedPasswordRegistry,
    config: ConfigService,
  ) {
    // Read once, at construction, with no default. `getOrThrow` here means a
    // deployment that has not configured this origin fails to boot, loudly,
    // rather than booting and mailing its first person a link to nowhere — or,
    // worse, having somebody later "fix" the missing value by reconstructing it
    // from the incoming request, which is the reset-poisoning hazard
    // `mail/templates/reset-password.ts` describes at length.
    this.webappUrl = config.getOrThrow<string>('PUBLIC_WEBAPP_URL');
  }

  // ---------------------------------------------------------------- registration

  /**
   * Begins registration. Resolves whether or not the address is already in use.
   *
   * The order of the first two steps is not arbitrary. Both the policy judgement
   * and the breach check happen **before anything touches the database**, so a
   * refusal on either can be told apart from an acceptance by its content but
   * never by its timing. Moving either one after the lookup would make a weak
   * password rejected quickly for an unknown address and slowly for a known one.
   *
   * The policy judgement is allowed to be distinguishable *in content*, and that
   * is not an inconsistency: how long a secret must be is a published rule of
   * the deployment, so refusing a secret that breaks it reveals nothing about
   * any address.
   *
   * @param input - the address, display name and secret the person supplied
   * @throws WeakPasswordError when the secret does not meet the policy
   */
  public async register(input: RegisterInput): Promise<void> {
    const violations = evaluatePassword(input.secret, DEFAULT_PASSWORD_POLICY);
    if (violations.length > 0) throw new WeakPasswordError(violations);

    await this.refuseIfPublic(input.secret);

    const email = normalizeEmail(input.email);
    const now = new Date();

    const existing = await this.users.findOne({ where: { email } });
    if (existing !== null) {
      await this.mailer.send(buildAccountExistsMessage({ to: email, webappUrl: this.webappUrl }));
      // The action says what happened. It is not `EMAIL_VERIFICATION_REQUESTED`
      // — no verification was issued and none was sent — and it is not
      // `USER_REGISTERED`, because no account was created. See the member's own
      // comment in core: the caller is told nothing, so the entry is the only
      // place this event exists, and an entry that misnames it is worse than no
      // entry at all in a table nothing may correct.
      const owner = existing.id as UserId;
      await this.record(AuditAction.DUPLICATE_REGISTRATION_ATTEMPTED, owner, {}, now);
      return;
    }

    let created: { id: string } | null = null;
    try {
      created = await this.dataSource.transaction(async (manager) => {
        const inserted = await manager.insert(UserRecord, {
          email,
          displayName: input.displayName.trim(),
          status: UserStatus.ACTIVE,
          platformRole: PlatformRole.PLATFORM_USER,
          // Unverified. Registering claims an address; proving it is a separate
          // step, and until it happens `User.canAuthenticate()` is false.
          emailVerifiedAt: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        const id = inserted.identifiers[0].id as string;
        await this.identities.createPasswordIdentity(manager, id as UserId, email, input.secret);
        return { id };
      });
    } catch (error) {
      // Two registrations for one address, racing. The unique constraints on
      // `users.email` and on `(provider, provider_account_id)` decide it — a
      // check-then-insert would let both through — and the loser must answer
      // exactly as it would have if it had simply arrived second: silently, with
      // the message that goes to the address. Anything else turns a race into
      // the oracle the whole method is arranged to avoid.
      if (!AuthService.isUniqueViolation(error)) throw error;
      await this.mailer.send(buildAccountExistsMessage({ to: email, webappUrl: this.webappUrl }));
      // Audited like the non-racing branch. It answers the caller identically, so
      // if it recorded nothing a registration that lost a race would be the one
      // case invisible in the history — and a race is exactly the circumstance
      // somebody reads the history to understand. The actor is unknown here:
      // the winning insert is not necessarily ours to look up, and this branch
      // must not spend a query establishing whose it was.
      const lost = { lostRace: true };
      await this.record(AuditAction.DUPLICATE_REGISTRATION_ATTEMPTED, null, lost, now);
      return;
    }

    await this.sendVerification(created.id as UserId, email, now);
    await this.record(AuditAction.USER_REGISTERED, created.id as UserId, {}, now);
  }

  /**
   * Consumes a verification credential, proving the address it was sent to.
   *
   * Reading the credential, marking it consumed and marking the address proven
   * happen in **one transaction**, over a row read with a write lock. Two
   * simultaneous presentations of the same credential must not both succeed:
   * without the lock both read `consumed_at IS NULL`, both proceed, and the
   * single-use property is single-use only when nobody is trying.
   *
   * @param credential - the single-use value delivered to the address
   * @throws ConsumedTokenError when that credential has already been used
   * @throws ExpiredTokenError when its lifetime has run out — and when nothing
   *   answers to it at all, which is the same answer on purpose
   */
  public async verifyEmail(credential: string): Promise<void> {
    const presentedHash = hashOpaqueToken(credential);
    const now = new Date();

    const userId = await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(EmailVerificationTokenRecord, {
        where: { tokenHash: presentedHash },
        lock: { mode: 'pessimistic_write' },
      });

      if (row === null) throw new ExpiredTokenError();
      if (row.consumedAt !== null) throw new ConsumedTokenError();
      if (row.expiresAt.getTime() <= now.getTime()) throw new ExpiredTokenError();

      // The `affected` count is read, not discarded. The predicate is redundant
      // while the row lock above is held, and it is here for what happens if
      // that lock is ever removed: two presentations both read `consumed_at` as
      // null, this statement matches no row for the loser, and an implementation
      // that ignored the count would go on to mark the address proven and
      // report success — the single-use credential used twice. The same shape,
      // and the same blindness, as the double-spend measured against Postgres 16
      // in `session/refresh-token.service.ts`; both siblings now read the count.
      const consumed = await manager.update(
        EmailVerificationTokenRecord,
        { id: row.id, consumedAt: IsNull() },
        { consumedAt: now },
      );
      if (consumed.affected !== 1) throw new ConsumedTokenError();

      // `emailVerifiedAt: IsNull()` in the predicate so a second, later
      // verification cannot move the instant an address was first proven.
      await manager.update(
        UserRecord,
        { id: row.userId, emailVerifiedAt: IsNull() },
        { emailVerifiedAt: now, updatedAt: now },
      );
      return row.userId as UserId;
    });

    await this.record(AuditAction.EMAIL_VERIFIED, userId, {}, now);
  }

  /**
   * Re-issues verification. Resolves whether or not the address is known, for
   * the same reason {@link AuthService.register} does.
   *
   * @param email - the address to send to, as the person typed it
   */
  public async resendVerification(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    const now = new Date();
    const user = await this.users.findOne({ where: { email: normalized } });

    // An address with no account, an account whose address is already proven,
    // and an account its owner asked to be removed are all "nothing to send" —
    // and all three must look like a send.
    //
    // The deleted case was added with the soft delete it belongs to: a person
    // who closed their account and then asks for a link is asking a deployment
    // that no longer has them, and mailing them anyway is the deployment
    // ignoring the deletion in the one way they can see. It costs no extra work
    // and so shows up in no timing either — the row was already read.
    if (user === null || user.emailVerifiedAt !== null || user.deletedAt !== null) return;

    await this.sendVerification(user.id as UserId, normalized, now);
    await this.record(AuditAction.EMAIL_VERIFICATION_REQUESTED, user.id as UserId, {}, now);
  }

  // -------------------------------------------------------------- authentication

  /**
   * Attempts authentication, returning an outcome and never throwing for a
   * failed attempt.
   *
   * The credentials a success produces are dropped here: `AuthenticationOutcome`
   * carries none, by design. A caller that needs them — the controller — calls
   * {@link AuthService.signIn} instead. Both go through the same code, so the
   * contract this method is held to is a statement about the code the transport
   * actually runs.
   *
   * @param attempt - the address, the secret, and what could be told about the client
   * @returns who was proven and the session that now exists, or the reason it failed
   */
  public async authenticate(attempt: AuthenticationAttempt): Promise<AuthenticationOutcome> {
    return (await this.signIn(attempt)).outcome;
  }

  /**
   * The whole of an authentication attempt, credentials included.
   *
   * @param attempt - the address, the secret, and what could be told about the client
   * @returns the domain outcome, and the credentials when there are any
   */
  public async signIn(attempt: AuthenticationAttempt): Promise<SignInResult> {
    const now = new Date();
    const identity = await this.identities.findPasswordIdentity(attempt.email);

    if (identity === null) {
      // LOAD-BEARING. It looks like dead code — the result is discarded — and it
      // is the single line standing between this endpoint and an account
      // enumeration oracle.
      //
      // A password derivation is deliberately expensive: roughly 37 ms at this
      // deployment's parameters. Without this call an unknown address answers in
      // the time of one indexed lookup and a known one answers 37 ms later, so
      // anybody can sort the world's addresses into "has an account here" and
      // "does not" with a stopwatch, however identical the two response bodies
      // are. Returning the same body is not enough; the same *work* has to be
      // done.
      //
      // Deleting this makes no test about response bodies fail. It is asserted
      // in `__tests__/auth.service.spec.ts` by counting the derivations
      // performed, because the cost is the property and the cost is not visible
      // in any answer.
      await this.identities.spendVerificationOnNobody(attempt.secret);
      return this.reject(AuthenticationRejectionReason.UNKNOWN_ACCOUNT, null, attempt.client, now);
    }

    const proven = await this.identities.verifySecret(identity, attempt.secret);
    if (!proven) {
      return this.reject(
        AuthenticationRejectionReason.INVALID_SECRET,
        identity.userId as UserId,
        attempt.client,
        now,
      );
    }

    const row = await this.users.findOne({ where: { id: identity.userId } });
    if (row === null) {
      // An identity whose user is gone. The foreign key cascades, so this is not
      // reachable through this application; it is answered rather than thrown
      // because this method promises never to throw for a failed attempt.
      return this.reject(AuthenticationRejectionReason.UNKNOWN_ACCOUNT, null, attempt.client, now);
    }

    const user = AuthService.toUser(row);
    if (!user.canAuthenticate()) {
      // Checked AFTER the secret was verified, never before. An account that is
      // suspended or unverified must cost a wrong guess exactly what a good
      // account costs, or the response time tells a stranger that an address is
      // registered — which is the same oracle the dummy derivation above closes,
      // arriving from the other side.
      return this.reject(AuthService.rejectionFor(user), user.id, attempt.client, now);
    }

    // Spec §9.3's rehash-on-login. This is the only moment the password is both
    // in hand and known to be correct, so it is the only moment a derivation
    // produced under weaker parameters can be replaced. Remove this line and
    // every account that signed in before a parameter change keeps its old
    // derivation for ever, with nothing anywhere reporting it — which is why
    // `__tests__/auth.service.spec.ts` asserts the stored value actually changes
    // rather than that this method was called.
    await this.identities.rehashIfNeeded(identity, attempt.secret);
    await this.identities.markUsed(identity.id, now);

    const credentials = await this.sessions.begin(user.id, attempt.client);
    await this.record(
      AuditAction.LOGIN_SUCCEEDED,
      user.id,
      { sessionId: credentials.session.id },
      now,
      attempt.client,
    );

    return {
      outcome: { status: AuthenticationStatus.AUTHENTICATED, user, session: credentials.session },
      credentials,
    };
  }

  // ------------------------------------------------------------------- recovery
  //
  // ## NOT YET EXERCISED BY ANY TEST — treat everything below as unwritten
  //
  // `resendVerification` above, and `requestPasswordReset`, `resetPassword` and
  // `changePassword` below, exist because `IAuthService` is one interface and a
  // class cannot implement three ninths of it. They are complete
  // implementations, written against that interface's own documentation, and
  // **three of the four have no test at all** — only `resetPassword` is covered,
  // and only for its policy check, its single-use guarantee and its
  // session-ending. Nothing exercises `requestPasswordReset`'s silence for an
  // unknown address, `changePassword`'s proof of the current secret, or
  // `resendVerification` at all.
  //
  // That is more dangerous than a stub, which is why it is said here rather than
  // only in a plan: a stub announces that work remains, and a complete
  // untested implementation of security-critical code reads as done. Whoever
  // owns password recovery and identity management writes the tests before
  // trusting any of it, and should expect to find defects.

  /**
   * Begins password recovery. Resolves whether or not the address is known, for
   * the same reason {@link AuthService.register} does.
   *
   * @param email - the address to send to, as the person typed it
   */
  public async requestPasswordReset(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    const now = new Date();
    const user = await this.users.findOne({ where: { email: normalized } });
    // A deleted account is treated as no account, for the reason
    // {@link AuthService.resendVerification} gives — and with the same absence
    // of any extra work, so the two remain indistinguishable in timing as well
    // as in answer. Without it, closing an account leaves the deployment still
    // mailing its former owner every time somebody types their address in.
    if (user === null || user.deletedAt !== null) return;

    // An account with no password identity gets no recovery credential, because
    // there is no password to recover. A federated-only account is that case by
    // design, and issuing for one produced a credential whose redemption could
    // only ever be a lie: {@link AuthService.resetPassword} would consume it,
    // end every session, write PASSWORD_RESET_COMPLETED, store nothing, and
    // report success — into a table that physically refuses UPDATE and DELETE.
    //
    // Refusing here rather than detecting there is the cheaper half, and it is
    // free of every hazard the other half has: this method already answers a
    // known address and an unknown one identically, so a third "nothing to send"
    // reason joins two that exist, tells nobody anything, and needs no new error
    // and no contract change.
    if ((await this.identities.findPasswordIdentityByUser(user.id as UserId)) === null) return;

    const generated = generateOpaqueToken();
    await this.resets.insert({
      userId: user.id,
      tokenHash: generated.hash,
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_SECONDS * 1000),
      consumedAt: null,
      createdAt: now,
    });
    await this.mailer.send(
      buildResetPasswordMessage({
        to: normalized,
        token: generated.token,
        webappUrl: this.webappUrl,
      }),
    );
    await this.record(AuditAction.PASSWORD_RESET_REQUESTED, user.id as UserId, {}, now);
  }

  /**
   * Consumes a recovery credential and replaces the secret.
   *
   * Ends **every** session the user holds. Recovery is what somebody does when
   * they have lost control of the account, so leaving a session alive would
   * leave whoever took it exactly where they were.
   *
   * @param credential - the single-use value delivered to the address
   * @param newSecret - the replacement secret
   * @throws ConsumedTokenError when that credential has already been used
   * @throws ExpiredTokenError when its lifetime has run out, when nothing
   *   answers to it, and when the account it names has no password identity —
   *   all three are the same answer on purpose, and the third is unreachable
   *   unless an identity was unlinked between issue and redeem
   * @throws WeakPasswordError when the replacement does not meet the policy, or
   *   when the registry reports it as already public
   */
  public async resetPassword(credential: string, newSecret: string): Promise<void> {
    const violations = evaluatePassword(newSecret, DEFAULT_PASSWORD_POLICY);
    if (violations.length > 0) throw new WeakPasswordError(violations);
    await this.refuseIfPublic(newSecret);

    const presentedHash = hashOpaqueToken(credential);
    const now = new Date();

    const { userId, identityId } = await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(PasswordResetTokenRecord, {
        where: { tokenHash: presentedHash },
        lock: { mode: 'pessimistic_write' },
      });
      if (row === null) throw new ExpiredTokenError();
      if (row.consumedAt !== null) throw new ConsumedTokenError();
      if (row.expiresAt.getTime() <= now.getTime()) throw new ExpiredTokenError();

      // The identity is resolved BEFORE the credential is consumed, and the
      // order is the property. `requestPasswordReset` refuses to issue for an
      // account with no password identity, so reaching this line with none means
      // the identity was unlinked between issue and redeem — a real window, not
      // a theoretical one, once a person can unlink.
      //
      // Treated exactly as a credential nothing answers to: **consume nothing,
      // record nothing, and throw what an unknown credential throws.** The
      // implementation this replaces did the opposite — it consumed the
      // credential, ended every session, wrote PASSWORD_RESET_COMPLETED and
      // stored no password, reporting success for something that did not happen.
      // That entry is the part that cannot be undone: `audit_entries` refuses
      // UPDATE and DELETE to the role this process connects as, so a false entry
      // is permanent and the history is the one thing nobody can correct.
      //
      // Read through the transaction's own manager, so "there is an identity"
      // and "the credential is spent" are one atomic fact rather than two.
      const identity = await this.identities.findPasswordIdentityByUserIn(
        manager,
        row.userId as UserId,
      );
      if (identity === null) throw new ExpiredTokenError();

      // The `affected` count is read for the reason `verifyEmail` gives, and the
      // consequence here is larger: a recovery credential consumed twice is two
      // password replacements from one mail, the second of which the account's
      // owner did not ask for.
      const consumed = await manager.update(
        PasswordResetTokenRecord,
        { id: row.id, consumedAt: IsNull() },
        { consumedAt: now },
      );
      if (consumed.affected !== 1) throw new ConsumedTokenError();

      return { userId: row.userId as UserId, identityId: identity.id };
    });

    await this.identities.replaceSecret(identityId, newSecret);
    await this.sessions.revokeAll(userId);
    await this.record(AuditAction.PASSWORD_RESET_COMPLETED, userId, {}, now);
  }

  /**
   * Replaces the actor's own secret, proving the current one first.
   *
   * Ends every other session the user holds: the commonest reason to change a
   * secret is that somebody else may know it, and the change is worth little if
   * whoever knew it stays signed in. Which session is "the current one" is not
   * knowable here — this method is given an actor, not a request — so every
   * session goes, and the transport re-issues for the caller it is serving.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param currentSecret - the secret they hold now, as proof it is them
   * @param newSecret - the replacement secret
   * @throws InvalidCredentialsError when the current secret is not theirs
   * @throws WeakPasswordError when the replacement does not meet the policy
   */
  public async changePassword(
    actorId: UserId,
    currentSecret: string,
    newSecret: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.changePasswordIn(manager, actorId, currentSecret, newSecret);
    });
  }

  /**
   * Replaces the actor's secret **and** opens a fresh session for them, in one
   * transaction.
   *
   * Not on `IAuthService`, and it could not be: the contract is given an actor
   * and not a request, so it cannot know which session is the caller's and
   * cannot hand one back. The transport can, and this is where the two halves
   * meet.
   *
   * **Both or neither, and that is the whole reason this method exists.** The
   * controller used to call `changePassword` and then `SessionService.begin` as
   * two statements. Everything about that reads correctly and it has a window
   * two awaits wide in which the password has changed, every session is dead,
   * and the new one has not been written — leaving somebody signed out of the
   * account they just changed the password on, with the old password no longer
   * working. A review found the ordering of those two statements enforced by
   * nothing; this is the same pair of statements, made indivisible.
   *
   * The audit entry is inside the transaction too. An entry that survived a
   * rollback would be a permanent record of a change that did not happen, in a
   * table whose role has UPDATE and DELETE revoked — the defect `resetPassword`
   * shipped once.
   *
   * The cost is honest: the transaction is held open across a derivation, which
   * is tens of milliseconds. That is the price of not having the window.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param currentSecret - the secret they hold now, as proof it is them
   * @param newSecret - the replacement secret
   * @param client - what could be told about where the request came from
   * @returns the credentials for the caller's new session
   * @throws InvalidCredentialsError when the current secret is not theirs
   * @throws WeakPasswordError when the replacement does not meet the policy, or
   *   when the registry reports it as already public
   */
  public async changePasswordAndReissue(
    actorId: UserId,
    currentSecret: string,
    newSecret: string,
    client: ClientContext,
  ): Promise<IssuedCredentials> {
    return this.dataSource.transaction(async (manager) => {
      await this.changePasswordIn(manager, actorId, currentSecret, newSecret);
      // After, never before. Re-issuing first would have the new session revoked
      // along with the old ones, and a wrong current secret would leave a
      // session row behind for an attempt that failed.
      return this.sessions.beginIn(manager, actorId, client);
    });
  }

  /**
   * The whole of a password change, inside a transaction somebody else opened.
   *
   * Every judgement that can refuse comes first and touches nothing: the current
   * secret is proven, the policy is applied, the registry is asked. Only then
   * does anything get written, so a refusal has nothing to roll back and the
   * rollback path carries no weight it does not have to.
   */
  private async changePasswordIn(
    manager: EntityManager,
    actorId: UserId,
    currentSecret: string,
    newSecret: string,
  ): Promise<void> {
    const identity = await this.identities.findPasswordIdentityByUserIn(manager, actorId);
    if (identity === null) throw new InvalidCredentialsError();
    if (!(await this.identities.verifySecret(identity, currentSecret))) {
      throw new InvalidCredentialsError();
    }

    const violations = evaluatePassword(newSecret, DEFAULT_PASSWORD_POLICY);
    if (violations.length > 0) throw new WeakPasswordError(violations);
    await this.refuseIfPublic(newSecret);

    const now = new Date();
    await this.identities.replaceSecretIn(manager, identity.id, newSecret);
    await SessionService.revokeAllIn(manager, actorId);
    await this.audit.recordIn(manager, {
      organizationId: null,
      actorId,
      action: AuditAction.PASSWORD_CHANGED,
      resourceType: 'user',
      resourceId: actorId,
      metadata: {},
      clientAddress: null,
      clientLabel: null,
      occurredAt: now,
    });
  }

  // ------------------------------------------------------------------- sessions

  /**
   * The actor's own usable sessions, newest first. There is no path to another
   * user's.
   *
   * @param actorId - the user on whose behalf the call is made
   * @returns every usable session the actor holds, newest first
   */
  public listSessions(actorId: UserId): Promise<Session[]> {
    return this.sessions.listActive(actorId);
  }

  /**
   * Ends one of the actor's own sessions.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param sessionId - the session to end
   * @throws SessionNotFoundError when it is not theirs — indistinguishable from
   *   not existing, so the call cannot be used to probe other people's ids
   */
  public async revokeSession(actorId: UserId, sessionId: SessionId): Promise<void> {
    await this.sessions.revoke(actorId, sessionId);
    await this.record(AuditAction.SESSION_REVOKED, actorId, { sessionId }, new Date());
  }

  /**
   * Ends every session the actor holds, including the one they are using.
   *
   * @param actorId - the user on whose behalf the call is made
   */
  public async revokeAllSessions(actorId: UserId): Promise<void> {
    const ended = await this.sessions.revokeAll(actorId);
    await this.record(AuditAction.ALL_SESSIONS_REVOKED, actorId, { ended }, new Date());
  }

  /**
   * Ends the session a request was made through, and records it as a sign-out
   * rather than as a revocation.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param sessionId - the session the request came in on
   */
  public async logout(actorId: UserId, sessionId: SessionId): Promise<void> {
    await this.sessions.revoke(actorId, sessionId);
    await this.record(AuditAction.LOGGED_OUT, actorId, { sessionId }, new Date());
  }

  /**
   * The user behind an id, as a domain entity.
   *
   * Used by the renewal endpoint, which has a session and needs the person it
   * belongs to. It is a read the request path pays for deliberately — the access
   * credential carries two claims and nothing else, so anything about the person
   * is looked up rather than copied into a credential that would then go stale.
   *
   * @param userId - the account to load
   * @returns the user
   * @throws UserNotFoundError when no row answers to the id
   */
  public async userOf(userId: UserId): Promise<User> {
    const row = await this.users.findOne({ where: { id: userId } });
    if (row === null) throw new UserNotFoundError(userId);
    return AuthService.toUser(row);
  }

  // -------------------------------------------------------------------- private

  /**
   * Refuses a secret the registry reports as already public.
   *
   * **Called on every path that sets a password — registration, recovery and a
   * deliberate change — and the uniformity is the point.** It was called on
   * registration alone, which made the control decorative exactly where it
   * matters most: the likeliest reason somebody is completing a recovery is that
   * they believe their credential is already in somebody else's hands, and that
   * is the worst moment to accept a password out of a published corpus. A
   * guarantee that holds on one path and not its sibling is the shape of defect
   * this project has shipped before.
   *
   * Always **after** `evaluatePassword` and never before. Two reasons, and both
   * are load-bearing. The policy judgement is free and local, so a secret that
   * breaks it is refused without a lookup that may be slow or remote. And the
   * order is what keeps `violations` legible: reaching this method at all means
   * the other four judgements passed, so `BREACHED` is never mixed with them and
   * the message a person is shown is about the one thing that is wrong.
   *
   * @param secret - the password a person proposes
   * @throws WeakPasswordError carrying `BREACHED` when the registry says so
   */
  private async refuseIfPublic(secret: string): Promise<void> {
    // The template's own registry answers `false` to everything (ADR-0008), so
    // this branch is unreachable until somebody binds a real corpus. Written out
    // rather than left as a TODO because the person who binds that corpus should
    // not also have to invent the refusal — and because a seam whose far side
    // has never been exercised is a seam that does not work.
    if (await this.breached.isKnownBreached(secret)) {
      throw new WeakPasswordError(['BREACHED']);
    }
  }

  /** Issues a verification credential and sends it. */
  private async sendVerification(userId: UserId, email: string, now: Date): Promise<void> {
    const generated = generateOpaqueToken();
    await this.verifications.insert({
      userId,
      tokenHash: generated.hash,
      expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_SECONDS * 1000),
      consumedAt: null,
      createdAt: now,
    });
    await this.mailer.send(
      buildVerifyEmailMessage({ to: email, token: generated.token, webappUrl: this.webappUrl }),
    );
  }

  /**
   * Records the failure and shapes the rejection, in one place.
   *
   * The reason is written to the audit log and returned inside
   * `AuthenticationOutcome`, where the transport drops it: every rejection
   * leaves this service the same shape, so no caller can accidentally render a
   * difference the person attempting is not meant to see.
   */
  private async reject(
    reason: AuthenticationRejectionReason,
    actorId: UserId | null,
    client: ClientContext,
    now: Date,
  ): Promise<SignInResult> {
    await this.record(AuditAction.LOGIN_FAILED, actorId, { reason }, now, client);
    return {
      outcome: { status: AuthenticationStatus.REJECTED, reason },
      credentials: null,
    };
  }

  /** One audit write, with this phase's fixed `organizationId` of `null`. */
  private record(
    action: AuditAction,
    actorId: UserId | null,
    metadata: Record<string, unknown>,
    occurredAt: Date,
    client: ClientContext = { address: null, label: null },
  ): Promise<void> {
    return this.audit.record({
      organizationId: null,
      actorId,
      action,
      resourceType: 'user',
      resourceId: actorId,
      metadata,
      clientAddress: client.address,
      clientLabel: client.label,
      occurredAt,
    });
  }

  /**
   * Which rejection a user's own state produces.
   *
   * The order is core's, stated on `AuthenticationRejectionReason` and part of
   * its contract rather than a detail of this implementation: most permanent
   * first, so the recorded reason is the one that would still be true after the
   * others were fixed. Recording `EMAIL_NOT_VERIFIED` against a suspended
   * account tells whoever reads that entry later to verify the address and get
   * in, which is false, and they act on it.
   */
  private static rejectionFor(user: User): AuthenticationRejectionReason {
    if (user.isDeleted) return AuthenticationRejectionReason.ACCOUNT_DELETED;
    if (user.status === UserStatus.SUSPENDED) {
      return AuthenticationRejectionReason.ACCOUNT_SUSPENDED;
    }
    return AuthenticationRejectionReason.EMAIL_NOT_VERIFIED;
  }

  /**
   * Row to entity.
   *
   * Delegates to `users/to-user.ts` rather than restating the mapping: three
   * services read this table now, and a mapper copied into each of them is three
   * chances for the copies to disagree about what a row means. Kept as a static
   * here because it is part of this class's surface and callers name it.
   */
  public static toUser(row: UserRecord): User {
    return toUserEntity(row);
  }

  /**
   * Whether a driver error is a unique-constraint violation.
   *
   * Matched on Postgres's SQLSTATE `23505` rather than on the message, which is
   * localized by the server's own settings and has changed wording between major
   * versions. A match on the message would stop matching after an upgrade, and
   * the failure mode is that a registration race starts surfacing as a 500 —
   * which is also, unhelpfully, an oracle.
   */
  private static isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object'
      && error !== null
      && (error as { code?: unknown }).code === '23505'
    );
  }
}
