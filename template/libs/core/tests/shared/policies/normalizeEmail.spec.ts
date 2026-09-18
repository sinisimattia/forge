import { normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';

describe('normalizeEmail', () => {
  it('lowercases and trims, so two spellings are one identity', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('leaves an already-normal address untouched', () => {
    expect(normalizeEmail('ada@example.com')).toBe('ada@example.com');
  });

  it('does not strip internal whitespace, which would silently accept a typo', () => {
    expect(normalizeEmail('ada @example.com')).toBe('ada @example.com');
  });
});
