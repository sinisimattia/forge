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
import { DomainError } from '__FORGE_SCOPE__/core/shared/errors';
import {
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
 */
const DOMAIN_ERRORS: {
  type: new (...args: never[]) => DomainError;
  status: HttpStatus;
  messageKey: I18nKey;
}[] = [
  // 401, not 403: the caller has not proven who they are, rather than having
  // been found not to be allowed.
  { type: InvalidCredentialsError, status: HttpStatus.UNAUTHORIZED, messageKey: 'errors.auth.invalid_credentials' },
  // 410 Gone for both, and two different keys. The statuses match because only
  // somebody who held a real credential can reach either, so telling them apart
  // reveals nothing to a guesser and is the difference between "try again" and
  // "you already did this".
  { type: ConsumedTokenError, status: HttpStatus.GONE, messageKey: 'errors.auth.token_consumed' },
  { type: ExpiredTokenError, status: HttpStatus.GONE, messageKey: 'errors.auth.token_expired' },
  // 404, which is what it means at every call site but one: no session the
  // caller may see answers to that id. The renewal endpoint turns it into a 401
  // itself, because there it means the credential presented is dead — see
  // `AuthController.refreshSession`.
  { type: SessionNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.auth.session_not_found' },
  { type: WeakPasswordError, status: HttpStatus.UNPROCESSABLE_ENTITY, messageKey: 'errors.auth.weak_password' },
  { type: UserNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.http.not_found' },
  { type: IdentityNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.http.not_found' },
  { type: EmailAlreadyRegisteredError, status: HttpStatus.CONFLICT, messageKey: 'errors.http.conflict' },
  { type: IdentityAlreadyLinkedError, status: HttpStatus.CONFLICT, messageKey: 'errors.http.conflict' },
  { type: LastIdentityRemovalError, status: HttpStatus.CONFLICT, messageKey: 'errors.http.conflict' },
];

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
 * Global exception filter that produces the standard `{ error, message, details? }`
 * response. All user-facing text is resolved through `nestjs-i18n` using the
 * request-scoped `I18nContext`:
 * - `I18nValidationException` (from `I18nValidationPipe`) → translated per-field details.
 * - `HttpException` carrying a `TranslatableErrorResponse` (`messageKey`) → translated message.
 * - Any other `HttpException` (framework-originated) → generic translated message for its status.
 * - `DomainError` from `__FORGE_SCOPE__/core` → the status and key `DOMAIN_ERRORS` gives it,
 *   or `422` for one it does not name. A refusal the domain expressed is a
 *   statement about the request, not a fault, and must never answer `500`.
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
    let errorOverride: string | undefined;

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

      // One refusal type, two messages. `WeakPasswordError` now carries every
      // reason a password was refused, including `BREACHED` — which used to be a
      // transport-level `BadRequestException` of its own, so "this password is
      // not acceptable" had two different response shapes depending on why, and
      // the two code paths that did not handle the second one simply never asked
      // the question. Collapsing them to one error type is what let the check be
      // applied on recovery and on a deliberate change as well as on
      // registration; keeping the specific message here is what stops that
      // collapse costing a person the only sentence that tells them what to do.
      //
      // `BREACHED` is never mixed with the other four: `AuthService` asks the
      // registry only after `evaluatePassword` has passed, so this branch is
      // reached with a list of exactly one.
      if (exception instanceof WeakPasswordError && exception.violations.includes('BREACHED')) {
        message = translate('errors.auth.secret_is_public');
      }
    } else {
      message = translate('errors.common.internal');
    }

    const error = errorOverride ?? this.reasonPhrase(status);

    response.status(status).json({
      error,
      message,
      ...(details ? { details } : {}),
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
