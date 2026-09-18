import { DomainError } from '__FORGE_SCOPE__/core/shared/errors';
import {
  DisplayNameRequiredError,
  EmailAlreadyRegisteredError,
  EmailRequiredError,
  InvalidEmailError,
  UserNotFoundError,
} from '__FORGE_SCOPE__/core/users/errors';

const CASES: ReadonlyArray<[string, DomainError, string]> = [
  ['DisplayNameRequiredError', new DisplayNameRequiredError(), 'A display name is required.'],
  [
    'EmailAlreadyRegisteredError',
    new EmailAlreadyRegisteredError(),
    'An account already exists for that address.',
  ],
  ['EmailRequiredError', new EmailRequiredError(), 'An email address is required.'],
  ['InvalidEmailError', new InvalidEmailError('ada'), '"ada" is not a usable email address.'],
  ['UserNotFoundError', new UserNotFoundError('user-9'), 'No user with id "user-9".'],
];

describe('users errors', () => {
  it.each(CASES)('%s extends DomainError, so a caller can catch broadly', (_name, error) => {
    expect(error).toBeInstanceOf(DomainError);
  });

  it.each(CASES)('%s reports its own name, not the base name', (name, error) => {
    expect(error.name).toBe(name);
  });

  it.each(CASES)('%s carries its message', (_name, error, message) => {
    expect(error.message).toBe(message);
  });
});
