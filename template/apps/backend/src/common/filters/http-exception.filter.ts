import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { I18nContext, I18nValidationError, I18nValidationException } from 'nestjs-i18n';
import { I18nArgs, I18nKey, TranslatableErrorResponse } from '../i18n/i18n.types';

/** A single field-level error detail in the client-facing response shape. */
interface ResponseDetail {
  field: string;
  message: string;
}

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
