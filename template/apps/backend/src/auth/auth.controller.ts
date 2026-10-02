import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import { SessionNotFoundError } from '__FORGE_SCOPE__/core/auth/errors';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import {
  MfaChallengeAlreadyConsumedError,
  MfaChallengeExpiredError,
  MfaChallengeNotFoundError,
  MfaMethodNotFoundError,
  MfaVerificationFailedError,
  RecoveryCodeAlreadyConsumedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import { assertNever } from '__FORGE_SCOPE__/core/shared/policies';
import { UserNotFoundError } from '__FORGE_SCOPE__/core/users/errors';
import { ParseUuidParamPipe } from '../common/pipes';
import { Throttled } from '../throttling/throttled.decorator';
import { MfaLoginCompletion, MfaVerificationService } from '../mfa/mfa-verification.service';
import { AuthService } from './auth.service';
import { clientContextOf } from './client-context';
import { CurrentUser, Public } from './decorators';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  MfaChallengeMethodsDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
  VerifyMfaDto,
  type AuthResponseDto,
  type MfaChallengeMethodsResponseDto,
  type MfaChallengeResponseDto,
  type RegistrationAcceptedDto,
  type SessionResponseDto,
} from './dto';
import { REFRESH_COOKIE } from './refresh-cookie';
import { RefreshTokenService } from './session/refresh-token.service';
import { ACCESS_TOKEN_TTL_SECONDS } from './session/session.service';
import type { AuthenticatedActor } from './strategies';

/**
 * The endpoints that make an account real.
 *
 * Every route here that can be reached without a credential says so with
 * `@Public()`. Nothing is open by omission: the global `JwtAuthGuard` closes
 * everything this application serves unless a route is marked, which is what
 * `__tests__/global-guard.spec.ts` (D6) exists to prove.
 */
@Controller('auth')
export class AuthController {
  public constructor(
    private readonly auth: AuthService,
    private readonly refresh: RefreshTokenService,
    private readonly mfa: MfaVerificationService,
  ) {}

  /**
   * Begins registration.
   *
   * **`202` with a fixed body, in both cases, with no branch anywhere in this
   * method.** The service knows whether an account was created or already
   * existed and writes that to the audit log; this response does not carry the
   * difference and must never be made to. A body that said "an account already
   * exists with that address" would let anybody test any address for
   * registration, one request at a time — and of the three endpoints that take
   * an address without proving anything, this is the easiest to probe.
   *
   * Whoever opens this method to improve the experience will find the helpful
   * message missing and this comment in its place. The helpful message is real;
   * it goes to the address, where only its owner reads it
   * (`mail/templates/account-exists.ts`).
   */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  public async register(@Body() body: RegisterDto): Promise<RegistrationAcceptedDto> {
    await this.auth.register({
      email: body.email,
      displayName: body.displayName,
      secret: body.secret,
    });
    return { status: 'accepted' };
  }

  /** Consumes a verification credential. */
  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  public async verifyEmail(@Body() body: VerifyEmailDto): Promise<{ status: 'verified' }> {
    await this.auth.verifyEmail(body.credential);
    return { status: 'verified' };
  }

  /**
   * Re-issues verification.
   *
   * **`202` with a fixed body, in both cases, with no branch anywhere in this
   * method** — the third of the three endpoints that take an address without
   * proving anything, and the same arrangement for the same reason as
   * {@link AuthController.register} and {@link AuthController.forgotPassword}.
   * The service already answers alike for an unknown address, an address that is
   * already proven, and one whose account has been closed; this method must not
   * reintroduce a difference the service was careful not to have.
   *
   * It was missing for a time, while `AuthService.resendVerification` existed
   * and was tested. The consequence was invisible from this side and total from
   * the other: `IAuthService` names the method, so no caller implementing that
   * contract over this API could honour it, and anybody who let a verification
   * link lapse had no way to ask for another.
   */
  @Public()
  @Post('resend-verification')
  @Throttled('credential')
  @HttpCode(HttpStatus.ACCEPTED)
  public async resendVerification(
    @Body() body: ResendVerificationDto,
  ): Promise<RegistrationAcceptedDto> {
    await this.auth.resendVerification(body.email);
    return { status: 'accepted' };
  }

  /**
   * Attempts authentication.
   *
   * The `switch` is exhaustive and ends in `assertNever`, so a fourth ending
   * would stop this method from compiling rather than quietly falling through
   * to a rejection — which is what already happened once: `MFA_REQUIRED`, a
   * deployment that requires a second factor, is neither success nor failure
   * but "not yet".
   *
   * **The `REJECTED` branch produces the same status and the same body for
   * every reason there is.** The rejection reason never leaves the service: it
   * is recorded, never returned.
   *
   * **The `MFA_REQUIRED` branch sets no cookie, and there is no session behind
   * it to set one for.** The two are separate facts and the second is the one
   * worth stating: an implementation that opened a session here and simply
   * returned the challenge shape would satisfy every assertion a response body
   * or a header can carry. `AuthService.signIn` returns from that branch above
   * `sessions.begin`, and `__tests__/discriminating/d10-mfa-challenge-only.spec.ts`
   * counts `sessions` rows rather than trusting this comment.
   *
   * `no-store`: every ending of this route that is not a rejection hands back a
   * credential — an access token on `AUTHENTICATED`, a challenge token on
   * `MFA_REQUIRED` — and neither may be kept by a cache between here and the
   * person.
   */
  @Public()
  @Post('login')
  @Throttled('credential')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto | MfaChallengeResponseDto> {
    const result = await this.auth.signIn({
      email: body.email,
      secret: body.secret,
      client: clientContextOf(request),
    });

    switch (result.outcome.status) {
      case AuthenticationStatus.AUTHENTICATED: {
        const credentials = result.credentials;
        if (credentials === null) throw new UnauthorizedException();
        REFRESH_COOKIE.set(response, credentials.refreshToken);
        return {
          user: result.outcome.user.toJSON(),
          accessToken: credentials.accessToken,
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        };
      }
      case AuthenticationStatus.REJECTED:
        // One answer for every reason there is. `result.outcome.reason` is in
        // scope right here and is deliberately not read: the moment it reaches a
        // response body, "no such account" and "wrong secret" become
        // distinguishable and anybody can test an address for existence one
        // attempt at a time.
        throw new UnauthorizedException({ messageKey: 'errors.auth.invalid_credentials' });
      case AuthenticationStatus.MFA_REQUIRED: {
        const challengeToken = result.challengeToken;
        // Unreachable while `signIn` mints on this branch, and it carries a
        // message key anyway: a bare `UnauthorizedException` renders as an
        // untranslated "Unauthorized", which is what the placeholder this
        // replaced actually shipped.
        if (challengeToken === null) {
          throw new UnauthorizedException({ messageKey: 'errors.auth.invalid_credentials' });
        }
        return {
          status: AuthenticationStatus.MFA_REQUIRED,
          challengeToken,
          // Three fields per method, not `MfaMethod.toJSON()` — see
          // `MfaChallengeMethodDto`. This is the one response that goes to
          // somebody who has proven a password and nothing else.
          methods: result.outcome.methods.map((method) => ({
            id: method.id,
            type: method.type,
            label: method.label,
          })),
        };
      }
      default:
        return assertNever(result.outcome);
    }
  }

  /**
   * Lists the methods a login challenge may be finished with, and does not spend the
   * challenge — it does draw on the `mfa-mint` budget, which is what stops it being
   * a free way to probe tokens.
   *
   * The federated door's half of what `POST /auth/login` returns inline: the
   * browser is redirected with a challenge token and no body, so it asks here
   * for the same id, type and label per method that the password response
   * carries. `POST`, not `GET`, so the token is in the body and not in a URL
   * that a proxy log or a history entry keeps.
   *
   * **The challenge stays live** for the `POST /auth/mfa/verify` that follows,
   * and the account is read off the challenge row, never off the request.
   * Every way this can refuse — no such challenge, an expired one, a spent
   * one, one minted for another ceremony, an account that can no longer sign
   * in — is the one `401` `verifyMfa` gives, byte for byte; a listing that told
   * those apart would be a way to probe tokens without presenting them.
   *
   * `no-store`: the body describes an account's second factors.
   */
  @Public()
  @Post('mfa/methods')
  @Throttled('mfa-mint')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async mfaMethods(
    @Body() body: MfaChallengeMethodsDto,
  ): Promise<MfaChallengeMethodsResponseDto> {
    try {
      return { methods: await this.mfa.methodsForChallenge(body.challengeToken) };
    } catch (error) {
      if (
        error instanceof MfaChallengeNotFoundError
        || error instanceof MfaChallengeExpiredError
        || error instanceof MfaChallengeAlreadyConsumedError
        || error instanceof MfaVerificationFailedError
      ) {
        throw new UnauthorizedException({ messageKey: 'errors.auth.mfa_verification_failed' });
      }
      throw error;
    }
  }

  /**
   * Finishes a sign-in the password alone did not finish.
   *
   * `@Public()` for the same reason {@link AuthController.refreshSession} is:
   * a caller here has no session yet — that is what it is trying to obtain.
   * What it proves instead is possession of a challenge this server minted
   * moments ago, plus a valid proof from one of the challenged account's own
   * confirmed methods. **Nothing in the request body says whose account it
   * is**; `MfaVerificationService.completeLogin` reads that off the challenge
   * row, which is the whole of what stops a caller completing somebody else's
   * second factor with a method of their own.
   *
   * ## One answer for every refusal, and where it has to be made
   *
   * The service below tells five things apart: a challenge that answers to
   * nothing, one that has expired, one already spent, one whose purpose this
   * application does not model, and one minted for a different ceremony —
   * plus, past the challenge, a method that is not this account's and a proof
   * that does not verify. Every one of those is a distinct error class, kept
   * distinct so the audit trail and a developer's log can say which happened.
   *
   * **This `catch` is where that stops.** Each distinction is a disclosure:
   * "expired, not absent" says a digest existed, which turns presenting tokens
   * into a way of learning which ones this server minted; "already consumed"
   * says somebody used it; "wrong purpose" says an enrollment is pending on an
   * account. None of it is anything the presenter had to be given, and the
   * legitimate holder needs none of it — they hold a challenge, and it works.
   * The arrangement is the settled one in this file: `login`'s `REJECTED`
   * branch has `AuthenticationOutcome.reason` in scope and deliberately does
   * not read it.
   *
   * Note where this is **not** done: `common/filters/http-exception.filter.ts`.
   * A row in its `DOMAIN_ERRORS` table carries a `messageKey` and a `code` per
   * error type, and its nearest neighbours — `ConsumedTokenError` and
   * `ExpiredTokenError`, which share a status precisely because they are two
   * reasons for one refusal — carry deliberately different ones. Registering
   * the challenge errors there means either all of them collapsed onto one row
   * they cannot share, or a `code` per cause, which is this leak re-opened one
   * field below the status. Catching here also means the collapse survives
   * somebody adding those rows later: the exception never reaches the filter.
   *
   * A recovery code arrives in its own `recoveryCode` field instead of a
   * `methodId` and `code`, and {@link AuthController.completeSecondFactor}
   * picks the proof by which fields are present. The recovery path adds two
   * more distinctions that stop at the same `catch`: a code that was already
   * spent (`RecoveryCodeAlreadyConsumedError`) and one nobody was issued — and
   * a request offering both proofs, or neither, which is refused rather than
   * resolved in favour of one.
   *
   * ## The account is read inside the `try`, after the cookie
   *
   * Reading it is the last thing that can go wrong on a sign-in that has
   * already succeeded: the session exists and the renewal cookie is set by the
   * time `userOf` runs. Outside the `try`, a `UserNotFoundError` from it
   * escaped to the global filter and answered `404` to somebody who is at that
   * moment holding live credentials — an answer that tells a client the thing
   * it asked for does not exist, when what happened is that a sign-in it must
   * now repeat came apart at the last step. Inside, it is the `401` every other
   * refusal here gives, and `MfaController.flattenRefusals` catches the same
   * error, for the same reason, on the passkey route.
   *
   * `no-store`: the body carries an access credential.
   *
   * @throws UnauthorizedException — one status, one body, for every refusal
   *   above. `d10-mfa-challenge-only.spec.ts` compares the actual response
   *   bytes across all five challenge causes, a malformed `methodId` and every
   *   recovery-code cause rather than reading this comment.
   */
  @Public()
  @Post('mfa/verify')
  @Throttled('mfa-attempt')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async verifyMfa(
    @Body() body: VerifyMfaDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    try {
      const completed = await this.completeSecondFactor(body, request);
      REFRESH_COOKIE.set(response, completed.credentials.refreshToken);
      const user = await this.auth.userOf(completed.userId);
      return {
        user: user.toJSON(),
        accessToken: completed.credentials.accessToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      };
    } catch (error) {
      if (
        error instanceof MfaChallengeNotFoundError
        || error instanceof MfaChallengeExpiredError
        || error instanceof MfaChallengeAlreadyConsumedError
        || error instanceof MfaMethodNotFoundError
        || error instanceof MfaVerificationFailedError
        || error instanceof RecoveryCodeAlreadyConsumedError
        || error instanceof UserNotFoundError
      ) {
        throw new UnauthorizedException({ messageKey: 'errors.auth.mfa_verification_failed' });
      }
      throw error;
    }
  }

  /**
   * Chooses the proof by which fields are present, and by nothing else.
   *
   * `recoveryCode` alone is a recovery code; `methodId` and `code` together, with
   * no `recoveryCode`, are a method's code. Every other combination — both
   * proofs, neither, or half of the method pair — is refused with
   * `MfaVerificationFailedError` before any state is touched, which the caller's
   * `catch` flattens onto the one `401`. Nothing here reads a value's length or
   * format, and a request offering two proofs is refused rather than resolved in
   * favour of either: a discriminator that tolerates ambiguity is not one.
   *
   * @throws MfaVerificationFailedError for an ambiguous or empty offer
   */
  private completeSecondFactor(body: VerifyMfaDto, request: Request): Promise<MfaLoginCompletion> {
    const client = clientContextOf(request);
    const { challengeToken, methodId, code, recoveryCode } = body;

    if (recoveryCode !== undefined && methodId === undefined && code === undefined) {
      return this.mfa.completeLoginWithRecoveryCode(challengeToken, recoveryCode, client);
    }
    if (recoveryCode === undefined && methodId !== undefined && code !== undefined) {
      return this.mfa.completeLogin(challengeToken, methodId, code, client);
    }
    return Promise.reject(new MfaVerificationFailedError());
  }

  /**
   * Exchanges the renewal credential in the cookie for a fresh pair.
   *
   * `@Public()` because a caller reaching this endpoint has, by definition, no
   * usable access credential — that is why it is renewing. What it proves
   * instead is possession of the renewal credential, which the cookie carries
   * and which `RefreshTokenService.rotate` checks.
   *
   * A failure clears the cookie. Leaving a credential the server has just
   * refused in the browser means every subsequent renewal presents it again,
   * and in the reuse case each of those presentations is another
   * `SESSION_REUSE_DETECTED` entry describing nothing new.
   *
   * `no-store`: the body carries an access credential and the response rotates
   * the renewal cookie, so a cached copy of this answer is a credential pair
   * outliving the exchange that produced it.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async refreshSession(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const presented = REFRESH_COOKIE.read(request);
    if (presented === null) throw new UnauthorizedException();

    try {
      const credentials = await this.refresh.rotate(presented, clientContextOf(request));
      REFRESH_COOKIE.set(response, credentials.refreshToken);
      const user = await this.auth.userOf(credentials.session.userId);
      return {
        user: user.toJSON(),
        accessToken: credentials.accessToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      };
    } catch (error) {
      REFRESH_COOKIE.clear(response);
      // The one place `SessionNotFoundError` means 401 rather than 404. Everywhere
      // else it answers "no session of yours has that id"; here the caller
      // presented a credential and it does not work, which is the definition of
      // unauthenticated — and a 404 would tell a client to stop retrying rather
      // than to sign in again.
      if (error instanceof SessionNotFoundError) {
        throw new UnauthorizedException({ messageKey: 'errors.auth.session_not_found' });
      }
      throw error;
    }
  }

  /**
   * Begins password recovery.
   *
   * **`202` with a fixed body, in both cases, with no branch anywhere in this
   * method** — the same arrangement, for the same reason, as
   * {@link AuthController.register}. This is the second of the three endpoints
   * that take an address without proving anything, and the one whose helpful
   * version ("we have no account for that address") is most often asked for.
   *
   * The service knows whether an account existed and writes it down; this
   * response does not carry the difference and must never be made to. What the
   * person actually needs is at the address, where only its owner reads it.
   *
   * `__tests__/enumeration-safety.spec.ts` (D7) compares the whole response for
   * a known and an unknown address rather than checking each against a literal,
   * so a branch added here fails a comparison rather than needing somebody to
   * have remembered to update two expectations.
   */
  @Public()
  @Post('forgot-password')
  @Throttled('credential')
  @HttpCode(HttpStatus.ACCEPTED)
  public async forgotPassword(@Body() body: ForgotPasswordDto): Promise<RegistrationAcceptedDto> {
    await this.auth.requestPasswordReset(body.email);
    return { status: 'accepted' };
  }

  /**
   * Spends a recovery credential on a new secret.
   *
   * Every session the account held is ended by the service — recovery is what
   * somebody does when they believe somebody else has their password, and a
   * session left alive leaves that person exactly where they were. Nothing is
   * re-issued here: whoever completes a recovery signs in with the secret they
   * have just chosen, which is also the first proof that they have it right.
   */
  @Public()
  @Post('reset-password')
  @Throttled('reset-credential')
  @HttpCode(HttpStatus.OK)
  public async resetPassword(@Body() body: ResetPasswordDto): Promise<{ status: 'reset' }> {
    await this.auth.resetPassword(body.credential, body.secret);
    return { status: 'reset' };
  }

  /**
   * Replaces the actor's own secret, proving the current one first.
   *
   * `IAuthService.changePassword` ends **every** session, the caller's included,
   * because it is given an actor and not a request and cannot tell which one is
   * current. The transport can, so a fresh session is opened for the caller it
   * is serving and nothing for anybody else who was signed in as that account.
   *
   * **One call, because it is one transaction.** This was two statements — the
   * change, then the re-issue — and everything about that reads correctly while
   * leaving a window two awaits wide in which the password has changed, every
   * session is dead, and the new one has not been written. A review found the
   * ordering of that pair enforced by nothing at all; `changePasswordAndReissue`
   * is the same pair made indivisible, so there is no longer an order here to
   * get wrong or a gap to fail in.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  public async changePassword(
    @CurrentUser() actor: AuthenticatedActor,
    @Body() body: ChangePasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const credentials = await this.auth.changePasswordAndReissue(
      actor.userId,
      body.currentSecret,
      body.newSecret,
      clientContextOf(request),
    );
    REFRESH_COOKIE.set(response, credentials.refreshToken);
    const user = await this.auth.userOf(actor.userId);
    return {
      user: user.toJSON(),
      accessToken: credentials.accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  /**
   * Ends the session the request was made through.
   *
   * It clears the cookie **and** revokes the session. Clearing alone is theatre:
   * the credential is a value, and a value somebody copied keeps working for as
   * long as the row behind it does, whatever this response tells the browser to
   * forget.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async logout(
    @CurrentUser() actor: AuthenticatedActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(actor.userId, actor.sessionId);
    REFRESH_COOKIE.clear(response);
  }

  /** The actor's own usable sessions, newest first. */
  @Get('sessions')
  public async listSessions(
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<SessionResponseDto[]> {
    const sessions = await this.auth.listSessions(actor.userId);
    return sessions.map((session) => ({
      ...session.toJSON(),
      isCurrent: session.id === actor.sessionId,
    }));
  }

  /** Ends one of the actor's own sessions. */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async revokeSession(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) id: string,
  ): Promise<void> {
    await this.auth.revokeSession(actor.userId, id as SessionId);
  }
}
