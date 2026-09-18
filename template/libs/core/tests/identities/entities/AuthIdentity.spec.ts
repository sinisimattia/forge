import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { IdentityAccountIdRequiredError } from '__FORGE_SCOPE__/core/identities/errors';
import { makeAuthIdentityJSON } from '__FORGE_SCOPE__/core/identities/testing';
import type { AuthIdentityId, AuthIdentityProps } from '__FORGE_SCOPE__/core/identities/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

function makeProps(overrides: Partial<AuthIdentityProps> = {}): AuthIdentityProps {
  return {
    id: 'identity-1' as AuthIdentityId,
    userId: 'user-1' as UserId,
    provider: AuthProvider.PASSWORD,
    providerAccountId: 'ada@example.com',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastUsedAt: null,
    ...overrides,
  };
}

describe('AuthIdentity', () => {
  describe('the account identifier', () => {
    it('stores a password account identifier in normal form', () => {
      const identity = new AuthIdentity(makeProps({ providerAccountId: '  Ada@Example.COM ' }));
      expect(identity.providerAccountId).toBe('ada@example.com');
    });

    it('makes two spellings of one address the same password identity', () => {
      const first = new AuthIdentity(makeProps({ providerAccountId: 'Ada@Example.com' }));
      const second = new AuthIdentity(makeProps({ providerAccountId: 'ada@example.com' }));
      expect(first.providerAccountId).toBe(second.providerAccountId);
    });

    it('leaves a federated subject identifier exactly as the provider issued it', () => {
      const identity = new AuthIdentity(makeProps({
        provider: AuthProvider.GOOGLE,
        providerAccountId: '  Subject-90210  ',
      }));
      expect(identity.providerAccountId).toBe('Subject-90210');
    });

    it('rejects a blank password account identifier', () => {
      expect(() => new AuthIdentity(makeProps({ providerAccountId: '   ' })))
        .toThrow(IdentityAccountIdRequiredError);
    });

    it('rejects a blank federated subject identifier', () => {
      expect(() => new AuthIdentity(makeProps({
        provider: AuthProvider.GITHUB,
        providerAccountId: '',
      }))).toThrow(IdentityAccountIdRequiredError);
    });
  });

  describe('what it carries', () => {
    // The structural half of ADR-0005: there is no field for a derivation, a
    // salt or its parameters, so no serialization of an identity can leak one.
    it('has exactly the six documented properties and no more', () => {
      const identity = new AuthIdentity(makeProps());
      expect(Object.keys(identity).sort()).toEqual([
        'createdAt',
        'id',
        'lastUsedAt',
        'provider',
        'providerAccountId',
        'userId',
      ]);
    });

    it('serializes exactly the six documented keys and no more', () => {
      const identity = new AuthIdentity(makeProps());
      expect(Object.keys(identity.toJSON()).sort()).toEqual([
        'createdAt',
        'id',
        'lastUsedAt',
        'provider',
        'providerAccountId',
        'userId',
      ]);
    });
  });

  describe('toJSON', () => {
    it('renders instants as ISO-8601 strings', () => {
      const identity = new AuthIdentity(makeProps({
        createdAt: new Date('2026-03-04T05:06:07.000Z'),
        lastUsedAt: new Date('2026-04-05T06:07:08.000Z'),
      }));
      const json = identity.toJSON();
      expect(json.createdAt).toBe('2026-03-04T05:06:07.000Z');
      expect(json.lastUsedAt).toBe('2026-04-05T06:07:08.000Z');
    });

    it('renders a never-used identity with a null lastUsedAt', () => {
      expect(new AuthIdentity(makeProps({ lastUsedAt: null })).toJSON().lastUsedAt).toBeNull();
    });
  });

  describe('fromJSON', () => {
    it('revives the instants as dates', () => {
      const identity = AuthIdentity.fromJSON(makeAuthIdentityJSON({
        createdAt: '2026-03-04T05:06:07.000Z',
        lastUsedAt: '2026-04-05T06:07:08.000Z',
      }));
      expect(identity.createdAt).toEqual(new Date('2026-03-04T05:06:07.000Z'));
      expect(identity.lastUsedAt).toEqual(new Date('2026-04-05T06:07:08.000Z'));
    });

    it('revives a never-used identity with a null lastUsedAt', () => {
      const identity = AuthIdentity.fromJSON(makeAuthIdentityJSON({ lastUsedAt: null }));
      expect(identity.lastUsedAt).toBeNull();
    });

    it('re-runs every invariant, so a row carrying a blank identifier is rejected', () => {
      expect(() => AuthIdentity.fromJSON(makeAuthIdentityJSON({ providerAccountId: '  ' })))
        .toThrow(IdentityAccountIdRequiredError);
    });

    // The row is deliberately not in normal form; the entity built from it is.
    it('normalizes a password account identifier stored in some other form', () => {
      const identity = AuthIdentity.fromJSON(makeAuthIdentityJSON({
        providerAccountId: ' Ada@Example.COM ',
      }));
      expect(identity.providerAccountId).toBe('ada@example.com');
    });

    it('carries every field of a row back out through toJSON', () => {
      const json = makeAuthIdentityJSON({
        id: 'identity-7' as AuthIdentityId,
        userId: 'user-7' as UserId,
        provider: AuthProvider.OIDC,
        providerAccountId: 'subject-4711',
        createdAt: '2026-05-06T07:08:09.000Z',
        lastUsedAt: '2026-06-07T08:09:10.000Z',
      });
      expect(AuthIdentity.fromJSON(json).toJSON()).toEqual(json);
    });
  });
});
