import { ROLE_PERMISSIONS, can } from '__FORGE_SCOPE__/core/authorization/policies';
import type {
  GrantId,
  Permission,
  Principal,
  ResourceGrant,
  ResourceType,
} from '__FORGE_SCOPE__/core/authorization/types';
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
  grants: [],
};
const ordinary: Principal = {
  userId: ADA,
  platformRole: PlatformRole.PLATFORM_USER,
  memberships: [],
  grants: [],
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

const DOC = 'document' as ResourceType;
const SPREADSHEET = 'spreadsheet' as ResourceType;
const RECORD = 'record-1';

/**
 * A grant for ADA on one record of ORG_1, to build the layer-three cases on.
 *
 * `expiresAt: null` throughout, and no assertion below varies it. `can` never
 * reads it — a clock would make the function impure — so a grant in a
 * principal's hands is one the hydrator already found live. `isGrantLive.spec`
 * is where the expiry rule is asserted.
 */
const GRANT: ResourceGrant = {
  id: 'grant-1' as GrantId,
  subjectUserId: ADA,
  organizationId: ORG_1,
  resourceType: DOC,
  resourceId: RECORD,
  permission: 'organization:update',
  grantedBy: GRACE,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: null,
};

/** A VIEWER of ORG_1 — the weakest role — holding the grants given. */
function viewerHolding(...grants: ResourceGrant[]): Principal {
  return {
    userId: ADA,
    platformRole: PlatformRole.PLATFORM_USER,
    memberships: [{ organizationId: ORG_1, role: OrgRole.VIEWER }],
    grants,
  };
}

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
        grants: [],
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
        grants: [],
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
        grants: [],
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
        grants: [],
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
        grants: [],
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

  describe('layer three — resource grant', () => {
    // A grant names one organization and one record. This is the assertion that
    // stops it widening: the same grant, asked about the same record id in a
    // DIFFERENT organization, must not answer true. Spec §9.5 states it as
    // "grants never widen into another tenant", and without this assertion an
    // implementation matching on the record id alone passes every other test
    // here — two tenants are free to issue the same id.
    it('never lets a grant reach into another tenant', () => {
      const principal: Principal = {
        userId: ADA,
        platformRole: PlatformRole.PLATFORM_USER,
        // A VIEWER of BOTH, so the only thing that differs between the two asks
        // below is the organization the grant names. A principal belonging to
        // one of them would be refused by layer two in the other, and this test
        // would pass without layer three having a rule at all.
        memberships: [
          { organizationId: ORG_1, role: OrgRole.VIEWER },
          { organizationId: ORG_2, role: OrgRole.VIEWER },
        ],
        grants: [GRANT],
      };
      expect(can(principal, 'organization:update', {
        organizationId: ORG_1,
        resourceType: DOC,
        resourceId: RECORD,
      })).toBe(true);
      expect(can(principal, 'organization:update', {
        organizationId: ORG_2,
        resourceType: DOC,
        resourceId: RECORD,
      })).toBe(false);
    });

    // A carried finding, and the reason it stopped being
    // cosmetic. Layer two's `return false` for "no membership here" was pinned
    // by nothing while every organization permission was refused by the switch
    // anyway. Layer three is a route to `true` that runs after it, so folding
    // that refusal into the `if` above it now means a grant authorizes somebody
    // who is not a member of the organization at all — which is precisely what
    // spec §9.5 says cannot happen, "because `can()` requires the resource's
    // `organizationId` to match the principal's membership".
    it('refuses a matching grant to a principal with no membership there', () => {
      const principal: Principal = {
        userId: ADA,
        platformRole: PlatformRole.PLATFORM_USER,
        // Belongs to ORG_2 only. The grant below names ORG_1 and matches the
        // ask in every other respect, so membership is the only thing left to
        // refuse it.
        memberships: [{ organizationId: ORG_2, role: OrgRole.VIEWER }],
        grants: [GRANT],
      };
      expect(can(principal, 'organization:update', {
        organizationId: ORG_1,
        resourceType: DOC,
        resourceId: RECORD,
      })).toBe(false);
      // The same grant, the same everything, for a principal who does belong —
      // so the refusal above is about the membership and not about some other
      // mismatch that would have refused it anyway.
      expect(can(viewerHolding(GRANT), 'organization:update', {
        organizationId: ORG_1,
        resourceType: DOC,
        resourceId: RECORD,
      })).toBe(true);
    });

    // **This pins ORDERING, not additivity — read the name narrowly.** A VIEWER
    // reads their organization by role, so layer two has already returned `true`
    // before layer three is reached, and layer three could do anything at all
    // without this assertion noticing. What it does catch is a layer three moved
    // ABOVE the role check, or one that pre-empted it.
    //
    // The other half of "additive only" — that layer three's `false` is not an
    // answer and the layers BELOW it still get to speak — is a different shape
    // entirely and is the assertion immediately following this one. Neither
    // covers the other.
    it('does not take away what the role already allowed', () => {
      const about = { organizationId: ORG_1, resourceType: DOC, resourceId: RECORD };
      expect(can(viewerHolding(), 'organization:read', about)).toBe(true);
      expect(can(viewerHolding({ ...GRANT, resourceId: 'record-9' }), 'organization:read', about))
        .toBe(true);
    });

    // Layer three is not authoritative: finding no matching grant is not an
    // answer of `false`, it is no answer, and the switch below still gets to
    // give one. `user:read` is the shape that proves it — no role carries it, so
    // layer two never short-circuits, and the ownership rule in the switch is
    // what permits a person to read their own profile. A resource that names
    // BOTH an owner and a record walks the whole way past layer three to reach
    // it, and that call shape becomes ordinary once a client
    // starts asking about concrete records.
    //
    // Turning layer three's `if (granted) return true;` into `return granted;`
    // is what this exists to catch: a mutation that silently REVOKES the
    // ownership rule for any resource naming a record, and that every other
    // assertion in this file survives.
    it('lets the rules below it answer when no grant matches', () => {
      // Their own profile, asked with a record named alongside it.
      const about = {
        organizationId: ORG_1,
        ownerId: ADA,
        resourceType: DOC,
        resourceId: RECORD,
      };
      // Holding no grant at all...
      expect(can(viewerHolding(), 'user:read', about)).toBe(true);
      // ...and holding one that simply does not match this record, which is the
      // same "no" from layer three by a different route.
      expect(can(viewerHolding({ ...GRANT, resourceId: 'record-9' }), 'user:read', about))
        .toBe(true);
      // And the rule below is still a rule: somebody else's profile is refused,
      // so the two assertions above are the ownership rule answering rather than
      // anything permitting `user:read` wholesale.
      expect(can(viewerHolding(), 'user:read', { ...about, ownerId: GRACE })).toBe(false);
    });

    // All four of organization, type, id and permission must match. Three
    // assertions, each varying exactly one of the last three, because an
    // implementation matching on two of them passes any test that varies none.
    // The organization is varied by the cross-tenant test above.
    it('requires the type, the id and the permission all to match', () => {
      const principal = viewerHolding(GRANT);
      expect(can(principal, 'organization:update', {
        organizationId: ORG_1,
        resourceType: SPREADSHEET,
        resourceId: RECORD,
      })).toBe(false);
      expect(can(principal, 'organization:update', {
        organizationId: ORG_1,
        resourceType: DOC,
        resourceId: 'record-9',
      })).toBe(false);
      // `member:remove` is carried by no role a VIEWER holds either, so the only
      // thing that could have permitted it is the grant — which is for
      // `organization:update`.
      expect(can(principal, 'member:remove', {
        organizationId: ORG_1,
        resourceType: DOC,
        resourceId: RECORD,
      })).toBe(false);
    });

    // A type with no id names every record of that kind, and an id with no type
    // names an id in a namespace nobody stated. Neither is a record, so neither
    // reaches a grant — a caller that half-hydrated its resource gets a refusal
    // rather than an answer about a record it did not name.
    it('consults no grant for a resource that half-names a record', () => {
      const principal = viewerHolding(GRANT);
      expect(can(principal, 'organization:update', {
        organizationId: ORG_1,
        resourceType: DOC,
      })).toBe(false);
      expect(can(principal, 'organization:update', {
        organizationId: ORG_1,
        resourceId: RECORD,
      })).toBe(false);
    });

    // The one thing this layer is not additive about. `platform:administer` is
    // layer one's alone — no role carries it, which `ROLE_PERMISSIONS.spec`
    // asserts — and grants are issued under `grant:create`, an organization
    // permission an ADMIN holds. Without the exclusion, somebody whose
    // authority ends at a tenant could issue the one permission that has none.
    it('never lets a grant confer platform administration', () => {
      const principal = viewerHolding({ ...GRANT, permission: 'platform:administer' });
      expect(can(principal, 'platform:administer', {
        organizationId: ORG_1,
        resourceType: DOC,
        resourceId: RECORD,
      })).toBe(false);
    });

    // `grantedBy` became `UserId | null` once the issuer's account could be
    // deleted out from under a grant. `can` has no business reading it — the
    // decision is about the subject, the record and the permission, never
    // about who issued the exception — so a null issuer must authorize exactly
    // as the same grant with a real one does.
    it('does not read grantedBy — a grant with a null issuer authorizes the same as one with a real one', () => {
      const about = { organizationId: ORG_1, resourceType: DOC, resourceId: RECORD };
      expect(can(viewerHolding({ ...GRANT, grantedBy: null }), 'organization:update', about))
        .toBe(true);
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
