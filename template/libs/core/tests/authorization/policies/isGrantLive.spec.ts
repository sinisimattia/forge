import { isGrantLive } from '__FORGE_SCOPE__/core/authorization/policies';
import type {
  GrantId,
  ResourceGrant,
  ResourceType,
} from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

/** An instant, written as a date so the assertions read as a calendar. */
function AT(iso: string): Date {
  return new Date(iso);
}

const GRANT: ResourceGrant = {
  id: 'grant-1' as GrantId,
  subjectUserId: 'user-ada' as UserId,
  organizationId: 'org-1' as OrganizationId,
  resourceType: 'document' as ResourceType,
  resourceId: 'record-1',
  permission: 'organization:update',
  grantedBy: 'user-grace' as UserId,
  createdAt: AT('2026-01-01T00:00:00.000Z'),
  expiresAt: null,
};

describe('isGrantLive', () => {
  // The instant is a parameter. `can` must stay pure — the same principal and
  // resource returning the same answer is what makes it callable from both
  // sides of the wire — so the clock lives here, where the caller supplies it,
  // and the hydrator is what applies it.
  it('is live while unexpired, and a null expiry never lapses', () => {
    expect(isGrantLive({ ...GRANT, expiresAt: null }, AT('2099-01-01T00:00:00.000Z'))).toBe(true);
    expect(isGrantLive({ ...GRANT, expiresAt: AT('2026-02-01T00:00:00.000Z') },
      AT('2026-01-31T00:00:00.000Z'))).toBe(true);
    expect(isGrantLive({ ...GRANT, expiresAt: AT('2026-02-01T00:00:00.000Z') },
      AT('2026-02-01T00:00:00.000Z'))).toBe(false);
  });

  // The boundary to the millisecond, asserted on both sides of it. An
  // implementation using `<=` where this uses `<` passes the day-apart
  // assertions above and fails only here, which is the reason the two instants
  // are one millisecond apart rather than a day.
  it('lapses at its expiry and not a millisecond later', () => {
    const expiresAt = AT('2026-02-01T00:00:00.000Z');
    const grant = { ...GRANT, expiresAt };
    expect(isGrantLive(grant, new Date(expiresAt.getTime() - 1))).toBe(true);
    expect(isGrantLive(grant, expiresAt)).toBe(false);
    expect(isGrantLive(grant, new Date(expiresAt.getTime() + 1))).toBe(false);
  });

  // The same judgement `Invitation.isExpiredAt` makes, stated here as its own
  // assertion: two things that lapse in this domain must not disagree about
  // what their last moment was.
  it('reads nothing but the expiry and the instant it is given', () => {
    const expiresAt = AT('2026-02-01T00:00:00.000Z');
    // A grant created after its own expiry is nonsense a store could still hold,
    // and it is still simply expired — the rule is about the two instants it is
    // given and not about the grant's own history.
    expect(isGrantLive(
      { ...GRANT, createdAt: AT('2026-03-01T00:00:00.000Z'), expiresAt },
      AT('2026-01-01T00:00:00.000Z'),
    )).toBe(true);
  });
});
