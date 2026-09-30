import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import {
  MfaLabelRequiredError,
  MfaVerificationFailedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import type { MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import { UserNotFoundError } from '__FORGE_SCOPE__/core/users/errors';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditService } from '../../audit/audit.service';
import { recordUserAudit } from '../../auth/record-user-audit';
import { toUserEntity } from '../../users/to-user';
import { UserRecord } from '../../users/user-record.entity';
import { MfaMethodRecord } from '../entities/mfa-method-record.entity';
import { MfaChallengePurpose } from '../enums/MfaChallengePurpose';
import { mapMfaMethodRecord } from '../mapMfaMethodRecord';
import { MfaChallengeService } from '../mfa-challenge.service';
import type { MfaLoginCompletion } from '../mfa-verification.service';
import { MfaVerificationService } from '../mfa-verification.service';
import { RecoveryCodes } from '../recovery/recovery-codes';
import { WEBAUTHN_CONFIG, type WebAuthnConfig } from './webauthn.config';

/**
 * Which ceremony a request is running.
 *
 * Never parsed from a request and never read off a stored row: it is derived
 * from **which credential the request carried**, by {@link webAuthnCallerOf},
 * before anything else happens. See that function and this file's class TSDoc.
 */
export enum WebAuthnCeremonyPurpose {
  /** Adding a passkey to an account whose session is already proven. */
  ENROLLMENT = 'ENROLLMENT',
  /** Finishing a sign-in the password step left half-done. */
  LOGIN = 'LOGIN',
}

/**
 * A caller, with the purpose already fixed and the identity it is allowed to
 * act for carried alongside it.
 *
 * The two members carry **different identity material on purpose**: an
 * enrollment knows the account outright, because a session proved it; a login
 * knows only a challenge token, and the account it names is read off the row
 * when that token is spent. There is no member holding both, so there is no
 * value in this type from which a login could be given an account somebody
 * supplied.
 */
export type WebAuthnCaller
  = | { readonly purpose: WebAuthnCeremonyPurpose.ENROLLMENT; readonly userId: UserId }
    | { readonly purpose: WebAuthnCeremonyPurpose.LOGIN; readonly challengeToken: string };

/** What the transport observed about the credentials on one request. */
export interface PresentedCredentials {
  /**
   * Whether the request carried a session credential **at all** — the presence
   * of the `Authorization` header, not the verdict on it.
   *
   * Presence rather than validity, so that "this request carried both" is a
   * fact about the request and not about whether a guard happened to accept
   * one of them. A header that is present and bad is refused by the guard
   * before this is ever built.
   */
  readonly sessionPresented: boolean;
  /** The account that credential proved, when it proved one. */
  readonly actorId: UserId | undefined;
  /** The challenge token in the body, when there was one. */
  readonly challengeToken: string | undefined;
}

/** What `POST /mfa/webauthn/options` answers with. */
export interface WebAuthnOptionsResult {
  /** The ceremony options, to be handed to `navigator.credentials`. */
  readonly publicKey:
    | PublicKeyCredentialCreationOptionsJSON
    | PublicKeyCredentialRequestOptionsJSON;
  /**
   * The challenge token to present to `POST /mfa/webauthn/verify`, for a
   * login — and **`null` for an enrollment**, which carries a session instead
   * and would be refused for carrying both. See
   * `MfaChallengeService.consumePendingFor`.
   */
  readonly challengeToken: string | null;
}

/** What `POST /mfa/webauthn/verify` established for an enrollment. */
export interface WebAuthnEnrolled {
  readonly purpose: WebAuthnCeremonyPurpose.ENROLLMENT;
  /** The method now on the account, confirmed. */
  readonly method: MfaMethodJSON;
  /** The account's first batch of recovery codes, or `null` when it already had some. */
  readonly recoveryCodes: readonly string[] | null;
}

/** What `POST /mfa/webauthn/verify` established for a login. */
export interface WebAuthnSignedIn {
  readonly purpose: WebAuthnCeremonyPurpose.LOGIN;
  /** The session that finished the sign-in, and whose it is. */
  readonly completion: MfaLoginCompletion;
}

/**
 * What `POST /mfa/webauthn/verify` established, tagged with which ceremony it
 * was — so that a caller reading the result dispatches on a value this server
 * produced rather than re-deriving which branch ran.
 */
export type WebAuthnVerification = WebAuthnEnrolled | WebAuthnSignedIn;

/**
 * The message a request carrying two credentials is refused with. Exported so
 * the spec asserting the refusal names the same string this throws.
 */
export const BOTH_CREDENTIALS_REFUSED
  = 'A WebAuthn ceremony is either an enrollment, proven by a session, or a login, proven by a '
    + 'challenge token. A request carrying both is refused rather than resolved in favour of '
    + 'either.';

/** The message a request carrying no credential at all is refused with. */
export const NO_CREDENTIAL_REFUSED
  = 'A WebAuthn ceremony needs either a session (an enrollment) or a challenge token (a login).';

/**
 * Fixes the ceremony by the credential the request carried, and by nothing
 * else.
 *
 * ## The rule, and the defect it exists because of
 *
 * These two endpoints each serve two purposes, which is the shape that
 * produced this backend's worst authentication defect: a single endpoint
 * dispatching on a *stored* value with a ternary, where everything that was
 * not the one tested-for value fell through to the sign-in branch and minted
 * a real, usable session. `MfaChallengePurpose`'s own TSDoc tells that story.
 *
 * The lesson taken here is stronger than "do not use a ternary". It is that
 * **nothing the caller can write may select the more powerful branch**. A
 * session is something a caller cannot forge; a challenge token is something
 * this server minted after a password verified. Those two, and only those two,
 * decide. A `purpose` field in a body would be the defect back in its original
 * form, only easier to reach.
 *
 * ## Both, and neither
 *
 * A request carrying both is **refused**, not resolved. Resolving it either
 * way would be a rule about precedence, and a rule about precedence is a thing
 * an attacker reads in order to choose which credential to add. Refusing costs
 * a legitimate caller nothing: no client this server defines ever has both to
 * send, because an enrollment's challenge token is never handed out (see
 * {@link WebAuthnOptionsResult.challengeToken}).
 *
 * A request carrying neither is refused for the ordinary reason.
 *
 * @param presented - what the transport observed, never what the body claimed
 * @returns the ceremony, with the identity it may act for
 * @throws BadRequestException when both credentials were presented, and when
 *   neither was
 * @throws UnauthorizedException when a session was presented and no actor came
 *   of it — unreachable behind `OptionalJwtAuthGuard`, and refused here so
 *   that it stays unreachable rather than becoming an enrollment for nobody
 */
export function webAuthnCallerOf(presented: PresentedCredentials): WebAuthnCaller {
  const { sessionPresented, actorId, challengeToken } = presented;

  // First, and unconditional. Everything below may assume exactly one.
  if (sessionPresented && challengeToken !== undefined) {
    throw new BadRequestException(BOTH_CREDENTIALS_REFUSED);
  }

  if (sessionPresented) {
    if (actorId === undefined) throw new UnauthorizedException();
    return { purpose: WebAuthnCeremonyPurpose.ENROLLMENT, userId: actorId };
  }

  if (challengeToken !== undefined) {
    return { purpose: WebAuthnCeremonyPurpose.LOGIN, challengeToken };
  }

  throw new BadRequestException(NO_CREDENTIAL_REFUSED);
}

/**
 * Registering a passkey, and signing in with one.
 *
 * ## What this template owns, and what it does not
 *
 * **The attestation and the assertion are verified by `@simplewebauthn/server`,
 * not here.** Nothing in this file checks a signature, parses CBOR or decides
 * whether an authenticator is genuine; `verifyRegistrationResponse` and
 * `verifyAuthenticationResponse` do all of it, and the browser half of a
 * ceremony — `navigator.credentials.create` and `.get` — is not reachable from
 * a test at all. A suite here that appeared to prove "a forged assertion is
 * rejected" would be proving it about a mock of that library.
 *
 * What this template does own, and what `__tests__/webauthn.spec.ts` covers,
 * is the three properties around the ceremony:
 *
 * 1. **The challenge is single-use.** Every leg of both ceremonies spends a
 *    `mfa_challenges` row through `MfaChallengeService`, under the same
 *    pessimistic write lock, and a spent row is never presentable again.
 * 2. **The purpose is fixed by the credential the request carried.** See
 *    {@link webAuthnCallerOf}, which is where that decision is made and the
 *    only place it is made.
 * 3. **A credential is registered once across the deployment.**
 *    `uq_mfa_methods_webauthn_credential` is the real check; this file refuses
 *    ahead of it so the answer is a `409` rather than a driver error.
 *
 * ## WebAuthn absent is not WebAuthn degraded
 *
 * `WEBAUTHN_CONFIG` is `null` when this deployment has no WebAuthn — see
 * `webauthn.config.ts`, which refuses to boot a *half*-configured one, so
 * `null` can only mean "switched off". Every route here answers a `404` in
 * that case, which is what an endpoint for a feature this deployment does not
 * have should say. It is never a ceremony run against defaults: a relying-party
 * ID guessed from a request would be a credential scoped to whatever host the
 * request claimed.
 *
 * ## The method row is written at verification, never before it
 *
 * TOTP enrollment writes an unconfirmed row and confirms it later. A WebAuthn
 * method cannot: `mapMfaMethodRecord` refuses a `WEBAUTHN` row missing its
 * credential id or public key, and those two values do not exist until the
 * attestation has been verified. An unconfirmed placeholder would therefore be
 * a row that makes `MfaService.listMethods` throw. The row is inserted once,
 * already confirmed, in {@link WebAuthnCeremonies.completeEnrollment}.
 */
@Injectable()
export class WebAuthnCeremonies {
  public constructor(
    @InjectRepository(MfaMethodRecord)
    private readonly methods: Repository<MfaMethodRecord>,
    @InjectRepository(UserRecord)
    private readonly users: Repository<UserRecord>,
    private readonly challenges: MfaChallengeService,
    private readonly verification: MfaVerificationService,
    private readonly recoveryCodes: RecoveryCodes,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @Inject(WEBAUTHN_CONFIG)
    private readonly config: WebAuthnConfig | null,
  ) {}

  /**
   * Offers the options for whichever ceremony the caller's credential fixed.
   *
   * Explicit equality per modelled {@link WebAuthnCeremonyPurpose} member,
   * ending in an unconditional refusal — the shape `mapMfaMethodRecord` and
   * `MfaChallengeService.consumeRow` both use. Never a ternary: a `caller`
   * that is neither member is not "the other one", and the arm a ternary's
   * "not A" branch lands on here is the one that spends a login challenge.
   *
   * @param caller - the ceremony {@link webAuthnCallerOf} fixed
   * @param client - what could be told about the caller, for the record. Read
   *   on the login arm, which is the arm that spends a challenge and so is the
   *   arm with an account to record an ending against.
   * @returns the options, and a login's next challenge token
   * @throws NotFoundException when this deployment has no WebAuthn
   * @throws BadRequestException for a caller naming no modelled purpose
   */
  public async options(
    caller: WebAuthnCaller,
    client: ClientContext,
  ): Promise<WebAuthnOptionsResult> {
    if (caller.purpose === WebAuthnCeremonyPurpose.ENROLLMENT) {
      return this.enrollmentOptions(caller.userId);
    }
    if (caller.purpose === WebAuthnCeremonyPurpose.LOGIN) {
      return this.loginOptions(caller.challengeToken, client);
    }
    throw new BadRequestException(NO_CREDENTIAL_REFUSED);
  }

  /**
   * Finishes whichever ceremony the caller's credential fixed.
   *
   * The same dispatch as {@link WebAuthnCeremonies.options}, for the same
   * reason, and it matters more here: the login arm ends in a session.
   *
   * `response` arrives as a plain object and is **cast, not validated**, on
   * whichever arm the credential fixed. Its shape is `@simplewebauthn/server`'s
   * to check — `verifyRegistrationResponse` and `verifyAuthenticationResponse`
   * refuse anything malformed, and {@link WebAuthnCeremonies.refusing} turns
   * that into the one refusal this route gives. A second, partial description
   * of those types in this application would be one that drifts from the
   * library's and starts refusing what the library accepts. **The cast decides
   * nothing about which ceremony runs**: that was fixed above it, and casting
   * to the wrong one produces a refusal, not a different code path.
   *
   * @param caller - the ceremony {@link webAuthnCallerOf} fixed
   * @param response - what the authenticator produced, as the browser serialises it
   * @param label - what the person calls this passkey; read only on the enrollment arm
   * @param client - what could be told about the caller, for the session and the record
   * @returns the method that was registered, or the session that was opened
   * @throws NotFoundException when this deployment has no WebAuthn
   * @throws BadRequestException for a caller naming no modelled purpose
   */
  public async verify(
    caller: WebAuthnCaller,
    response: Record<string, unknown>,
    label: string | undefined,
    client: ClientContext,
  ): Promise<WebAuthnVerification> {
    if (caller.purpose === WebAuthnCeremonyPurpose.ENROLLMENT) {
      return this.completeEnrollment(
        caller.userId,
        response as unknown as RegistrationResponseJSON,
        label,
      );
    }
    if (caller.purpose === WebAuthnCeremonyPurpose.LOGIN) {
      return this.completeLogin(
        caller.challengeToken,
        response as unknown as AuthenticationResponseJSON,
        client,
      );
    }
    throw new BadRequestException(NO_CREDENTIAL_REFUSED);
  }

  /**
   * The configuration, or a refusal.
   *
   * One place, called first by all four ceremony halves, so "WebAuthn is
   * absent" cannot be a check three of them make.
   *
   * @throws NotFoundException when this deployment has no WebAuthn
   */
  private configured(): WebAuthnConfig {
    if (this.config === null) {
      throw new NotFoundException('This deployment does not offer WebAuthn.');
    }
    return this.config;
  }

  /**
   * Registration options for the account the session proved, and a
   * `WEBAUTHN_ENROLLMENT` challenge to hold the nonce.
   *
   * The token that challenge mints is **deliberately discarded**. The request
   * that completes this ceremony arrives with the same session and no token,
   * because a request carrying both is refused; handing the token out would
   * create a credential with nowhere to be presented and one more thing to
   * leak. `MfaChallengeService.consumePendingFor` finds the row instead.
   *
   * `excludeCredentials` carries the account's existing passkeys so the
   * browser can tell the person their key is already enrolled, rather than
   * letting them complete a ceremony this server then refuses. It is a
   * courtesy and not the check — the check is
   * `uq_mfa_methods_webauthn_credential`, and it covers the whole deployment,
   * which this list cannot.
   *
   * @throws UserNotFoundError when the session names an account with no row
   */
  private async enrollmentOptions(userId: UserId): Promise<WebAuthnOptionsResult> {
    const config = this.configured();

    const account = await this.users.findOne({ where: { id: userId } });
    if (account === null) throw new UserNotFoundError(userId);

    const enrolled = await this.methods.find({
      where: { userId, type: MfaMethodType.WEBAUTHN },
    });

    const publicKey = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      // The account's own id as the user handle. It is an opaque UUID rather
      // than the address, because the handle is stored on the authenticator and
      // may be shown by it, and a device that can be handed to somebody should
      // not be carrying the person's email.
      userID: new TextEncoder().encode(userId),
      userName: account.email,
      userDisplayName: account.displayName,
      excludeCredentials: WebAuthnCeremonies.credentialIdsOf(enrolled),
      // A second factor is a *possession* check; the password was the knowledge
      // half. `preferred` takes user verification where the authenticator
      // offers it for free and does not demand a PIN from a key that has none.
      // `verifyRegistrationResponse` below is told the same thing, so the two
      // cannot disagree about what was required.
      authenticatorSelection: { residentKey: 'discouraged', userVerification: 'preferred' },
    });

    await this.challenges.mint(
      userId,
      MfaChallengePurpose.WEBAUTHN_ENROLLMENT,
      publicKey.challenge,
    );

    return { publicKey, challengeToken: null };
  }

  /**
   * Authentication options for the account the presented challenge names, and
   * a fresh challenge carrying this ceremony's nonce.
   *
   * ## Spent, then re-minted, rather than updated in place
   *
   * The challenge `POST /auth/login` handed out is **consumed here**, and a
   * new one is minted to carry the nonce into the verification. Each is
   * single-use and each is spent under the write lock, so asking for options
   * twice with one token gets one answer and one refusal. Updating the
   * original row's `webauthn_challenge` instead would leave the same token
   * live across both legs, which is a token that can be replayed against a
   * nonce it did not start with.
   *
   * The cost is the ordinary one this file's siblings already pay: a ceremony
   * abandoned after the options were fetched costs the login, and the person
   * signs in again. `MfaVerificationService.completeLoginWithRecoveryCode` says
   * the same about a wrong code.
   *
   * ## The TTL rolls here, and other comments assume it does not
   *
   * **`mint` gives the new row a full `MFA_CHALLENGE_TTL_MS`, measured from
   * now, not the remainder of the one it replaced.** So whoever holds a login
   * challenge can call this endpoint every few minutes and keep a half-finished
   * sign-in alive indefinitely. `MfaChallengeService`'s own TSDoc argues its
   * window is "the window in which an intercepted or phished second factor is
   * still worth something", and `MfaChallengeRecord.webauthnChallenge` leans on
   * the same bound; **neither holds on this path**, and this paragraph exists
   * so that nobody reads those two and believes it does.
   *
   * It is left as it is, deliberately. Rolling grants nothing on its own: each
   * row is still single-use, still `LOGIN`-only, and completing any of them
   * still needs an assertion signed by a private key the authenticator never
   * releases. What a stolen token buys by being kept alive is the same nothing
   * it bought at minute one. A deployment that wants the bound back would carry
   * the original `expiresAt` forward rather than minting a fresh window — which
   * is a change to {@link MfaChallengeService.mint}'s signature, and so not one
   * to make silently here.
   *
   * ## Spending a login challenge means re-checking the account
   *
   * The invariant `MfaVerificationService.spendChallenge` carries holds here
   * too, and for the same reason: a suspension, a lock or an unverification
   * landing inside the challenge's window binds on every leg that spends one of
   * these rows, not only on the leg that finishes the sign-in. Otherwise this
   * endpoint hands out an account's passkey credential ids and mints it a fresh
   * window while a security control is already meant to have taken effect. Same
   * predicate — `User.canAuthenticate`, on a freshly read row — same
   * `account_unavailable` reason written down, same refusal the caller is given
   * for every other cause.
   *
   * ## Every ending is written down
   *
   * Consuming the row establishes an account, so every ending after that line
   * is a fact about one and is recorded as such. A refusal is one
   * `MFA_CHALLENGE_FAILED` carrying the reason {@link MfaVerificationService}
   * records for the same cause, and the re-mint is one `MFA_CHALLENGE_ISSUED` —
   * the action whose own TSDoc says a challenge was handed out and nobody
   * proved anything, which is what happened here. Each carries
   * `proof: 'webauthn'`, so a reader can tell this leg from the password leg
   * that minted the challenge it spent.
   *
   * Without them this leg was silent whatever it did: a challenge spent and a
   * refusal, or a challenge spent and a fresh one minted, leaving behind only
   * the issuance that preceded it.
   *
   * A challenge refused before an account can be named writes nothing:
   * {@link MfaChallengeService.consume} throws before `userId` is read, and an
   * entry naming a guessed account would be false in a table nothing may
   * correct — the rule `AuditAction.MFA_CHALLENGE_FAILED`'s own TSDoc states.
   *
   * @throws MfaVerificationFailedError when the account may no longer
   *   authenticate, and when it holds no confirmed passkey — an empty
   *   `allowCredentials` would tell the browser "any credential will do", which
   *   for a second factor is exactly wrong. One error for both, because the
   *   route answers every refusal on it identically.
   */
  private async loginOptions(
    challengeToken: string,
    client: ClientContext,
  ): Promise<WebAuthnOptionsResult> {
    const config = this.configured();

    const row = await this.challenges.consume(challengeToken, MfaChallengePurpose.LOGIN);
    const userId = row.userId as UserId;

    const account = await this.users.findOne({ where: { id: userId } });
    if (account === null || !toUserEntity(account).canAuthenticate()) {
      await recordUserAudit(
        this.audit,
        AuditAction.MFA_CHALLENGE_FAILED,
        userId,
        { reason: 'account_unavailable', proof: 'webauthn' },
        new Date(),
        client,
      );
      throw new MfaVerificationFailedError();
    }

    const enrolled = await this.methods.find({
      where: { userId, type: MfaMethodType.WEBAUTHN, confirmedAt: Not(IsNull()) },
    });
    const allowCredentials = WebAuthnCeremonies.credentialIdsOf(enrolled);
    if (allowCredentials.length === 0) {
      // Written before the refusal travels on, exactly as
      // `MfaVerificationService.spendChallenge` writes its own before throwing.
      // The reason is recorded and never returned: the route answers this and
      // every other refusal on it identically.
      await recordUserAudit(
        this.audit,
        AuditAction.MFA_CHALLENGE_FAILED,
        userId,
        { reason: 'verification_failed', proof: 'webauthn' },
        new Date(),
        client,
      );
      throw new MfaVerificationFailedError();
    }

    const publicKey = await generateAuthenticationOptions({
      rpID: config.rpId,
      allowCredentials,
      userVerification: 'preferred',
    });

    const next = await this.challenges.mint(userId, MfaChallengePurpose.LOGIN, publicKey.challenge);
    // After the mint, so the entry describes a challenge that exists rather
    // than one this leg was about to make.
    await recordUserAudit(
      this.audit,
      AuditAction.MFA_CHALLENGE_ISSUED,
      userId,
      { proof: 'webauthn' },
      new Date(),
      client,
    );

    return { publicKey, challengeToken: next };
  }

  /**
   * Verifies an attestation and writes the method, confirmed, in one
   * transaction with the account's first batch of recovery codes.
   *
   * The order is the order of `MfaService.confirmTotpEnrollment`, and each step
   * guards the next: the label is refused before anything is spent; the
   * account's pending enrollment challenge is consumed under a write lock, so
   * one ceremony cannot be completed twice; the attestation is verified against
   * the nonce that challenge carried; the credential is refused if any account
   * already holds it; and only then is a row written.
   *
   * **Three columns and no more.** `webauthn_credential_id`,
   * `webauthn_public_key` and `webauthn_counter` are what an assertion is
   * checked against. The attestation carries more — an AAGUID, a device type,
   * a backup flag, the raw attestation object — and none of it is stored,
   * because none of it is read by anything here and a column nothing reads is a
   * column that leaks without buying anything.
   *
   * ## Recovery codes, once per account
   *
   * A passkey can be the account's *first* confirmed method, and an account
   * whose only factor is a device it can lose, with no codes issued, is the
   * lockout `MfaService.confirmTotpEnrollment`'s own TSDoc calls the worst
   * state this feature can produce. So the same arrangement is made here: the
   * account's `users` row is locked, the confirmed methods are counted after
   * this one is written, and a batch is issued when the count is one. It is the
   * same transaction, so a failure writing the batch rolls the method back with
   * it.
   *
   * @throws MfaLabelRequiredError when the label is missing, empty or only whitespace
   * @throws MfaVerificationFailedError when the attestation does not verify,
   *   and when the consumed challenge carries no nonce
   * @throws ConflictException when this credential is already registered — see
   *   {@link WebAuthnCeremonies.refuseDuplicateCredential}
   */
  private async completeEnrollment(
    userId: UserId,
    response: RegistrationResponseJSON,
    label: string | undefined,
  ): Promise<WebAuthnVerification> {
    const config = this.configured();

    // Before anything is spent. `MfaService.beginTotpEnrollment` trims in the
    // domain for the same reason: a label of spaces is not a label.
    const trimmed = label === undefined ? '' : label.trim();
    if (trimmed === '') throw new MfaLabelRequiredError();

    const challenge = await this.challenges.consumePendingFor(
      userId,
      MfaChallengePurpose.WEBAUTHN_ENROLLMENT,
    );
    const nonce = challenge.webauthnChallenge;
    // A `WEBAUTHN_ENROLLMENT` row with no nonce can never be completed. It is
    // refused rather than handed to the library as `undefined`, which would
    // throw somewhere less legible.
    if (nonce === null) throw new MfaVerificationFailedError();

    const verified = await WebAuthnCeremonies.refusing(() => verifyRegistrationResponse({
      response,
      expectedChallenge: nonce,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      // Matches `authenticatorSelection.userVerification: 'preferred'` above.
      // The library defaults this to `true`, which would demand of the
      // verification what the options did not ask of the authenticator.
      requireUserVerification: false,
    }));
    if (!verified.verified) throw new MfaVerificationFailedError();

    const { credential } = verified.registrationInfo;
    await this.refuseDuplicateCredential(credential.id);

    const now = new Date();
    const id = randomUUID();

    const recoveryCodes = await this.dataSource.transaction(async (manager) => {
      // The account's row, locked — the lock `MfaService.confirmTotpEnrollment`
      // and `MfaService.regenerateRecoveryCodes` take, so two first
      // confirmations for one account take turns and only one issues a batch.
      await manager.findOne(UserRecord, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });

      await manager.insert(MfaMethodRecord, {
        id,
        userId,
        type: MfaMethodType.WEBAUTHN,
        label: trimmed,
        totpSecret: null,
        totpLastStep: null,
        webauthnCredentialId: credential.id,
        // `bigint` and `text` columns; the Postgres driver hands both back as
        // strings, so both are written as strings — see `MfaMethodRecord`.
        webauthnPublicKey: Buffer.from(credential.publicKey).toString('base64url'),
        webauthnCounter: String(credential.counter),
        // Confirmed on the spot. The attestation *is* the proof a TOTP
        // enrollment needs a second round-trip for, and an unconfirmed
        // `WEBAUTHN` row is one `mapMfaMethodRecord` refuses on sight.
        confirmedAt: now,
        lastUsedAt: null,
        createdAt: now,
      });

      const confirmed = await manager.find(MfaMethodRecord, {
        where: { userId, confirmedAt: Not(IsNull()) },
      });
      const firstMethod = confirmed.length === 1;

      // In this transaction, so the entry and the method commit together — the
      // argument `MfaService.confirmTotpEnrollment` makes for the same entry.
      await this.audit.recordIn(manager, {
        organizationId: null,
        actorId: userId,
        action: AuditAction.MFA_METHOD_ADDED,
        resourceType: 'mfa_method',
        resourceId: id,
        metadata: { methodType: MfaMethodType.WEBAUTHN, recoveryCodesIssued: firstMethod },
        clientAddress: null,
        clientLabel: null,
        occurredAt: now,
      });

      if (!firstMethod) return null;

      return this.recoveryCodes.generate(userId, manager);
    });

    const written = await this.methods.findOne({ where: { id, userId } });
    if (written === null) throw new MfaVerificationFailedError();

    return {
      purpose: WebAuthnCeremonyPurpose.ENROLLMENT,
      method: mapMfaMethodRecord(written).toJSON(),
      recoveryCodes,
    };
  }

  /**
   * Finishes a sign-in with an assertion — **through
   * {@link MfaVerificationService.completeLoginWithWebAuthn}, which is what
   * makes this the second factor rather than another way to open a session.**
   *
   * `SessionService.begin`/`beginIn` will not open a session without a
   * `SecondFactorSettled`, whose only producers are the policy itself and
   * two named premises — so a caller that skipped the policy does not compile
   * rather than merely reading wrongly. This path would have been one more
   * caller answering for itself. It is not, because it opens no session: it
   * hands `MfaVerificationService` a function that judges the assertion, and
   * that class spends the login challenge, re-checks that the account may still
   * authenticate, and issues the session, in that order, with no way for this
   * file to skip a step or supply an account of its own.
   *
   * That is a stronger property than the type gives on its own, and it is why
   * this paragraph is still here now that the type exists.
   * `SecondFactorSettled.becauseTheFactorWasJustProven` would compile from
   * here, truthfully — an assertion really is a proof. What it would not do is
   * spend the challenge, re-check the account, or write the two audit entries,
   * and none of those is a type's job.
   *
   * The continuation is deliberate and is the point. The alternative — a
   * public `openSessionFor(userId, …)` on `MfaVerificationService` that this
   * file called after doing its own checks — would compile, and would produce
   * its evidence honestly, because an assertion really is a proof. It would
   * simply be one more caller answering for the steps no type can ask about,
   * moved a level up and harder to see. The compile-time guard is not the thing
   * this paragraph protects.
   */
  private async completeLogin(
    challengeToken: string,
    response: AuthenticationResponseJSON,
    client: ClientContext,
  ): Promise<WebAuthnVerification> {
    const config = this.configured();

    const completion = await this.verification.completeLoginWithWebAuthn(
      challengeToken,
      client,
      (userId, nonce) => this.proveAssertion(config, userId, nonce, response),
    );

    return { purpose: WebAuthnCeremonyPurpose.LOGIN, completion };
  }

  /**
   * Checks one assertion against one account's own confirmed passkeys, and
   * records the counter the authenticator reported.
   *
   * Scoped by `userId` in the query — `{ userId, webauthnCredentialId }` — for
   * the reason `MfaVerificationService.verifyProof`'s own lookup is, and the
   * argument there is this one word for word: resolved by credential id alone,
   * *anybody's* passkey would answer, and anybody who can enrol one of their
   * own could finish any account's second factor. The credential id arrives in
   * the request, so it is a selection among this account's methods and never a
   * statement about whose method it is.
   *
   * The counter is stored because `verifyAuthenticationResponse` compares it:
   * an authenticator that reports a value it has already reported is a signal
   * of a cloned credential, and the library refuses on it. It is **not** what
   * stops a replay of this request — the single-use challenge is, and it is
   * spent before this function is ever called. Authenticators that always
   * report `0` (many platform ones do) are unaffected either way.
   *
   * @returns the audit metadata naming the method that answered
   * @throws MfaVerificationFailedError for a missing nonce, a credential this
   *   account does not hold, a stored key that cannot be read, and an
   *   assertion the library refuses or throws on
   */
  private async proveAssertion(
    config: WebAuthnConfig,
    userId: UserId,
    nonce: string | null,
    response: AuthenticationResponseJSON,
  ): Promise<Record<string, unknown>> {
    if (nonce === null) throw new MfaVerificationFailedError();

    const method = await this.methods.findOne({
      where: {
        userId,
        type: MfaMethodType.WEBAUTHN,
        webauthnCredentialId: response.id,
        confirmedAt: Not(IsNull()),
      },
    });
    if (method === null) throw new MfaVerificationFailedError();

    const { webauthnCredentialId, webauthnPublicKey, webauthnCounter } = method;
    // `mapMfaMethodRecord` refuses such a row on sight and this path does not
    // go through it — the same note `MfaVerificationService.proveTotp` carries
    // about a `TOTP` row with no seed.
    if (webauthnCredentialId === null || webauthnPublicKey === null) {
      throw new MfaVerificationFailedError();
    }

    const verified = await WebAuthnCeremonies.refusing(() => verifyAuthenticationResponse({
      response,
      expectedChallenge: nonce,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      credential: {
        id: webauthnCredentialId,
        publicKey: new Uint8Array(Buffer.from(webauthnPublicKey, 'base64url')),
        counter: webauthnCounter === null ? 0 : Number(webauthnCounter),
      },
      // Matches the `userVerification: 'preferred'` the options asked for.
      requireUserVerification: false,
    }));
    if (!verified.verified) throw new MfaVerificationFailedError();

    await this.methods.update(
      { id: method.id, userId },
      {
        webauthnCounter: String(verified.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    );

    return { methodId: method.id, methodType: method.type };
  }

  /**
   * Refuses a credential any account in this deployment already holds.
   *
   * `uq_mfa_methods_webauthn_credential` is the check that actually holds —
   * this one races, and the insert below it is what a concurrent duplicate
   * hits. It exists so the ordinary case answers `409` instead of surfacing a
   * driver error as a `500`, which is both a worse answer and an oracle of its
   * own.
   *
   * ## What it tells a caller, and why that is acceptable
   *
   * "Already registered" is true whether the credential belongs to this
   * account or to somebody else, so it does say that *some* account holds this
   * passkey. The person learning it is holding the authenticator, tapped it,
   * and could learn the same thing from any relying party's
   * `excludeCredentials`; it is a property of the WebAuthn model rather than of
   * this endpoint. The alternative — pretending to register a credential that
   * cannot be used — trades a disclosure nobody can act on for a method that
   * silently does not work.
   *
   * @throws ConflictException when the credential is registered anywhere
   */
  private async refuseDuplicateCredential(credentialId: string): Promise<void> {
    const clash = await this.methods.findOne({
      where: { webauthnCredentialId: credentialId },
    });
    if (clash !== null) {
      throw new ConflictException('That security key is already registered.');
    }
  }

  /** The credential ids of `rows`, dropping any row that has none. */
  private static credentialIdsOf(rows: MfaMethodRecord[]): { id: string }[] {
    return rows
      .filter((row): row is MfaMethodRecord & { webauthnCredentialId: string } =>
        row.webauthnCredentialId !== null)
      .map((row) => ({ id: row.webauthnCredentialId }));
  }

  /**
   * Runs one of the library's verifiers, turning anything it **throws** into
   * the refusal every other failed proof answers with.
   *
   * `verifyRegistrationResponse` and `verifyAuthenticationResponse` do not
   * return `{ verified: false }` for most bad input: they throw — on a
   * mismatched origin, an unexpected RP ID hash, a malformed attestation, a
   * signature counter that went backwards. Left alone, each of those is an
   * unhandled error and a `500`, which on a sign-in route is both a wrong
   * answer and a distinguishable one on a path whose whole design is that every
   * refusal looks the same. Collapsed here, they are `MfaVerificationFailedError`
   * like every other proof that does not hold.
   *
   * @throws MfaVerificationFailedError for anything the verifier throws
   */
  private static async refusing<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch {
      throw new MfaVerificationFailedError();
    }
  }
}
