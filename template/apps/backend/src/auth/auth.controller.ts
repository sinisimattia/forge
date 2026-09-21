import {
  Body,
  Controller,
  Delete,
  Get,
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
import { assertNever } from '__FORGE_SCOPE__/core/shared/policies';
import { ParseUuidParamPipe } from '../common/pipes';
import { AuthService } from './auth.service';
import { clientContextOf } from './client-context';
import { CurrentUser, Public } from './decorators';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
  type AuthResponseDto,
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
   * It was missing for a phase, while `AuthService.resendVerification` existed
   * and was tested. The consequence was invisible from this side and total from
   * the other: `IAuthService` names the method, so no caller implementing that
   * contract over this API could honour it, and anybody who let a verification
   * link lapse had no way to ask for another.
   */
  @Public()
  @Post('resend-verification')
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
   * The `switch` is exhaustive and ends in `assertNever`, so the day
   * `AuthenticationStatus` grows a third member — a deployment that requires a
   * second factor introduces one that is neither success nor failure — this
   * method stops compiling instead of quietly falling through to a rejection.
   *
   * **Both failing branches produce the same status and the same body.** The
   * rejection reason never leaves the service: it is recorded, never returned.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  public async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
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
      default:
        return assertNever(result.outcome);
    }
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
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
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
