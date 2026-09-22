import { looksLikeAnAddress } from '__FORGE_SCOPE__/core/shared/policies';

describe('looksLikeAnAddress', () => {
  it('accepts a plain address', () => {
    expect(looksLikeAnAddress('ada@example.com')).toBe(true);
  });

  it.each(['ada', 'ada@', '@example.com', 'a@b@c', 'ada @example.com'])(
    'rejects %s',
    (value) => {
      expect(looksLikeAnAddress(value)).toBe(false);
    },
  );
});
