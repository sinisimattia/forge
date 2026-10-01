import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import {
  MfaChallengeAlreadyConsumedError,
  MfaChallengeExpiredError,
  MfaChallengeNotFoundError,
  MfaMethodNotFoundError,
  MfaReauthenticationRequiredError,
  MfaVerificationFailedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import type { MfaMethodId } from '__FORGE_SCOPE__/core/mfa/types';
import { UserNotFoundError } from '__FORGE_SCOPE__/core/users/errors';
import { AuthService } from '../auth/auth.service';
import { clientContextOf } from '../auth/client-context';
import { CurrentUser, Public, ReadsSession } from '../auth/decorators';
import type { AuthResponseDto } from '../auth/dto';
import { OptionalJwtAuthGuard } from '../auth/guards';
import { REFRESH_COOKIE } from '../auth/refresh-cookie';
import { ACCESS_TOKEN_TTL_SECONDS } from '../auth/session/session.service';
import type { AuthenticatedActor } from '../auth/strategies';
import { Throttled } from '../throttling/throttled.decorator';
import { ConfirmTotpDto } from './dto/confirm-totp.dto';
import { EnrollTotpDto } from './dto/enroll-totp.dto';
import type { MfaMethodsResponseDto } from './dto/mfa-methods-response.dto';
import type {
  ConfirmTotpResponseDto,
  RegenerateRecoveryCodesResponseDto,
  TotpEnrollmentResponseDto,
} from './dto/totp-enrollment-response.dto';
import { MfaProofDto, nestedProofOf, proofOf } from './dto/mfa-proof.dto';
import type { WebAuthnVerifyResponseDto } from './dto/webauthn-response.dto';
import { WebAuthnOptionsDto, WebAuthnVerifyDto } from './dto/webauthn.dto';
import { MfaService } from './mfa.service';
import {
  WebAuthnCeremonies,
  WebAuthnCeremonyPurpose,
  webAuthnCallerOf,
  type WebAuthnCaller,
  type WebAuthnOptionsResult,
} from './webauthn/WebAuthnCeremonies';

/**
 * A signed-in person managing their own second factors — and, on two routes,
 * somebody halfway through signing in with one.
 *
 * Every route but the two WebAuthn ones acts on `actor.userId` and takes no
 * user id from the request, so there is no path to anybody else's methods, and
 * not one of those carries `@Public()`: the global guard requires a session,
 * and a session that is only the first half of a two-phase sign-in is a
 * challenge, not an access credential, and never reaches here.
 *
 * ## The two exceptions, and what makes them safe
 *
 * `POST /mfa/webauthn/options` and `POST /mfa/webauthn/verify` each serve an
 * enrollment *and* a login, because one WebAuthn ceremony has the same two
 * legs either way. They carry `@Public()` together with
 * {@link OptionalJwtAuthGuard}: the decorator is what stops the global guard
 * refusing the login half outright, and the guard is what still checks an
 * `Authorization` header whenever one is present. A login caller has no
 * session by definition — that is why it is signing in — and proves possession
 * of a challenge token this server minted after a password verified.
 *
 * They also carry `@ReadsSession()`, which has the global guard verify a
 * presented credential, so that the throttling guard — which runs before any
 * route-level guard — can see the account and meter an enrollment's proof
 * guesses against it, a budget a fresh access credential does not reset.
 *
 * **Which of the two a request is, is decided by which credential it carried
 * and by nothing in its body**, by `webAuthnCallerOf`, before any handler work
 * happens; a request carrying both is refused. That function's own TSDoc
 * carries the argument and the defect it is written against, and is the thing
 * to read before touching either route.
 *
 * ## Two answers, because there are two callers
 *
 * Domain refusals reach the client through the global exception filter's own
 * table: `MFA_METHOD_ALREADY_CONFIRMED` is `409`, `MFA_METHOD_NOT_FOUND` `404`,
 * `MFA_VERIFICATION_FAILED` and `MFA_LABEL_REQUIRED` `422`,
 * `MFA_REAUTHENTICATION_REQUIRED` `403`. Unlike
 * `POST /auth/mfa/verify` these are **not** flattened into one answer: the
 * caller is already authenticated and is working on their own methods, so
 * telling a wrong code from an already-confirmed method reveals nothing they
 * could not do themselves.
 *
 * The login half of `POST /mfa/webauthn/verify` **is** flattened, onto the one
 * `401` `AuthController.verifyMfa` gives, because there the caller is not
 * authenticated and the distinctions are the leak `MfaChallengeService`'s own
 * TSDoc enumerates. Flattening one branch and not the other is not a judgement
 * about the request's contents: the branch was fixed by the credential before
 * anything was attempted.
 */
@Controller('mfa')
export class MfaController {
  public constructor(
    private readonly mfa: MfaService,
    private readonly webauthn: WebAuthnCeremonies,
    private readonly auth: AuthService,
  ) {}

  /**
   * The actor's methods, confirmed and unconfirmed, and how many recovery codes
   * they have left. Carries no secret material.
   *
   * The count is the account's, so it sits beside `methods` and not on a method.
   * It is always present, `0` included.
   */
  @Get('methods')
  public async list(@CurrentUser() actor: AuthenticatedActor): Promise<MfaMethodsResponseDto> {
    const [methods, recoveryCodesRemaining] = await Promise.all([
      this.mfa.listMethods(actor.userId),
      this.mfa.recoveryCodesRemaining(actor.userId),
    ]);
    return { methods: methods.map((method) => method.toJSON()), recoveryCodesRemaining };
  }

  /**
   * Offers a new TOTP secret. The method it creates is unconfirmed and gates
   * nothing until {@link MfaController.confirmTotp} succeeds.
   *
   * `no-store`: the body is a shared secret, and it must not be kept by a
   * cache between here and the person.
   */
  @Post('totp/enroll')
  @Throttled('mfa-mint')
  @Header('Cache-Control', 'no-store')
  public async enrollTotp(
    @CurrentUser() actor: AuthenticatedActor,
    @Body() body: EnrollTotpDto,
  ): Promise<TotpEnrollmentResponseDto> {
    return this.mfa.beginTotpEnrollment(actor.userId, body.label);
  }

  /**
   * Finishes an enrollment. `recoveryCodes` is the plaintext batch on the
   * account's first confirmation and `null` afterwards — shown once, so also
   * `no-store`.
   *
   * An account that already holds a confirmed method answers `403`
   * `MFA_REAUTHENTICATION_REQUIRED` unless the body carries a fresh `proof` of
   * it: a factor is admitted only by a factor already trusted. The first factor
   * needs none.
   */
  @Post('totp/confirm')
  @Throttled('mfa-proof')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async confirmTotp(
    @CurrentUser() actor: AuthenticatedActor,
    @Body() body: ConfirmTotpDto,
  ): Promise<ConfirmTotpResponseDto> {
    const batch = await this.mfa.confirmTotpEnrollment(
      actor.userId,
      body.methodId as MfaMethodId,
      body.code,
      nestedProofOf(body.proof),
    );
    return { recoveryCodes: batch === null ? null : batch.codes };
  }

  /**
   * Replaces the account's recovery codes with a fresh batch, shown once.
   *
   * Always demands a proof in the body — a code from a confirmed method, or an
   * unused recovery code — and answers `403` without one. A fresh batch
   * invalidates the codes the rightful owner is holding, so a hijacked session
   * must not be able to issue one on its own authority.
   *
   * Not `POST :id`-shaped: `recovery-codes` is a fixed segment on a different
   * verb from `DELETE :id`, so it can never be read as a method id.
   */
  @Post('recovery-codes')
  @Throttled('mfa-proof')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async regenerateRecoveryCodes(
    @CurrentUser() actor: AuthenticatedActor,
    @Body() body: MfaProofDto,
  ): Promise<RegenerateRecoveryCodesResponseDto> {
    const proof = proofOf(body);
    if (proof === null) throw new MfaReauthenticationRequiredError();
    const batch = await this.mfa.regenerateRecoveryCodes(actor.userId, proof);
    return { recoveryCodes: batch.codes };
  }

  /**
   * Offers the options for a WebAuthn ceremony — an enrollment when the
   * request carried a session, a login when it carried a challenge token.
   *
   * `no-store`: a login's body carries the next challenge token, which is a
   * credential, and must not be kept by a cache between here and the person.
   *
   * The login branch is wrapped in {@link MfaController.flattenRefusals} and
   * the enrollment branch is not, for the reason this class's own TSDoc gives:
   * **this is already the leg that spends the challenge**, so "that challenge
   * expired", "that challenge was already spent" and "that account holds no
   * passkey" are all reachable here, and all three are facts an
   * unauthenticated caller is owed none of. What the caller is not told, the
   * audit trail is — see {@link WebAuthnCeremonies.options}, which is why this
   * route reads a {@link ClientContext} it does not otherwise use.
   *
   * @throws BadRequestException when the request carried both credentials, and
   *   when it carried neither
   * @throws UnauthorizedException for every way the login branch can refuse
   * @throws NotFoundException when this deployment has no WebAuthn
   */
  @Public()
  @ReadsSession()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('webauthn/options')
  @Throttled('mfa-mint')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async webAuthnOptions(
    @CurrentUser() actor: AuthenticatedActor | undefined,
    @Body() body: WebAuthnOptionsDto,
    @Req() request: Request,
  ): Promise<WebAuthnOptionsResult> {
    const caller = MfaController.callerOf(actor, request, body.challengeToken);
    const client = clientContextOf(request);

    if (caller.purpose === WebAuthnCeremonyPurpose.ENROLLMENT) {
      return this.webauthn.options(caller, client);
    }
    if (caller.purpose === WebAuthnCeremonyPurpose.LOGIN) {
      return MfaController.flattenRefusals(() => this.webauthn.options(caller, client));
    }

    // Unreachable through `callerOf`. See the sibling in
    // {@link MfaController.webAuthnVerify} for why it is written out anyway.
    throw new InternalServerErrorException();
  }

  /**
   * Finishes a WebAuthn ceremony: registers the passkey, or opens the session.
   *
   * The purpose is the one {@link MfaController.callerOf} fixed, and the
   * dispatch below is explicit equality per member with an unconditional
   * refusing fallthrough — never a ternary. It is written out a second time
   * here, after `WebAuthnCeremonies.verify` has already made the same
   * decision, because the two answers differ in more than their body: the
   * login branch sets a renewal cookie and flattens every refusal onto one
   * `401`, and neither of those can be decided from a result.
   *
   * `no-store`: the enrollment body may carry the account's only copy of its
   * recovery codes, and the login body carries an access credential.
   *
   * An enrollment on an account that already holds a confirmed method answers
   * `403` `MFA_REAUTHENTICATION_REQUIRED` unless the body carries a fresh
   * `proof` of it, exactly as {@link MfaController.confirmTotp} does. A login
   * does not read `proof`.
   *
   * @throws BadRequestException when the request carried both credentials, and
   *   when it carried neither
   * @throws UnauthorizedException for every way a login can fail
   * @throws NotFoundException when this deployment has no WebAuthn
   */
  @Public()
  @ReadsSession()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('webauthn/verify')
  @Throttled('mfa-attempt')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async webAuthnVerify(
    @CurrentUser() actor: AuthenticatedActor | undefined,
    @Body() body: WebAuthnVerifyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebAuthnVerifyResponseDto> {
    const caller = MfaController.callerOf(actor, request, body.challengeToken);
    const client = clientContextOf(request);

    if (caller.purpose === WebAuthnCeremonyPurpose.ENROLLMENT) {
      const done = await this.webauthn.verify(
        caller,
        body.response,
        body.label,
        nestedProofOf(body.proof),
        client,
      );
      if (done.purpose !== WebAuthnCeremonyPurpose.ENROLLMENT) {
        throw new InternalServerErrorException();
      }
      return { method: done.method, recoveryCodes: done.recoveryCodes };
    }

    if (caller.purpose === WebAuthnCeremonyPurpose.LOGIN) {
      return this.finishWebAuthnLogin(caller, body, client, response);
    }

    // Unreachable through `callerOf`, which returns one of the two members or
    // throws. Present because "unreachable" is a claim about today's code, and
    // the branch a `default` would otherwise fall into here is the one that
    // opens a session.
    throw new InternalServerErrorException();
  }

  /**
   * Removes one of the actor's own methods.
   *
   * The session alone is enough for an unconfirmed method and for a confirmed
   * one another confirmed method outlives. Removing the last confirmed method
   * needs a proof in the body, and answers `403` without one — see
   * `MfaService.removeMethod`.
   */
  @Delete(':id')
  @Throttled('mfa-proof')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async remove(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body() body: MfaProofDto,
  ): Promise<void> {
    await this.mfa.removeMethod(actor.userId, id as MfaMethodId, proofOf(body));
  }

  /**
   * The login half of {@link MfaController.webAuthnVerify}: one `401` for
   * every refusal, the renewal cookie set, and the same body a password
   * sign-in returns.
   *
   * @throws UnauthorizedException for every refusal this ceremony can produce
   */
  private async finishWebAuthnLogin(
    caller: WebAuthnCaller,
    body: WebAuthnVerifyDto,
    client: ClientContext,
    response: Response,
  ): Promise<AuthResponseDto> {
    return MfaController.flattenRefusals(async () => {
      // No proof: a sign-in adds a factor to nothing, and a `proof` the body
      // carried is not read, so it cannot be a way to make a login refuse.
      const done = await this.webauthn.verify(caller, body.response, body.label, null, client);
      if (done.purpose !== WebAuthnCeremonyPurpose.LOGIN) throw new InternalServerErrorException();

      REFRESH_COOKIE.set(response, done.completion.credentials.refreshToken);

      // **Inside the wrapper, and after the cookie rather than before it.**
      // The session exists by this point, so this read is the last thing that
      // can go wrong on a sign-in that has already succeeded — and a
      // `UserNotFoundError` escaping here would answer `404` to somebody
      // holding a live session, which is both a wrong answer and one no other
      // refusal on this route gives. It cannot happen while the account the
      // challenge named still exists, and it is wrapped because "cannot
      // happen" is a claim about today's code.
      const user = await this.auth.userOf(done.completion.userId);
      return {
        user: user.toJSON(),
        accessToken: done.completion.credentials.accessToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      };
    });
  }

  /**
   * Runs one leg of a WebAuthn **login** and answers every refusal it can
   * produce with the one `401` `POST /auth/mfa/verify` gives.
   *
   * The argument is `AuthController.verifyMfa`'s and
   * `MfaChallengeService`'s: a caller who has not yet authenticated is owed
   * none of the distinction between a challenge that never existed, one that
   * expired, one already spent, an account holding no passkey, a passkey
   * belonging to somebody else and an assertion that did not verify. Each is a
   * way of learning something about an account from outside it.
   *
   * **The list is that method's, less one.**
   * `RecoveryCodeAlreadyConsumedError` is missing because nothing on this path
   * spends a recovery code — a passkey ceremony has no second proof to offer —
   * so catching it would be catching something unreachable. `UserNotFoundError`
   * is here because {@link MfaController.finishWebAuthnLogin} reads the account
   * **inside** this wrapper, after the session is already open: left uncaught,
   * a vanished row would answer `404` to somebody now holding live credentials.
   * `AuthController.verifyMfa` reads the account inside its own `try` for that
   * same reason, and catches that same error.
   *
   * **Only the login legs go through here.** The enrollment legs keep their own
   * answers — a `409` for a credential already registered, a `422` for a label
   * that is blank — because that caller is authenticated and working on their
   * own account, and none of it tells them anything they could not find out
   * themselves. Which leg a request is was fixed by the credential it carried,
   * so this is not a judgement about its contents.
   *
   * `NotFoundException` for an absent WebAuthn is not caught: it is an
   * `HttpException` rather than a domain error, and it says something about the
   * deployment rather than about an account.
   *
   * @throws UnauthorizedException for each of the six domain refusals
   */
  private static async flattenRefusals<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (
        error instanceof MfaChallengeNotFoundError
        || error instanceof MfaChallengeExpiredError
        || error instanceof MfaChallengeAlreadyConsumedError
        || error instanceof MfaMethodNotFoundError
        || error instanceof MfaVerificationFailedError
        || error instanceof UserNotFoundError
      ) {
        throw new UnauthorizedException({ messageKey: 'errors.auth.mfa_verification_failed' });
      }
      throw error;
    }
  }

  /**
   * Reads the two credentials off the request and hands them to
   * `webAuthnCallerOf`, which decides.
   *
   * **`sessionPresented` is the presence of the `Authorization` header, not
   * the presence of an actor.** The two differ only on a request whose
   * credential did not verify, and {@link OptionalJwtAuthGuard} has already
   * refused that one — so this reads the header in order to keep "carried
   * both" a fact about the request rather than about what a guard made of it.
   * If that guard were ever loosened, this line is what still refuses a
   * request that sent a broken token alongside a challenge. The two layers are
   * independent, so a test reading outcomes sees nothing when only one gives
   * way — which is why `a session credential that does not verify` in
   * `webauthn/__tests__/webauthn.spec.ts` shows this line's work by loosening
   * both at once. That block also pins the guard's delegation directly, and
   * that case reds on its own; nothing anywhere reds for a weakening of *this*
   * line alone, which is the reason for the warning below.
   *
   * **Do not "simplify" this to read the actor**, and be warned that the
   * obvious way of doing so does not even look broken. `@nestjs/passport`
   * writes `request.user = false` — not `undefined` — when a strategy refuses,
   * so `actor !== undefined` is *true* for a credential that failed, and a
   * rewrite using it appears to preserve the behaviour. Only
   * `actor?.userId !== undefined` reveals the change, and what it turns this
   * endpoint into is a login minted from a request that carried a broken
   * session credential alongside a challenge token.
   */
  private static callerOf(
    actor: AuthenticatedActor | undefined,
    request: Request,
    challengeToken: string | undefined,
  ): WebAuthnCaller {
    return webAuthnCallerOf({
      sessionPresented: request.get('authorization') !== undefined,
      actorId: actor?.userId,
      challengeToken,
    });
  }
}
