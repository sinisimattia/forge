import {
  ConsumedTokenError,
  ExpiredTokenError,
  InvalidCredentialsError,
  SessionLifetimeError,
  SessionNotFoundError,
} from '__FORGE_SCOPE__/core/auth/errors';
import { DomainError } from '__FORGE_SCOPE__/core/shared/errors';

const AN_INSTANT = new Date('2026-01-01T00:00:00.000Z');

const CASES: ReadonlyArray<[string, DomainError, string]> = [
  [
    'ConsumedTokenError',
    new ConsumedTokenError(),
    'That token has already been used.',
  ],
  [
    'ExpiredTokenError',
    new ExpiredTokenError(),
    'That token is no longer valid. Ask for a new one.',
  ],
  [
    'InvalidCredentialsError',
    new InvalidCredentialsError(),
    'The secret offered does not match the one on record.',
  ],
  [
    'SessionLifetimeError',
    new SessionLifetimeError(AN_INSTANT, AN_INSTANT, AN_INSTANT),
    'A session must end after it begins and cannot have been used before it began; '
    + 'got createdAt 2026-01-01T00:00:00.000Z, lastUsedAt 2026-01-01T00:00:00.000Z, '
    + 'expiresAt 2026-01-01T00:00:00.000Z.',
  ],
  [
    'SessionNotFoundError',
    new SessionNotFoundError('session-9'),
    'No session with id "session-9".',
  ],
];

describe('auth errors', () => {
  it.each(CASES)('%s extends DomainError, so a caller can catch broadly', (_name, error) => {
    expect(error).toBeInstanceOf(DomainError);
  });

  it.each(CASES)('%s reports its own name, not the base name', (name, error) => {
    expect(error.name).toBe(name);
  });

  it.each(CASES)('%s carries its message', (_name, error, message) => {
    expect(error.message).toBe(message);
  });

  // The two token failures are told apart on purpose — only somebody who held a
  // real one can reach either — so they must not be the same class.
  it('tells a used token apart from one that is no longer valid', () => {
    expect(new ConsumedTokenError()).not.toBeInstanceOf(ExpiredTokenError);
    expect(new ExpiredTokenError()).not.toBeInstanceOf(ConsumedTokenError);
  });
});
