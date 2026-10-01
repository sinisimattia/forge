import { DomainError, TooManyAttemptsError } from '__FORGE_SCOPE__/core/shared/errors';

describe('TooManyAttemptsError', () => {
  it('is a DomainError, so a broad catch sees it', () => {
    expect(new TooManyAttemptsError(900)).toBeInstanceOf(DomainError);
  });

  it('carries how long the caller must wait', () => {
    expect(new TooManyAttemptsError(900).retryAfterSeconds).toBe(900);
  });

  it('names itself, so a log says which invariant was violated', () => {
    expect(new TooManyAttemptsError(900).name).toBe('TooManyAttemptsError');
  });
});
