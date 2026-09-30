import {
  MfaChallengeAlreadyConsumedError,
  MfaChallengeExpiredError,
  MfaChallengeNotFoundError,
  MfaLabelRequiredError,
  MfaMethodAlreadyConfirmedError,
  MfaMethodNotFoundError,
  MfaReauthenticationRequiredError,
  MfaVerificationFailedError,
  RecoveryCodeAlreadyConsumedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import { DomainError } from '__FORGE_SCOPE__/core/shared/errors';

const CASES: ReadonlyArray<[string, DomainError, string]> = [
  [
    'MfaChallengeAlreadyConsumedError',
    new MfaChallengeAlreadyConsumedError('challenge-9'),
    'Challenge "challenge-9" has already been consumed.',
  ],
  [
    'MfaChallengeExpiredError',
    new MfaChallengeExpiredError('challenge-9'),
    'Challenge "challenge-9" has expired.',
  ],
  [
    'MfaChallengeNotFoundError',
    new MfaChallengeNotFoundError('challenge-9'),
    'No challenge with id "challenge-9".',
  ],
  [
    'MfaLabelRequiredError',
    new MfaLabelRequiredError(),
    'A method needs a label to tell it apart from another of the same kind.',
  ],
  [
    'MfaMethodAlreadyConfirmedError',
    new MfaMethodAlreadyConfirmedError('method-9'),
    'Method "method-9" is already confirmed.',
  ],
  [
    'MfaMethodNotFoundError',
    new MfaMethodNotFoundError('method-9'),
    'No method with id "method-9".',
  ],
  [
    'MfaReauthenticationRequiredError',
    new MfaReauthenticationRequiredError(),
    'Removing this method requires a fresh proof of the second factor.',
  ],
  [
    'MfaVerificationFailedError',
    new MfaVerificationFailedError(),
    'The proof offered does not verify.',
  ],
  [
    'RecoveryCodeAlreadyConsumedError',
    new RecoveryCodeAlreadyConsumedError(),
    'That recovery code has already been used.',
  ],
];

describe('mfa errors', () => {
  it.each(CASES)('%s extends DomainError, so a caller can catch broadly', (_name, error) => {
    expect(error).toBeInstanceOf(DomainError);
  });

  it.each(CASES)('%s reports its own name, not the base name', (name, error) => {
    expect(error.name).toBe(name);
  });

  it.each(CASES)('%s carries its message', (_name, error, message) => {
    expect(error.message).toBe(message);
  });

  // The two challenge failures are told apart on purpose — see
  // MfaChallengeService's own TSDoc on why the distinction is recorded but
  // never shown to whoever presented the token — so they must not be the
  // same class as one another or as "not found".
  it('tells an expired challenge apart from one that was already consumed', () => {
    expect(new MfaChallengeExpiredError('c-1')).not.toBeInstanceOf(MfaChallengeAlreadyConsumedError);
    expect(new MfaChallengeAlreadyConsumedError('c-1')).not.toBeInstanceOf(MfaChallengeExpiredError);
  });
});
