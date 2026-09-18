import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import { SessionLifetimeError } from '__FORGE_SCOPE__/core/auth/errors';
import { makeSessionJSON } from '__FORGE_SCOPE__/core/auth/testing';
import type { SessionId, SessionProps } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

const BEGAN = new Date('2026-01-01T00:00:00.000Z');
const ENDS = new Date('2026-01-08T00:00:00.000Z');

function makeProps(overrides: Partial<SessionProps> = {}): SessionProps {
  return {
    id: 'session-1' as SessionId,
    userId: 'user-1' as UserId,
    createdAt: BEGAN,
    lastUsedAt: BEGAN,
    expiresAt: ENDS,
    revokedAt: null,
    clientAddress: null,
    clientLabel: null,
    ...overrides,
  };
}

describe('Session', () => {
  describe('the period it describes', () => {
    it('accepts a session that ends after it begins', () => {
      expect(new Session(makeProps()).expiresAt).toEqual(ENDS);
    });

    it('rejects one that ends before it begins', () => {
      expect(() => new Session(makeProps({ expiresAt: new Date(BEGAN.getTime() - 1) })))
        .toThrow(SessionLifetimeError);
    });

    // The instant itself, not just earlier: a session with no duration at all is
    // one nobody could ever have used.
    it('rejects one that ends at the instant it begins', () => {
      expect(() => new Session(makeProps({ expiresAt: BEGAN })))
        .toThrow(SessionLifetimeError);
    });

    it('rejects one last used before it began', () => {
      expect(() => new Session(makeProps({ lastUsedAt: new Date(BEGAN.getTime() - 1) })))
        .toThrow(SessionLifetimeError);
    });

    it('accepts one last used at the instant it began', () => {
      expect(new Session(makeProps({ lastUsedAt: BEGAN })).lastUsedAt).toEqual(BEGAN);
    });

    it('names all three instants, so whichever is wrong is visible', () => {
      expect(() => new Session(makeProps({ expiresAt: BEGAN })))
        .toThrow(/createdAt 2026-01-01T00:00:00\.000Z.*expiresAt 2026-01-01T00:00:00\.000Z/);
    });
  });

  describe('isActive', () => {
    it('is active a millisecond before it ends', () => {
      expect(new Session(makeProps()).isActive(new Date(ENDS.getTime() - 1))).toBe(true);
    });

    // The boundary, stated the one way that leaves no instant whose membership
    // depends on which comparison a reader happens to write.
    it('is not active at the instant it ends', () => {
      expect(new Session(makeProps()).isActive(ENDS)).toBe(false);
    });

    it('is not active after it ends', () => {
      expect(new Session(makeProps()).isActive(new Date(ENDS.getTime() + 1))).toBe(false);
    });

    it('is not active once it has been ended early, though it has not run out', () => {
      const session = new Session(makeProps({ revokedAt: new Date('2026-01-02T00:00:00.000Z') }));
      expect(session.isActive(new Date('2026-01-03T00:00:00.000Z'))).toBe(false);
    });
  });

  describe('what it carries', () => {
    // A session is the fact that somebody is signed in; whatever they present to
    // demonstrate it belongs to whoever carries the demonstration. There is no
    // field for one here, so no list of sessions can leak one.
    it('has exactly the eight documented properties and no more', () => {
      expect(Object.keys(new Session(makeProps())).sort()).toEqual([
        'clientAddress',
        'clientLabel',
        'createdAt',
        'expiresAt',
        'id',
        'lastUsedAt',
        'revokedAt',
        'userId',
      ]);
    });

    it('serializes exactly the eight documented keys and no more', () => {
      expect(Object.keys(new Session(makeProps()).toJSON()).sort()).toEqual([
        'clientAddress',
        'clientLabel',
        'createdAt',
        'expiresAt',
        'id',
        'lastUsedAt',
        'revokedAt',
        'userId',
      ]);
    });
  });

  describe('toJSON', () => {
    it('renders instants as ISO-8601 strings', () => {
      const json = new Session(makeProps({
        lastUsedAt: new Date('2026-01-02T03:04:05.000Z'),
        revokedAt: new Date('2026-01-03T04:05:06.000Z'),
      })).toJSON();
      expect(json.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(json.lastUsedAt).toBe('2026-01-02T03:04:05.000Z');
      expect(json.expiresAt).toBe('2026-01-08T00:00:00.000Z');
      expect(json.revokedAt).toBe('2026-01-03T04:05:06.000Z');
    });

    it('renders a session that was never ended early with a null revokedAt', () => {
      expect(new Session(makeProps()).toJSON().revokedAt).toBeNull();
    });

    it('carries what was known about the client, and the nulls where nothing was', () => {
      const json = new Session(makeProps({
        clientAddress: '198.51.100.7',
        clientLabel: 'a client',
      })).toJSON();
      expect(json.clientAddress).toBe('198.51.100.7');
      expect(json.clientLabel).toBe('a client');
      expect(new Session(makeProps()).toJSON().clientLabel).toBeNull();
    });
  });

  describe('fromJSON', () => {
    it('revives the instants as dates', () => {
      const session = Session.fromJSON(makeSessionJSON({
        lastUsedAt: '2026-01-02T03:04:05.000Z',
        revokedAt: '2026-01-03T04:05:06.000Z',
      }));
      expect(session.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(session.lastUsedAt).toEqual(new Date('2026-01-02T03:04:05.000Z'));
      expect(session.revokedAt).toEqual(new Date('2026-01-03T04:05:06.000Z'));
    });

    it('revives a session that was never ended early with a null revokedAt', () => {
      expect(Session.fromJSON(makeSessionJSON()).revokedAt).toBeNull();
    });

    it('re-runs every invariant, so a row whose instants are impossible is rejected', () => {
      expect(() => Session.fromJSON(makeSessionJSON({
        expiresAt: '2025-12-31T00:00:00.000Z',
      }))).toThrow(SessionLifetimeError);
    });

    // The row is deliberately spelled another way; the entity built from it is
    // canonical. This is the property the conformance suite's wire-shape test
    // leans on to tell a rebuilt entity from a store's own row.
    it('rewrites an instant stored in some other spelling of the same moment', () => {
      const session = Session.fromJSON(makeSessionJSON({
        createdAt: '2026-01-01T00:00:00+00:00',
      }));
      expect(session.toJSON().createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('carries every field of a row back out through toJSON', () => {
      const json = makeSessionJSON({
        id: 'session-7' as SessionId,
        userId: 'user-7' as UserId,
        createdAt: '2026-05-06T07:08:09.000Z',
        lastUsedAt: '2026-05-07T08:09:10.000Z',
        expiresAt: '2026-05-13T07:08:09.000Z',
        revokedAt: '2026-05-08T09:10:11.000Z',
        clientAddress: '203.0.113.9',
        clientLabel: 'a client',
      });
      expect(Session.fromJSON(json).toJSON()).toEqual(json);
    });
  });
});
