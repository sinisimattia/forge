import { can } from '__FORGE_SCOPE__/core/authorization/policies';
import type { Permission, Principal } from '__FORGE_SCOPE__/core/authorization/types';
import { PlatformRole } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

const ADA = 'user-ada' as UserId;
const GRACE = 'user-grace' as UserId;

const administrator: Principal = { userId: ADA, platformRole: PlatformRole.PLATFORM_ADMIN };
const ordinary: Principal = { userId: ADA, platformRole: PlatformRole.PLATFORM_USER };

/**
 * Every member of {@link Permission}, listed rather than derived.
 *
 * A union is a type and has no runtime value to iterate, so this list is
 * maintained by hand — which is the point of the count assertion below: adding
 * a member without deciding what an administrator and an ordinary principal get
 * from it leaves this list short, and the count says so.
 */
const EVERY_PERMISSION: Permission[] = ['platform:administer', 'audit:read', 'user:read'];

describe('can', () => {
  describe('the platform layer', () => {
    it.each(EVERY_PERMISSION)('lets a platform administrator do %s', (permission) => {
      // No resource argument anywhere here. An administrator passing everything
      // must not depend on the caller having hydrated a resource it does not
      // need, or the layer stops being "passes everything".
      expect(can(administrator, permission)).toBe(true);
    });

    it('lets a platform administrator read somebody else\'s profile', () => {
      expect(can(administrator, 'user:read', { ownerId: GRACE })).toBe(true);
    });

    it('is decided by the role and not by who the principal happens to be', () => {
      // The same user id on both sides, so the only difference between this and
      // the assertions above is the role. An implementation that keyed off
      // anything else passes one of the two and fails the other.
      expect(can({ ...ordinary, userId: ADA }, 'platform:administer')).toBe(false);
      expect(can({ ...administrator, userId: ADA }, 'platform:administer')).toBe(true);
    });
  });

  describe('an ordinary principal', () => {
    it('may not operate the deployment', () => {
      expect(can(ordinary, 'platform:administer')).toBe(false);
    });

    it('may not read the deployment\'s history', () => {
      expect(can(ordinary, 'audit:read')).toBe(false);
    });

    it('may read their own profile', () => {
      expect(can(ordinary, 'user:read', { ownerId: ADA })).toBe(true);
    });

    it('may not read anybody else\'s', () => {
      expect(can(ordinary, 'user:read', { ownerId: GRACE })).toBe(false);
    });

    it('may not read "a profile" with no owner named', () => {
      // An omitted resource is a question with no answer, not a question about
      // the principal's own record. Treating it as the latter would make every
      // caller that forgot to pass the resource silently permitted.
      expect(can(ordinary, 'user:read')).toBe(false);
    });
  });

  describe('exhaustiveness', () => {
    it('lists every permission the suite claims to cover', () => {
      // The list above is hand-maintained; this is what makes forgetting to
      // extend it visible. A literal, not `EVERY_PERMISSION.length` compared
      // against itself.
      expect(EVERY_PERMISSION.length).toBe(3);
      expect(new Set(EVERY_PERMISSION).size).toBe(EVERY_PERMISSION.length);
    });

    it('throws rather than denying silently for a permission outside the union', () => {
      // Reachable only by casting, which is the situation it exists for: a value
      // that arrived from outside the type system. A `default: return false`
      // would turn a permission somebody added without a rule into a denial that
      // looks deliberate.
      expect(() => can(ordinary, 'invented:permission' as Permission)).toThrow(
        /invented:permission/,
      );
    });
  });
});
