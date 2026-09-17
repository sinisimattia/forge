import { Path } from 'nestjs-i18n';

/**
 * Dot-notation translation key (e.g. `'errors.common.not_found'`). Once a real
 * translation namespace exists, `nestjs-i18n`'s `typesOutputPath` option can
 * generate a concrete shape to type this against instead of `Record<string,
 * unknown>`, so a misspelled key fails `tsc` — see `docs/standards/i18n.md`.
 */
export type I18nKey = Path<Record<string, unknown>>;

/**
 * Arguments interpolated into a translation string's `{placeholder}` tokens.
 * Restricted to primitives that render unambiguously into text.
 */
export type I18nArgs = Record<string, string | number>;

/**
 * Payload thrown inside a NestJS HTTP exception instead of literal text. The
 * global `HttpExceptionFilter` detects `messageKey`, resolves it through
 * `nestjs-i18n`, and builds the localized error response. Keeps services
 * i18n-agnostic: they reference a key, never a translated string.
 */
export interface TranslatableErrorResponse {
  /** Translation key for the human-readable error message. */
  messageKey: I18nKey;
  /** Optional interpolation arguments for the message template. */
  args?: I18nArgs;
  /**
   * Optional override for the response `error` field. When omitted the filter
   * uses the canonical HTTP reason phrase derived from the status code.
   */
  error?: string;
  /** Optional field-level details (e.g. multi-field business-rule violations). */
  details?: TranslatableDetail[];
}

/**
 * A single field-level error detail expressed as a translation key, resolved by
 * the filter into the client-facing `{ field, message }` shape.
 */
export interface TranslatableDetail {
  /** Name of the offending input field. */
  field: string;
  /** Translation key for this field's message. */
  messageKey: I18nKey;
  /** Optional interpolation arguments for the message template. */
  args?: I18nArgs;
}

/**
 * Base shape for a successful service result whose user-facing `message` must be
 * localized. The service sets `messageKey` (+ optional `messageArgs`); the
 * global `I18nResponseInterceptor` translates it into a `message` field at the
 * HTTP boundary and strips the key fields from the response.
 */
export interface TranslatableResult {
  /** Translation key for the success/info message. */
  messageKey: I18nKey;
  /** Optional interpolation arguments for the message template. */
  messageArgs?: I18nArgs;
}
