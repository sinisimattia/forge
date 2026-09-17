import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';
import { Observable, map } from 'rxjs';
import { I18nArgs, I18nKey } from '../i18n/i18n.types';

/**
 * Localizes success responses at the HTTP boundary. When a returned object
 * carries a `messageKey` (the `TranslatableResult` shape), it is translated via
 * `nestjs-i18n` into a `message` field and the `messageKey`/`messageArgs` fields
 * are stripped. This keeps services i18n-agnostic while guaranteeing that no
 * literal user-facing text is emitted in response bodies. Objects without a
 * `messageKey` pass through unchanged.
 */
@Injectable()
export class I18nResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => this.localize(data)));
  }

  private localize(data: unknown): unknown {
    if (data === null || typeof data !== 'object') {
      return data;
    }

    const record = data as Record<string, unknown>;
    if (typeof record.messageKey !== 'string') {
      return data;
    }

    const i18n = I18nContext.current();
    const { messageKey, messageArgs, ...rest } = record;
    const message = i18n
      ? i18n.translate(messageKey as I18nKey, { args: messageArgs as I18nArgs })
      : (messageKey as string);

    return { ...rest, message };
  }
}
