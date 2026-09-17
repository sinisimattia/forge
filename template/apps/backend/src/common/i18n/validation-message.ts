import { ValidationArguments } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { I18nArgs, I18nKey } from './i18n.types';

/**
 * Builds a class-validator `message` function backed by `nestjs-i18n`, for use on
 * DTO validation decorators. The resulting token is resolved to localized text by
 * `I18nValidationPipe`. Use instead of any literal `message:` string.
 *
 * @example
 * `@IsString({ message: validationMessage('validation.IS_STRING') })`
 */
export function validationMessage(
  key: I18nKey,
  args?: I18nArgs,
): (validationArguments: ValidationArguments) => string {
  return i18nValidationMessage(key, args);
}
