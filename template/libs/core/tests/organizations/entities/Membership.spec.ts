import { Membership } from '__FORGE_SCOPE__/core/organizations/entities';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type {
  MembershipId,
  MembershipProps,
  OrganizationId,
} from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

function makeProps(overrides: Partial<MembershipProps> = {}): MembershipProps {
  return {
    id: 'membership-1' as MembershipId,
    organizationId: 'org-1' as OrganizationId,
    userId: 'user-1' as UserId,
    role: OrgRole.MEMBER,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

describe('Membership', () => {
  describe('isOwner', () => {
    // Looped over the enum's own members, rather than three literals, so a
    // fifth role added later is covered without anyone remembering to.
    it.each(Object.values(OrgRole))('is %s only for OWNER', (role) => {
      const membership = new Membership(makeProps({ role }));
      expect(membership.isOwner).toBe(role === OrgRole.OWNER);
    });
  });

  it('carries the ids as their branded values', () => {
    const membership = new Membership(makeProps());
    expect(membership.id).toBe('membership-1');
    expect(membership.organizationId).toBe('org-1');
    expect(membership.userId).toBe('user-1');
  });

  describe('toJSON', () => {
    it('renders instants as ISO-8601 strings and carries every other field', () => {
      const json = new Membership(makeProps({ role: OrgRole.ADMIN })).toJSON();
      expect(json).toEqual({
        id: 'membership-1',
        organizationId: 'org-1',
        userId: 'user-1',
        role: OrgRole.ADMIN,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      });
    });
  });

  describe('fromJSON', () => {
    it('round-trips through its wire shape with every instant revived', () => {
      const original = new Membership(makeProps({ role: OrgRole.OWNER }));
      const revived = Membership.fromJSON(original.toJSON());
      expect(revived).toBeInstanceOf(Membership);
      expect(revived.createdAt).toBeInstanceOf(Date);
      expect(revived.createdAt.toISOString()).toBe(CREATED_AT.toISOString());
      expect(revived.updatedAt.toISOString()).toBe(UPDATED_AT.toISOString());
      expect(revived.toJSON()).toEqual(original.toJSON());
    });
  });
});
