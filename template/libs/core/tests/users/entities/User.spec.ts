import { User } from '__FORGE_SCOPE__/core/users/entities';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import {
  DisplayNameRequiredError,
  EmailRequiredError,
  InvalidEmailError,
} from '__FORGE_SCOPE__/core/users/errors';
import type { UserId, UserJSON, UserProps } from '__FORGE_SCOPE__/core/users/types';

const VERIFIED_AT = new Date('2026-01-02T03:04:05.000Z');
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-03T00:00:00.000Z');
const DELETED_AT = new Date('2026-02-01T00:00:00.000Z');

function makeProps(overrides: Partial<UserProps> = {}): UserProps {
  return {
    id: 'user-1' as UserId,
    email: 'ada@example.com',
    displayName: 'Ada',
    status: UserStatus.ACTIVE,
    platformRole: PlatformRole.PLATFORM_USER,
    emailVerifiedAt: VERIFIED_AT,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  };
}

describe('User', () => {
  describe('constructor', () => {
    it('normalizes the address, so a padded, mixed-case form is one identity', () => {
      const padded = new User(makeProps({ email: '  Ada@Example.COM ' }));
      const plain = new User(makeProps({ email: 'ada@example.com' }));
      expect(padded.email).toBe('ada@example.com');
      expect(padded.email).toBe(plain.email);
    });

    it('trims the display name', () => {
      expect(new User(makeProps({ displayName: '  Ada Lovelace  ' })).displayName)
        .toBe('Ada Lovelace');
    });

    it.each([['', 'empty'], ['   ', 'blank']])(
      'throws EmailRequiredError for an %s address (%s)',
      (email) => {
        expect(() => new User(makeProps({ email }))).toThrow(EmailRequiredError);
      },
    );

    it.each(['ada', 'ada@', '@example.com', 'a@b@c', 'ada @example.com'])(
      'throws InvalidEmailError for %s',
      (email) => {
        expect(() => new User(makeProps({ email }))).toThrow(InvalidEmailError);
      },
    );

    it('names the offending value in the InvalidEmailError message', () => {
      expect(() => new User(makeProps({ email: 'ada' })))
        .toThrow('"ada" is not a usable email address.');
    });

    it('throws DisplayNameRequiredError for a blank display name', () => {
      expect(() => new User(makeProps({ displayName: '  ' }))).toThrow(DisplayNameRequiredError);
    });
  });

  describe('isEmailVerified', () => {
    it('is false while the instant is null', () => {
      expect(new User(makeProps({ emailVerifiedAt: null })).isEmailVerified).toBe(false);
    });

    it('is true once the instant is set', () => {
      expect(new User(makeProps({ emailVerifiedAt: VERIFIED_AT })).isEmailVerified).toBe(true);
    });
  });

  describe('isDeleted', () => {
    it('is false while the instant is null', () => {
      expect(new User(makeProps({ deletedAt: null })).isDeleted).toBe(false);
    });

    it('is true once the instant is set', () => {
      expect(new User(makeProps({ deletedAt: DELETED_AT })).isDeleted).toBe(true);
    });
  });

  describe('canAuthenticate', () => {
    it('is true for an active, verified, undeleted account', () => {
      expect(new User(makeProps()).canAuthenticate()).toBe(true);
    });

    it('is false while the address is unproven', () => {
      expect(new User(makeProps({ emailVerifiedAt: null })).canAuthenticate()).toBe(false);
    });

    it('is false while the account is suspended', () => {
      expect(new User(makeProps({ status: UserStatus.SUSPENDED })).canAuthenticate()).toBe(false);
    });

    it('is false once the account is deleted', () => {
      expect(new User(makeProps({ deletedAt: DELETED_AT })).canAuthenticate()).toBe(false);
    });
  });

  describe('toJSON / fromJSON', () => {
    it('round-trips every field, and every instant survives as an equal Date', () => {
      const original = new User(makeProps({
        platformRole: PlatformRole.PLATFORM_ADMIN,
        status: UserStatus.SUSPENDED,
        deletedAt: DELETED_AT,
      }));
      const revived = User.fromJSON(original.toJSON());

      expect(revived).toBeInstanceOf(User);
      expect(revived.id).toBe(original.id);
      expect(revived.email).toBe(original.email);
      expect(revived.displayName).toBe(original.displayName);
      expect(revived.status).toBe(original.status);
      expect(revived.platformRole).toBe(original.platformRole);
      expect(revived.emailVerifiedAt).toEqual(VERIFIED_AT);
      expect(revived.createdAt).toEqual(CREATED_AT);
      expect(revived.updatedAt).toEqual(UPDATED_AT);
      expect(revived.deletedAt).toEqual(DELETED_AT);
    });

    it('writes instants as ISO-8601 strings', () => {
      const json = new User(makeProps({ deletedAt: DELETED_AT })).toJSON();
      expect(json.emailVerifiedAt).toBe('2026-01-02T03:04:05.000Z');
      expect(json.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(json.updatedAt).toBe('2026-01-03T00:00:00.000Z');
      expect(json.deletedAt).toBe('2026-02-01T00:00:00.000Z');
    });

    it('preserves a null emailVerifiedAt and a null deletedAt in both directions', () => {
      const json = new User(makeProps({ emailVerifiedAt: null, deletedAt: null })).toJSON();
      expect(json.emailVerifiedAt).toBeNull();
      expect(json.deletedAt).toBeNull();

      const revived = User.fromJSON(json);
      expect(revived.emailVerifiedAt).toBeNull();
      expect(revived.deletedAt).toBeNull();
    });

    it('re-runs every invariant, so a blank display name is rejected on the way back in', () => {
      const json: UserJSON = { ...new User(makeProps()).toJSON(), displayName: '' };
      expect(() => User.fromJSON(json)).toThrow(DisplayNameRequiredError);
    });
  });
});
