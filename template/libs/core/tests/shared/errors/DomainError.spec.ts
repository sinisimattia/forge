import { DomainError } from '__FORGE_SCOPE__/core/shared/errors';

class ArticleTitleRequiredError extends DomainError {
  public constructor() {
    super('An article requires a title.');
  }
}

describe('DomainError', () => {
  it('lets callers catch narrowly by subclass', () => {
    expect(() => {
      throw new ArticleTitleRequiredError();
    }).toThrow(ArticleTitleRequiredError);
  });

  it('lets callers catch broadly by the base class', () => {
    try {
      throw new ArticleTitleRequiredError();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
    }
  });

  it('reports the subclass name, not the base name', () => {
    expect(new ArticleTitleRequiredError().name).toBe('ArticleTitleRequiredError');
  });

  it('carries the message it was constructed with', () => {
    expect(new ArticleTitleRequiredError().message).toBe('An article requires a title.');
  });
});
