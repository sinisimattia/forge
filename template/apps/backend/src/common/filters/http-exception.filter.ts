import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { I18nContext, I18nValidationError, I18nValidationException } from 'nestjs-i18n';
import {
  ConsumedTokenError,
  ExpiredTokenError,
  InvalidCredentialsError,
  SessionNotFoundError,
} from '__FORGE_SCOPE__/core/auth/errors';
import {
  IdentityAlreadyLinkedError,
  IdentityNotFoundError,
  LastIdentityRemovalError,
  WeakPasswordError,
} from '__FORGE_SCOPE__/core/identities/errors';
import { DEFAULT_PASSWORD_POLICY } from '__FORGE_SCOPE__/core/identities/policies';
import type { PasswordPolicyViolation } from '__FORGE_SCOPE__/core/identities/types';
import { DomainError } from '__FORGE_SCOPE__/core/shared/errors';
import {
  DisplayNameRequiredError,
  EmailAlreadyRegisteredError,
  UserNotFoundError,
} from '__FORGE_SCOPE__/core/users/errors';
import { I18nArgs, I18nKey, TranslatableErrorResponse } from '../i18n/i18n.types';

/** A single field-level error detail in the client-facing response shape. */
interface ResponseDetail {
  field: string;
  message: string;
}

/**
 * One reason a password was refused, as a caller receives it.
 *
 * Two fields because two audiences. `code` is core's own
 * `PasswordPolicyViolation`, so a client can switch on it exhaustively — the
 * webapp evaluates the same union and a member added to it becomes a compile
 * error there rather than an unrendered string. `message` is that reason in
 * prose, already translated, so a caller with no knowledge of the union has
 * something to show without inventing wording of its own.
 *
 * Deliberately **not** `details`, which is the field-level shape validation
 * errors use. These are not field-level: the field a password arrives in is
 * `secret` on registration and recovery and `newSecret` on a change, and the
 * domain error knows none of them. Putting them in `details` would mean
 * inventing a field name that is wrong on one endpoint out of three.
 */
interface ResponseViolation {
  /** Core's `PasswordPolicyViolation` member. */
  code: PasswordPolicyViolation;
  /** The same reason, translated. */
  message: string;
}

/**
 * The translation key for every way a password can be refused.
 *
 * A `Record` keyed by the union rather than a template string, and the
 * difference is the whole point: `` `errors.auth.password.${violation}` `` reads
 * fine and silently emits a raw key as the user-facing message the day the union
 * grows a member with no translation behind it. This map does not compile
 * without every member — and the union grew one two rounds ago (`BREACHED`), so
 * that is a live hazard and not a hypothetical.
 *
 * `__tests__/http-exception.filter.spec.ts` carries the other half: that each of
 * these keys resolves to real prose in `i18n/en/errors.json`, which the compiler
 * cannot see.
 */
const PASSWORD_VIOLATION_KEYS: Record<PasswordPolicyViolation, I18nKey> = {
  TOO_SHORT: 'errors.auth.password.TOO_SHORT',
  TOO_LONG: 'errors.auth.password.TOO_LONG',
  NEEDS_MIXED_CASE: 'errors.auth.password.NEEDS_MIXED_CASE',
  NEEDS_DIGIT: 'errors.auth.password.NEEDS_DIGIT',
  BREACHED: 'errors.auth.password.BREACHED',
};

/**
 * The numbers the password messages interpolate.
 *
 * Read from the same constant the judgement was made against
 * (`AuthService` applies `DEFAULT_PASSWORD_POLICY`), so a deployment that
 * changes its policy changes what people are told in the same edit. A literal
 * here would be a second copy of a number, and the failure would be a message
 * telling somebody to use twelve characters when the rule now says sixteen.
 */
const POLICY_ARGS: I18nArgs = {
  minLength: DEFAULT_PASSWORD_POLICY.minLength,
  maxLength: DEFAULT_PASSWORD_POLICY.maxLength,
};

/**
 * How a refusal the domain expressed becomes a status and a message.
 *
 * **Without this table every one of these is a `500`**, because a `DomainError`
 * is not an `HttpException` and falls through to the internal-error branch
 * below. That is not a cosmetic difference: a person presenting a verification
 * link twice, or renewing with a credential that has lapsed, is doing something
 * ordinary, and answering it with "an unexpected error occurred" tells them —
 * and whoever is watching the error rate — that the server is broken.
 *
 * `message` is always a translation key, never `error.message`. A domain error's
 * own message is written for a developer reading a log and can name identifiers
 * (`No session with id "..."`); none of it reaches a response.
 *
 * The order matters where one error extends another; today none of them do, and
 * the first match wins either way.
 *
 * ## `code`, and why a status is not enough
 *
 * Each row also carries a stable, machine-readable name that goes into the
 * response as `code`. **It is what makes this API's refusals implementable by a
 * caller, and its absence was a real defect rather than a missing nicety.**
 * `ConsumedTokenError` and `ExpiredTokenError` share `410` on purpose, three
 * different errors share `404`, and three more share `409`; the only other thing
 * that distinguished any of them was `message`, which is translated prose and
 * therefore changes with the reader's language. A caller obliged to honour
 * `IAuthService.verifyEmail` — which names both token errors — could not.
 *
 * It is deliberately not the class name. A class is renamed by a refactor and a
 * wire contract is not, so these are written out as their own vocabulary and a
 * rename that wants to change one has to come here and say so.
 */
const DOMAIN_ERRORS: {
  type: new (...args: never[]) => DomainError;
  status: HttpStatus;
  messageKey: I18nKey;
  code: string;
}[] = [
  // 401, not 403: the caller has not proven who they are, rather than having
  // been found not to be allowed.
  { type: InvalidCredentialsError, status: HttpStatus.UNAUTHORIZED, messageKey: 'errors.auth.invalid_credentials', code: 'INVALID_CREDENTIALS' },
  // 410 Gone for both, and two different keys. The statuses match because only
  // somebody who held a real credential can reach either, so telling them apart
  // reveals nothing to a guesser and is the difference between "try again" and
  // "you already did this". The two `code`s are what let a caller act on that
  // difference; without them the status is all a caller has and the distinction
  // this pair exists to draw is invisible outside the server.
  { type: ConsumedTokenError, status: HttpStatus.GONE, messageKey: 'errors.auth.token_consumed', code: 'TOKEN_CONSUMED' },
  { type: ExpiredTokenError, status: HttpStatus.GONE, messageKey: 'errors.auth.token_expired', code: 'TOKEN_EXPIRED' },
  // 404, which is what it means at every call site but one: no session the
  // caller may see answers to that id. The renewal endpoint turns it into a 401
  // itself, because there it means the credential presented is dead — see
  // `AuthController.refreshSession`.
  { type: SessionNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.auth.session_not_found', code: 'SESSION_NOT_FOUND' },
  { type: WeakPasswordError, status: HttpStatus.UNPROCESSABLE_ENTITY, messageKey: 'errors.auth.weak_password', code: 'WEAK_PASSWORD' },
  { type: UserNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.http.not_found', code: 'USER_NOT_FOUND' },
  { type: IdentityNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.http.not_found', code: 'IDENTITY_NOT_FOUND' },
  // 422 and a code, rather than falling through to the unnamed-domain-error
  // branch below. A blank display name is the one refusal `PATCH /users/me` can
  // raise from the domain, and a caller that had to infer it from "a 422 on this
  // path" would be reading the route rather than the answer.
  { type: DisplayNameRequiredError, status: HttpStatus.UNPROCESSABLE_ENTITY, messageKey: 'errors.http.unprocessable', code: 'DISPLAY_NAME_REQUIRED' },
  { type: EmailAlreadyRegisteredError, status: HttpStatus.CONFLICT, messageKey: 'errors.http.conflict', code: 'EMAIL_ALREADY_REGISTERED' },
  { type: IdentityAlreadyLinkedError, status: HttpStatus.CONFLICT, messageKey: 'errors.http.conflict', code: 'IDENTITY_ALREADY_LINKED' },
  { type: LastIdentityRemovalError, status: HttpStatus.CONFLICT, messageKey: 'errors.http.conflict', code: 'LAST_IDENTITY_REMOVAL' },
];

/**
 * Every code this API can emit, sorted, as a value.
 *
 * It exists so that the copy of this vocabulary the webapp has to keep
 * (`apps/webapp/app/types/api.ts`) can be pinned against a literal list on each
 * side. The two apps share no package a wire code could live in — it is
 * transport vocabulary, so `libs/core` may not hold it (ADR-0008) — and nothing
 * else would notice the copies drifting: the webapp's own conformance stub emits
 * the strings the webapp switches on, so a rename there keeps the webapp
 * internally consistent and makes it externally wrong, silently.
 *
 * Derived from the table rather than written out again, so that a row added
 * without a matching literal in this module's spec turns that spec red.
 */
export const DOMAIN_ERROR_CODES: readonly string[] = DOMAIN_ERRORS
  .map((entry) => entry.code)
  .sort((left, right) => left.localeCompare(right));

/**
 * The codes this API emits **with a `401`**.
 *
 * Derived rather than written out, and exported for one reason: the webapp's
 * `createAuthFetch` renews a session on a `401` and must not do so for a `401`
 * that answers the *request* rather than the credential. It tells them apart by
 * `code !== undefined`, which is correct only while two things hold — a
 * framework `401` carries no code (it takes this filter's generic branch), and
 * the domain names exactly one 401. Neither was asserted anywhere, and a rule
 * resting on an unasserted invariant is the same defect one level down: the next
 * 401 added to the table above would silently change what the webapp's transport
 * does to it.
 *
 * So this list exists to be pinned, in this file's own spec, against a literal.
 * It is the only reason it is exported.
 */
export const UNAUTHORIZED_DOMAIN_ERROR_CODES: readonly string[] = DOMAIN_ERRORS
  .filter((entry) => entry.status === HttpStatus.UNAUTHORIZED)
  .map((entry) => entry.code)
  .sort((left, right) => left.localeCompare(right));

/** Generic fallback translation key for framework-originated HTTP statuses. */
const HTTP_STATUS_FALLBACK_KEY: Record<number, I18nKey> = {
  [HttpStatus.BAD_REQUEST]: 'errors.http.bad_request',
  [HttpStatus.UNAUTHORIZED]: 'errors.http.unauthorized',
  [HttpStatus.FORBIDDEN]: 'errors.http.forbidden',
  [HttpStatus.NOT_FOUND]: 'errors.http.not_found',
  [HttpStatus.CONFLICT]: 'errors.http.conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'errors.http.unprocessable',
};

/**
 * Global exception filter that produces the standard
 * `{ error, message, code?, details? }` response. All user-facing text is resolved through `nestjs-i18n` using the
 * request-scoped `I18nContext`:
 * - `I18nValidationException` (from `I18nValidationPipe`) → translated per-field details.
 * - `HttpException` carrying a `TranslatableErrorResponse` (`messageKey`) → translated message.
 * - Any other `HttpException` (framework-originated) → generic translated message for its status.
 * - `DomainError` from `__FORGE_SCOPE__/core` → the status and key `DOMAIN_ERRORS` gives it,
 *   or `422` for one it does not name. A refusal the domain expressed is a
 *   statement about the request, not a fault, and must never answer `500`.
 *   `WeakPasswordError` additionally carries a `violations` array — see
 *   {@link ResponseViolation}.
 * - Anything else → translated internal-error message.
 *
 * The `error` field stays the canonical HTTP reason phrase (a protocol-level
 * identifier derived from the status code), not localized prose.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const i18n = I18nContext.current(host);

    const translate = (key: I18nKey, args?: I18nArgs): string =>
      i18n ? i18n.translate(key, { args }) : key;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string;
    let details: ResponseDetail[] | undefined;
    let violations: ResponseViolation[] | undefined;
    let errorOverride: string | undefined;
    let code: string | undefined;

    if (exception instanceof I18nValidationException) {
      status = exception.getStatus();
      message = translate('errors.common.validation_failed');
      details = this.flattenValidationErrors(exception.errors);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const translatable = this.asTranslatable(exceptionResponse);

      if (translatable) {
        message = translate(translatable.messageKey, translatable.args);
        errorOverride = translatable.error;
        if (translatable.details?.length) {
          details = translatable.details.map((detail) => ({
            field: detail.field,
            message: translate(detail.messageKey, detail.args),
          }));
        }
      } else {
        message = translate(HTTP_STATUS_FALLBACK_KEY[status] ?? 'errors.http.internal');
      }
    } else if (exception instanceof DomainError) {
      const mapped = DOMAIN_ERRORS.find((entry) => exception instanceof entry.type);
      // 422 for a domain error this table does not name, NOT 500. A refusal the
      // domain expressed is a statement about the request; the alternative is
      // that every core error added in a later phase silently becomes an
      // internal-server-error until somebody notices, which is the failure this
      // whole branch exists to stop.
      status = mapped?.status ?? HttpStatus.UNPROCESSABLE_ENTITY;
      message = translate(mapped?.messageKey ?? 'errors.http.unprocessable');
      // Absent for a domain error this table does not name, which is the
      // truthful answer: there is no stable name to give it yet. A caller then
      // sees the 422 and no code, and treats it as a refusal it does not
      // understand — which is what it is.
      code = mapped?.code;

      // The list core built, rendered. `WeakPasswordError` carries every way a
      // password fell short precisely so a caller can show a person all of them
      // at once — core's own comment says the list "is what a caller shows the
      // person" — and for a phase this filter dropped it, so the person was told
      // only that something was wrong with a password they could not see.
      //
      // When there is exactly one, it becomes the message. That is a rule rather
      // than a special case for `BREACHED`, and it generalises: a single-reason
      // refusal is the common one, and "Use at least 12 characters" is a better
      // sentence than "does not meet this deployment's requirements" whatever the
      // reason happens to be. Several reasons keep the summary, because there is
      // no one sentence to promote and `violations` carries them all.
      if (exception instanceof WeakPasswordError) {
        violations = exception.violations.map((violation) => ({
          code: violation,
          message: translate(PASSWORD_VIOLATION_KEYS[violation], POLICY_ARGS),
        }));
        if (violations.length === 1) message = violations[0].message;
      }
    } else {
      message = translate('errors.common.internal');
    }

    const error = errorOverride ?? this.reasonPhrase(status);

    response.status(status).json({
      error,
      message,
      ...(code ? { code } : {}),
      ...(details ? { details } : {}),
      ...(violations ? { violations } : {}),
    });
  }

  /** Narrows an exception response body to our translatable payload, if it is one. */
  private asTranslatable(
    exceptionResponse: string | object,
  ): TranslatableErrorResponse | undefined {
    if (
      typeof exceptionResponse === 'object'
      && exceptionResponse !== null
      && typeof (exceptionResponse as Record<string, unknown>).messageKey === 'string'
    ) {
      return exceptionResponse as TranslatableErrorResponse;
    }
    return undefined;
  }

  /** Flattens (already-translated) validation errors into `{ field, message }`, using dotted paths for nested fields. */
  private flattenValidationErrors(
    errors: I18nValidationError[],
    parentPath = '',
  ): ResponseDetail[] {
    const details: ResponseDetail[] = [];
    for (const error of errors) {
      const field = parentPath ? `${parentPath}.${error.property}` : error.property;
      const messages = Object.values(error.constraints ?? {});
      if (messages.length) {
        details.push({ field, message: messages.join(', ') });
      }
      if (error.children?.length) {
        details.push(...this.flattenValidationErrors(error.children, field));
      }
    }
    return details;
  }

  /** Canonical HTTP reason phrase for a status code (e.g. 404 → "Not Found"). */
  private reasonPhrase(status: number): string {
    const key = HttpStatus[status];
    if (!key) {
      return 'Error';
    }
    return key
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
