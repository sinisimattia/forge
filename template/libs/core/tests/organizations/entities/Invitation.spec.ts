import { Invitation } from '__FORGE_SCOPE__/core/organizations/entities';
import { InvitationStatus, OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type {
  InvitationId,
  InvitationProps,
  OrganizationId,
} from '__FORGE_SCOPE__/core/organizations/types';
import { EmailRequiredError } from '__FORGE_SCOPE__/core/users/errors';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

const CREATED_AT = new Date('2026-01-25T00:00:00.000Z');
const EXPIRES_AT = new Date('2026-02-01T00:00:00.000Z');

function makeProps(overrides: Partial<InvitationProps> = {}): InvitationProps {
  return {
    id: 'invitation-1' as InvitationId,
    organizationId: 'org-1' as OrganizationId,
    email: '  Ada@Example.COM ',
    role: OrgRole.MEMBER,
    status: InvitationStatus.PENDING,
    invitedByUserId: 'user-1' as UserId,
    expiresAt: EXPIRES_AT,
    createdAt: CREATED_AT,
    acceptedAt: null,
    acceptedByUserId: null,
    ...overrides,
  };
}

describe('Invitation', () => {
  it('holds the address in normal form, so a lookup by address finds it', () => {
    expect(new Invitation(makeProps()).email).toBe('ada@example.com');
  });

  it('refuses an address that is absent or only whitespace', () => {
    expect(() => new Invitation(makeProps({ email: '   ' }))).toThrow(EmailRequiredError);
  });

  // Expiry is derived from the instant, never stored as a status. A stored
  // EXPIRED would be a fact that becomes true while nothing is running, so every
  // read would have to repair the row before trusting it — and the read path is
  // exactly where that repair gets forgotten.
  describe('isExpiredAt', () => {
    it('derives expiry from the instant it is asked about', () => {
      const invitation = new Invitation(makeProps());
      expect(invitation.isExpiredAt(new Date('2026-01-31T23:59:59.000Z'))).toBe(false);
      expect(invitation.isExpiredAt(new Date('2026-02-01T00:00:00.000Z'))).toBe(true);
      expect(invitation.isExpiredAt(new Date('2026-02-02T00:00:00.000Z'))).toBe(true);
    });
  });

  // The boundary is worth pinning in both directions: `expiresAt` is the first
  // instant at which it is expired, not the last at which it is open.
  describe('isOpenAt', () => {
    const before = new Date('2026-01-26T00:00:00.000Z');
    const after = new Date('2026-03-01T00:00:00.000Z');

    it('is true while PENDING and unexpired', () => {
      expect(new Invitation(makeProps()).isOpenAt(before)).toBe(true);
    });

    it('is false once expired, even while PENDING', () => {
      expect(new Invitation(makeProps()).isOpenAt(after)).toBe(false);
    });

    it.each([InvitationStatus.ACCEPTED, InvitationStatus.REVOKED])(
      'is false for %s regardless of expiry',
      (status) => {
        expect(new Invitation(makeProps({ status })).isOpenAt(before)).toBe(false);
      },
    );
  });

  it('carries the ids as their branded values', () => {
    const invitation = new Invitation(makeProps());
    expect(invitation.id).toBe('invitation-1');
    expect(invitation.organizationId).toBe('org-1');
    expect(invitation.invitedByUserId).toBe('user-1');
  });

  // `invitedByUserId` may be null once the inviter's account has since been
  // deleted — the invitation outlives the account that made it, the same rule
  // `acceptedByUserId` already follows. This is the entity accepting that
  // value at all; `toJSON`/`fromJSON` below cover it surviving the wire.
  it('accepts a null invitedByUserId, for an inviter whose account has since been deleted', () => {
    const invitation = new Invitation(makeProps({ invitedByUserId: null }));
    expect(invitation.invitedByUserId).toBeNull();
  });

  describe('toJSON', () => {
    it('renders instants as ISO-8601 strings and carries every other field', () => {
      const json = new Invitation(makeProps()).toJSON();
      expect(json).toEqual({
        id: 'invitation-1',
        organizationId: 'org-1',
        email: 'ada@example.com',
        role: OrgRole.MEMBER,
        status: InvitationStatus.PENDING,
        invitedByUserId: 'user-1',
        expiresAt: '2026-02-01T00:00:00.000Z',
        createdAt: '2026-01-25T00:00:00.000Z',
        acceptedAt: null,
        acceptedByUserId: null,
      });
    });

    it('renders acceptedAt and acceptedByUserId once the invitation has been accepted', () => {
      const json = new Invitation(
        makeProps({
          status: InvitationStatus.ACCEPTED,
          acceptedAt: new Date('2026-01-26T00:00:00.000Z'),
          acceptedByUserId: 'user-2' as UserId,
        }),
      ).toJSON();
      expect(json.acceptedAt).toBe('2026-01-26T00:00:00.000Z');
      expect(json.acceptedByUserId).toBe('user-2');
    });

    it('renders invitedByUserId as null once the inviter\'s account has been deleted', () => {
      const json = new Invitation(makeProps({ invitedByUserId: null })).toJSON();
      expect(json.invitedByUserId).toBeNull();
    });
  });

  describe('fromJSON', () => {
    it('round-trips through its wire shape with every instant revived', () => {
      const original = new Invitation(makeProps());
      const revived = Invitation.fromJSON(original.toJSON());
      expect(revived).toBeInstanceOf(Invitation);
      expect(revived.expiresAt).toBeInstanceOf(Date);
      expect(revived.expiresAt.toISOString()).toBe(EXPIRES_AT.toISOString());
      expect(revived.createdAt.toISOString()).toBe(CREATED_AT.toISOString());
      expect(revived.acceptedAt).toBeNull();
      expect(revived.toJSON()).toEqual(original.toJSON());
    });

    it('round-trips a null invitedByUserId, for an inviter whose account has since been deleted', () => {
      const original = new Invitation(makeProps({ invitedByUserId: null }));
      const revived = Invitation.fromJSON(original.toJSON());
      expect(revived.invitedByUserId).toBeNull();
    });

    it('revives acceptedAt as a Date when the invitation has been accepted', () => {
      const original = new Invitation(
        makeProps({
          status: InvitationStatus.ACCEPTED,
          acceptedAt: new Date('2026-01-26T00:00:00.000Z'),
          acceptedByUserId: 'user-2' as UserId,
        }),
      );
      const revived = Invitation.fromJSON(original.toJSON());
      expect(revived.acceptedAt).toBeInstanceOf(Date);
      expect(revived.acceptedAt?.toISOString()).toBe('2026-01-26T00:00:00.000Z');
      expect(revived.toJSON()).toEqual(original.toJSON());
    });
  });
});
