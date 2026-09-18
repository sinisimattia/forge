import { makeSessionJSON } from '__FORGE_SCOPE__/core/auth/testing';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';

describe('makeSessionJSON', () => {
  it('defaults to a session that was never ended early', () => {
    expect(makeSessionJSON().revokedAt).toBeNull();
  });

  it('defaults to a session last used at the instant it began', () => {
    expect(makeSessionJSON().lastUsedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('defaults to a week-long session', () => {
    expect(makeSessionJSON().expiresAt).toBe('2026-01-08T00:00:00.000Z');
  });

  it('defaults to knowing nothing about the client', () => {
    expect(makeSessionJSON().clientAddress).toBeNull();
    expect(makeSessionJSON().clientLabel).toBeNull();
  });

  it('lets an override win over the default', () => {
    const json = makeSessionJSON({
      id: 'session-9' as SessionId,
      revokedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(json.id).toBe('session-9');
    expect(json.revokedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(json.expiresAt).toBe('2026-01-08T00:00:00.000Z');
  });
});
