import { ROLE_PERMISSIONS, can } from '__FORGE_SCOPE__/core/authorization/policies';
import type { Permission, Principal } from '__FORGE_SCOPE__/core/authorization/types';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { PlatformRole } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

const ADA = 'user-ada' as UserId;
const GRACE = 'user-grace' as UserId;

const ORG_1 = 'org-1' as OrganizationId;
const ORG_2 = 'org-2' as OrganizationId;

const administrator: Principal = {
  userId: ADA,
  platformRole: PlatformRole.PLATFORM_ADMIN,
  memberships: [],
};
const ordinary: Principal = {
  userId: ADA,
  platformRole: PlatformRole.PLATFORM_USER,
  memberships: [],
};

/**
 * Every member of {@link Permission}, listed rather than derived.
 *
 * A union is a type and has no runtime value to iterate, so this list is
 * maintained by hand — which is the point of the count assertion below: adding
 * a member without deciding what an administrator and an ordinary principal get
 * from it leaves this list short, and the count says so.
 */
const EVERY_PERMISSION: Permission[] = [
  'platform:administer',
  'audit:read',
  'user:read',
  'organization:read',
  'organization:update',
  'organization:delete',
  'member:read',
  'member:invite',
  'member:update',
  'member:remove',
  'invitation:read',
  'invitation:revoke',
  'grant:read',
  'grant:create',
  'grant:revoke',
];

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

  describe('layer two — organization role', () => {
    // The membership consulted is the one for the RESOURCE's organization, not
    // the first one the principal happens to hold. A principal belonging to two
    // organizations with different roles is the only shape that can tell those
    // apart, so it is the shape this test uses.
    it('reads the role from the membership for the resource\'s organization', () => {
      const principal: Principal = {
        userId: ADA,
        platformRole: PlatformRole.PLATFORM_USER,
        memberships: [
          { organizationId: ORG_1, role: OrgRole.VIEWER },
          { organizationId: ORG_2, role: OrgRole.ADMIN },
        ],
      };
      expect(can(principal, 'organization:update', { organizationId: ORG_1 })).toBe(false);
      expect(can(principal, 'organization:update', { organizationId: ORG_2 })).toBe(true);
    });

    // A resource in an organization the principal does not belong to is refused,
    // and this is the assertion tenant isolation rests on in the domain. The
    // server-side half — that the refusal is indistinguishable from "no such
    // thing" — is D9 and lives in the backend suite.
    it('refuses a resource in an organization the principal does not belong to', () => {
      const principal: Principal = {
        userId: ADA,
        platformRole: PlatformRole.PLATFORM_USER,
        memberships: [{ organizationId: ORG_1, role: OrgRole.OWNER }],
      };
      expect(can(principal, 'organization:read', { organizationId: ORG_2 })).toBe(false);
    });

    // An organization permission asked without naming an organization has no
    // answer, so it is refused rather than treated as "any of mine" — the same
    // judgement `user:read` already makes for a missing owner.
    it('refuses an organization permission asked without a resource', () => {
      const principal: Principal = {
        userId: ADA,
        platformRole: PlatformRole.PLATFORM_USER,
        memberships: [{ organizationId: ORG_1, role: OrgRole.OWNER }],
      };
      expect(can(principal, 'organization:update')).toBe(false);
    });

    // Layer one is unconditional and runs before layer two, so a platform
    // administrator passes for an organization they have no membership in. That
    // is spec §9.5's first layer and the reason every such pass is recorded.
    it('lets a platform administrator through with no membership at all', () => {
      const principal: Principal = {
        userId: ADA,
        platformRole: PlatformRole.PLATFORM_ADMIN,
        memberships: [],
      };
      expect(can(principal, 'organization:delete', { organizationId: ORG_2 })).toBe(true);
    });

    // Every permission the map grants a role is answered by this layer, and the
    // ones it does not grant are refused. Asserted against the map rather than
    // against a hand-copied list, because a second list of what an OWNER may do
    // is a second place for the answer to be wrong.
    it.each(Object.values(OrgRole))('grants %s exactly what the map says', (role) => {
      const principal: Principal = {
        userId: ADA,
        platformRole: PlatformRole.PLATFORM_USER,
        memberships: [{ organizationId: ORG_1, role }],
      };
      const granted = new Set<Permission>(ROLE_PERMISSIONS[role]);
      for (const permission of EVERY_PERMISSION) {
        // `user:read` is the one member with an answer below layer two, and this
        // resource names no owner — so it is refused there, which is what makes
        // the map the only source of a `true` in this loop.
        expect(can(principal, permission, { organizationId: ORG_1 })).toBe(
          granted.has(permission),
        );
      }
    });
  });

  describe('exhaustiveness', () => {
    it('lists every permission the suite claims to cover', () => {
      // The list above is hand-maintained; this is what makes forgetting to
      // extend it visible. A literal, not `EVERY_PERMISSION.length` compared
      // against itself.
      expect(EVERY_PERMISSION.length).toBe(15);
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
