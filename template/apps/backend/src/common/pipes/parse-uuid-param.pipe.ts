import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';
import { TranslatableErrorResponse } from '../i18n/i18n.types';

/**
 * Shared `ParseUUIDPipe` instance for path parameters. Overrides the framework's
 * hard-coded English failure message with a translation key so that even
 * malformed-UUID errors are localized by the global `HttpExceptionFilter`.
 *
 * Use in place of the bare `ParseUUIDPipe` class:
 * `@Param('id', ParseUuidParamPipe) id: string`.
 */
export const ParseUuidParamPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException({
      messageKey: 'errors.common.invalid_uuid',
    } satisfies TranslatableErrorResponse),
});
