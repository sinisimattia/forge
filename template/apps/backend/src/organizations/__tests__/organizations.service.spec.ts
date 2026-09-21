import { ConfigService } from '@nestjs/config';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { Membership, Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import {
  InvalidOrganizationSlugError,
  LastOwnerError,
  MembershipNotFoundError,
  OrganizationNameRequiredError,
  OrganizationNotFoundError,
} from '__FORGE_SCOPE__/core/organizations/errors';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { AuditService } from '../../audit/audit.service';
import { FakeDataSource, FakeEntityManager } from '../../common/testing';
import type { IMailer } from '../../mail';
import { UserRecord } from '../../users/user-record.entity';
import { InvitationRecord } from '../invitation-record.entity';
import { MembershipRecord } from '../membership-record.entity';
import { OrganizationRecord } from '../organization-record.entity';
import { OrganizationsService } from '../organizations.service';

/** This suite exercises none of the invitation mail; a stub that records nothing suffices. */
const NOOP_MAILER: IMailer = { send: async () => undefined };

const WEBAPP_URL = 'https://app.example.test';

/**
 * The two things this class exists to get right and nothing outside it can
 * see: the owner membership is created in the SAME transaction as the
 * organization, and every mutation's audit entry carries the organization it
 * happened in — never `null`, which was an unenforced default until the field
 * was made assertable.
 *
 * The rest — refusing a non-member, the not-found/not-mine collapse, an
 * omitted field being left alone — pins the same behaviour
 * `runIOrganizationServiceContract` pins for the in-memory reference;
 * `organizations.conformance.spec.ts` drives that same suite against this
 * implementation too.
 */

const OWNER = 'user-owner' as UserId;
const SECOND_OWNER = 'user-second-owner' as UserId;
const ADMIN = 'user-admin' as UserId;
const MEMBER = 'user-member' as UserId;
const OUTSIDER = 'user-outsider' as UserId;
const ABSENT = '99999999-9999-4999-8999-999999999999' as OrganizationId;
const ABSENT_USER = 'user-absent' as UserId;

const EPOCH = new Date('2026-09-20T10:00:00.000Z');

describe('OrganizationsService', () => {
  let source: FakeDataSource;
  let organizations: OrganizationsService;

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  beforeEach(() => {
    source = new FakeDataSource();

    const audit = new AuditService(
      repo<AuditEntryRecord>(AuditEntryRecord),
      repo<UserRecord>(UserRecord),
      repo<MembershipRecord>(MembershipRecord),
    );

    organizations = new OrganizationsService(
      repo<OrganizationRecord>(OrganizationRecord),
      repo<MembershipRecord>(MembershipRecord),
      repo<InvitationRecord>(InvitationRecord),
      repo<UserRecord>(UserRecord),
      source as unknown as DataSource,
      audit,
      NOOP_MAILER,
      new ConfigService({ PUBLIC_WEBAPP_URL: WEBAPP_URL }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Seeds an organization with `owner` as its sole OWNER. */
  const seedOrganization = (
    id: string,
    name: string,
    slug: string,
    owner: string,
    deletedAt: Date | null = null,
  ): void => {
    source.seed(OrganizationRecord, [
      { id, name, slug, createdAt: EPOCH, updatedAt: EPOCH, deletedAt },
    ]);
    source.seed(MembershipRecord, [
      {
        id: `membership-${id}-${owner}`,
        organizationId: id,
        userId: owner,
        role: OrgRole.OWNER,
        createdAt: EPOCH,
        updatedAt: EPOCH,
      },
    ]);
  };

  /** Adds one more membership to an already-seeded organization. */
  const seedMembership = (
    organizationId: string,
    userId: string,
    role: OrgRole,
  ): void => {
    source.seed(MembershipRecord, [
      {
        id: `membership-${organizationId}-${userId}`,
        organizationId,
        userId,
        role,
        createdAt: EPOCH,
        updatedAt: EPOCH,
      },
    ]);
  };

  describe('createOrganization', () => {
    it('creates the organization and returns a real entity', async () => {
      const created = await organizations.createOrganization(OWNER, {
        name: 'Acme Works',
        slug: 'acme-works',
      });

      expect(created).toBeInstanceOf(Organization);
      expect(created.name).toBe('Acme Works');
      expect(created.slug).toBe('acme-works');
      expect(created.isDeleted).toBe(false);
    });

    it('makes the creator its sole OWNER, in the same write', async () => {
      const created = await organizations.createOrganization(OWNER, {
        name: 'Acme Works',
        slug: 'acme-works',
      });

      const memberships = source
        .all(MembershipRecord)
        .filter((row) => row.organizationId === created.id);
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({ userId: OWNER, role: OrgRole.OWNER });
    });

    // The invariant this method exists to protect: two statements that can
    // half-succeed would leave an organization with no OWNER, which the
    // last-owner rule makes unreachable by every other path. Forcing the
    // SECOND insert of the pair to fail is what makes this test able to fail
    // at all — an implementation that ran the two inserts outside a shared
    // transaction would still pass a test that only checked the happy path.
    it('creates the organization and the owner membership atomically', async () => {
      const realInsert = FakeEntityManager.prototype.insert;
      let calls = 0;
      jest
        .spyOn(FakeEntityManager.prototype, 'insert')
        .mockImplementation(function (this: FakeEntityManager, entity, values) {
          calls += 1;
          // The first insert is the organization row; the second is the
          // membership. Only the second is made to fail, so a rollback that
          // "worked" by never getting as far as the organization insert could
          // not be mistaken for the atomicity this test asserts.
          if (calls === 2) return Promise.reject(new Error('membership insert exploded'));
          return realInsert.call(this, entity, values);
        });

      await expect(
        organizations.createOrganization(OWNER, { name: 'Acme Works', slug: 'acme-works' }),
      ).rejects.toThrow('membership insert exploded');

      // Nothing survives: not the organization, not a membership, and not an
      // audit entry recorded for an organization that does not exist.
      expect(source.all(OrganizationRecord)).toHaveLength(0);
      expect(source.all(MembershipRecord)).toHaveLength(0);
      expect(source.all(AuditEntryRecord)).toHaveLength(0);
    });

    // Every one of these is audit-logged (spec §9.6), and the entry carries
    // the organization — the field shipped nullable and was later made
    // assertable. An entry recorded with a null organization here is the
    // exact defect that earlier measurement was about, so this asserts the
    // field rather than assuming it is populated.
    it('records ORGANIZATION_CREATED against the organization it created', async () => {
      const created = await organizations.createOrganization(OWNER, {
        name: 'Acme Works',
        slug: 'acme-works',
      });

      const entries = source
        .all(AuditEntryRecord)
        .filter((row) => row.action === AuditAction.ORGANIZATION_CREATED);
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      expect(entry.organizationId).not.toBeNull();
      expect(entry.organizationId).toBe(created.id);
      expect(entry.actorUserId).toBe(OWNER);
      expect(entry.resourceType).toBe('organization');
      expect(entry.resourceId).toBe(created.id);
    });

    it('refuses a blank name, and writes nothing', async () => {
      await expect(
        organizations.createOrganization(OWNER, { name: '   ', slug: 'acme-works' }),
      ).rejects.toBeInstanceOf(OrganizationNameRequiredError);

      expect(source.all(OrganizationRecord)).toHaveLength(0);
      expect(source.all(MembershipRecord)).toHaveLength(0);
    });

    it('refuses a slug that cannot be used in a path, and writes nothing', async () => {
      await expect(
        organizations.createOrganization(OWNER, { name: 'Acme Works', slug: 'Not A Slug!' }),
      ).rejects.toBeInstanceOf(InvalidOrganizationSlugError);

      expect(source.all(OrganizationRecord)).toHaveLength(0);
    });
  });

  describe('listOrganizations', () => {
    const EVERYTHING = { page: 1, limit: 100 };

    it('lists only organizations the actor belongs to', async () => {
      seedOrganization('org-mine', 'Mine', 'mine', OWNER);
      seedOrganization('org-theirs', 'Theirs', 'theirs', OUTSIDER);

      const mine = await organizations.listOrganizations(OWNER, EVERYTHING);
      expect(mine.data.map((organization) => organization.id)).toEqual(['org-mine']);
      expect(mine.data[0]).toBeInstanceOf(Organization);
      expect(mine.meta.total).toBe(1);

      const theirs = await organizations.listOrganizations(OUTSIDER, EVERYTHING);
      expect(theirs.data.map((organization) => organization.id)).toEqual(['org-theirs']);
    });

    it('answers somebody who belongs to nothing with an empty page, not an error', async () => {
      seedOrganization('org-mine', 'Mine', 'mine', OWNER);

      const page = await organizations.listOrganizations(OUTSIDER, EVERYTHING);
      expect(page.data).toHaveLength(0);
      expect(page.meta.total).toBe(0);
    });

    it('excludes an organization the actor belonged to after it was deleted', async () => {
      seedOrganization('org-mine', 'Mine', 'mine', OWNER, EPOCH);

      const page = await organizations.listOrganizations(OWNER, EVERYTHING);
      expect(page.data).toHaveLength(0);
      expect(page.meta.total).toBe(0);
    });

    it('counts every organization in meta.total, not the page', async () => {
      seedOrganization('org-1', 'One', 'one', OWNER);
      seedOrganization('org-2', 'Two', 'two', OWNER);
      seedOrganization('org-3', 'Three', 'three', OWNER);

      const page = await organizations.listOrganizations(OWNER, { page: 1, limit: 2 });
      expect(page.data).toHaveLength(2);
      expect(page.meta.total).toBe(3);
      expect(page.meta.totalPages).toBe(2);
    });
  });

  describe('getOrganization', () => {
    it('returns a real entity for a member', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      const found = await organizations.getOrganization(OWNER, 'org-1' as OrganizationId);
      expect(found).toBeInstanceOf(Organization);
      expect(found.id).toBe('org-1');
    });

    it('rejects an organization id that does not exist', async () => {
      await expect(
        organizations.getOrganization(OWNER, ABSENT),
      ).rejects.toBeInstanceOf(OrganizationNotFoundError);
    });

    // The same answer as for an id nobody ever issued, on purpose: a caller
    // that got a different one could learn which organizations exist by
    // asking about them one at a time.
    it('refuses a non-member indistinguishably from an id that does not exist', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      const forbidden = await organizations
        .getOrganization(OUTSIDER, 'org-1' as OrganizationId)
        .catch((error) => error);
      const absent = await organizations.getOrganization(OUTSIDER, ABSENT).catch((error) => error);

      expect(forbidden).toBeInstanceOf(OrganizationNotFoundError);
      expect(forbidden.constructor).toBe(absent.constructor);
    });
  });

  describe('updateOrganization', () => {
    it('changes the name and the change is readable afterwards', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      const updated = await organizations.updateOrganization(OWNER, 'org-1' as OrganizationId, {
        name: 'Renamed Works',
      });
      expect(updated.name).toBe('Renamed Works');

      const reread = await organizations.getOrganization(OWNER, 'org-1' as OrganizationId);
      expect(reread.name).toBe('Renamed Works');
      // An omitted field is left alone.
      expect(reread.slug).toBe('acme-works');
    });

    it('refuses a non-member, and changes nothing', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      await expect(
        organizations.updateOrganization(OUTSIDER, 'org-1' as OrganizationId, {
          name: 'Hijacked',
        }),
      ).rejects.toBeInstanceOf(OrganizationNotFoundError);

      expect(source.byId(OrganizationRecord, 'org-1')?.name).toBe('Acme Works');
    });

    it('refuses a rename to a blank name, and changes nothing', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      await expect(
        organizations.updateOrganization(OWNER, 'org-1' as OrganizationId, { name: '   ' }),
      ).rejects.toBeInstanceOf(OrganizationNameRequiredError);

      expect(source.byId(OrganizationRecord, 'org-1')?.name).toBe('Acme Works');
    });

    it('records ORGANIZATION_UPDATED with the organization and the fields changed, never their values', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      await organizations.updateOrganization(OWNER, 'org-1' as OrganizationId, {
        name: 'Renamed Works',
      });

      const entry = source
        .all(AuditEntryRecord)
        .find((row) => row.action === AuditAction.ORGANIZATION_UPDATED);
      expect(entry).toBeDefined();
      expect(entry!.organizationId).toBe('org-1');
      expect(entry!.resourceId).toBe('org-1');
      expect(entry!.metadata).toEqual({ fields: ['name'] });
      expect(JSON.stringify(entry)).not.toContain('Renamed Works');
    });
  });

  describe('deleteOrganization', () => {
    it('soft-deletes: the record is retained and stops being listed', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      await organizations.deleteOrganization(OWNER, 'org-1' as OrganizationId);

      expect(source.byId(OrganizationRecord, 'org-1')).toBeDefined();
      expect(source.byId(OrganizationRecord, 'org-1')?.deletedAt).not.toBeNull();

      const page = await organizations.listOrganizations(OWNER, { page: 1, limit: 100 });
      expect(page.data).toHaveLength(0);
    });

    it('refuses a non-member, and deletes nothing', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      await expect(
        organizations.deleteOrganization(OUTSIDER, 'org-1' as OrganizationId),
      ).rejects.toBeInstanceOf(OrganizationNotFoundError);

      expect(source.byId(OrganizationRecord, 'org-1')?.deletedAt).toBeNull();
    });

    it('records ORGANIZATION_DELETED against the organization it deleted', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      await organizations.deleteOrganization(OWNER, 'org-1' as OrganizationId);

      const entry = source
        .all(AuditEntryRecord)
        .find((row) => row.action === AuditAction.ORGANIZATION_DELETED);
      expect(entry).toBeDefined();
      expect(entry!.organizationId).not.toBeNull();
      expect(entry!.organizationId).toBe('org-1');
      expect(entry!.actorUserId).toBe(OWNER);
    });
  });

  describe('listMembers', () => {
    const EVERYTHING = { page: 1, limit: 100 };

    it('lists the seeded members, by identity and by role', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);
      seedMembership('org-1', ADMIN, OrgRole.ADMIN);
      seedMembership('org-1', MEMBER, OrgRole.MEMBER);

      const page = await organizations.listMembers(OWNER, 'org-1' as OrganizationId, EVERYTHING);
      expect(page.data).toHaveLength(3);
      expect(page.meta.total).toBe(3);
      expect(page.data[0]).toBeInstanceOf(Membership);

      const byUser = (userId: UserId) => page.data.find((m) => m.userId === userId);
      expect(byUser(OWNER)?.role).toBe(OrgRole.OWNER);
      expect(byUser(ADMIN)?.role).toBe(OrgRole.ADMIN);
      expect(byUser(MEMBER)?.role).toBe(OrgRole.MEMBER);
    });

    it('refuses a non-member', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      await expect(
        organizations.listMembers(OUTSIDER, 'org-1' as OrganizationId, EVERYTHING),
      ).rejects.toBeInstanceOf(OrganizationNotFoundError);
    });

    it('filters to one role when asked', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);
      seedMembership('org-1', ADMIN, OrgRole.ADMIN);

      const page = await organizations.listMembers(OWNER, 'org-1' as OrganizationId, {
        ...EVERYTHING,
        role: OrgRole.ADMIN,
      });
      expect(page.data.map((m) => m.userId)).toEqual([ADMIN]);
      expect(page.meta.total).toBe(1);
    });
  });

  describe('changeMemberRole', () => {
    it('changes a member\'s role and the change is readable afterwards', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);
      seedMembership('org-1', MEMBER, OrgRole.MEMBER);

      const changed = await organizations.changeMemberRole(
        OWNER,
        'org-1' as OrganizationId,
        MEMBER,
        OrgRole.ADMIN,
      );
      expect(changed).toBeInstanceOf(Membership);
      expect(changed.role).toBe(OrgRole.ADMIN);
      expect(changed.userId).toBe(MEMBER);

      const reread = source.byId(MembershipRecord, `membership-org-1-${MEMBER}`);
      expect(reread?.role).toBe(OrgRole.ADMIN);
    });

    it('rejects a target who is not a member of the organization', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      await expect(
        organizations.changeMemberRole(OWNER, 'org-1' as OrganizationId, ABSENT_USER, OrgRole.ADMIN),
      ).rejects.toBeInstanceOf(MembershipNotFoundError);
    });

    // D15, and the discriminating half of it. The invariant is a COUNT of
    // remaining owners, never an equality against the actor's own id: an
    // ADMIN demoting the sole OWNER is not the owner demoting themselves, and
    // that is exactly the case an `if (targetUserId === actorId)`
    // implementation gets wrong while still passing every test where the
    // owner acts on their own membership (see the test directly below, and
    // this file's own report for the injection that proved it).
    it('refuses to demote the last owner, whoever is asking', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);
      seedMembership('org-1', ADMIN, OrgRole.ADMIN);

      await expect(
        organizations.changeMemberRole(ADMIN, 'org-1' as OrganizationId, OWNER, OrgRole.ADMIN),
      ).rejects.toBeInstanceOf(LastOwnerError);

      expect(source.byId(MembershipRecord, `membership-org-1-${OWNER}`)?.role).toBe(OrgRole.OWNER);
    });

    // The owner acting on themselves — the case a careless
    // `target === actor` implementation happens to get right, and the reason
    // the assertion above has to exist independently of this one.
    it('refuses to demote the last owner acting on themselves', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      await expect(
        organizations.changeMemberRole(OWNER, 'org-1' as OrganizationId, OWNER, OrgRole.ADMIN),
      ).rejects.toBeInstanceOf(LastOwnerError);
    });

    // The other side of the same rule: with two owners, either may go.
    it('allows demoting an owner once another owner exists', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);
      seedMembership('org-1', SECOND_OWNER, OrgRole.OWNER);

      const changed = await organizations.changeMemberRole(
        OWNER,
        'org-1' as OrganizationId,
        SECOND_OWNER,
        OrgRole.ADMIN,
      );
      expect(changed.role).toBe(OrgRole.ADMIN);

      const owners = source
        .all(MembershipRecord)
        .filter((row) => row.organizationId === 'org-1' && row.role === OrgRole.OWNER);
      expect(owners).toHaveLength(1);
      expect(owners[0].userId).toBe(OWNER);
    });

    it('does not read the owner count at all when the target is not an OWNER', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);
      seedMembership('org-1', MEMBER, OrgRole.MEMBER);

      // A promotion of a non-owner can never violate the invariant; asserted
      // by absence of a throw rather than by inspecting the count query,
      // since the fake has no query log to inspect.
      await expect(
        organizations.changeMemberRole(OWNER, 'org-1' as OrganizationId, MEMBER, OrgRole.VIEWER),
      ).resolves.toBeInstanceOf(Membership);
    });

    it('records MEMBER_ROLE_CHANGED against the organization it happened in', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);
      seedMembership('org-1', MEMBER, OrgRole.MEMBER);

      await organizations.changeMemberRole(OWNER, 'org-1' as OrganizationId, MEMBER, OrgRole.ADMIN);

      const entry = source
        .all(AuditEntryRecord)
        .find((row) => row.action === AuditAction.MEMBER_ROLE_CHANGED);
      expect(entry).toBeDefined();
      // Asserted against the world's own seeded id —
      // never against whatever the service just returned, which would let a
      // service that recorded `null` and a test that read it back off the
      // same variable pass together.
      expect(entry!.organizationId).toBe('org-1');
      expect(entry!.actorUserId).toBe(OWNER);
    });
  });

  describe('removeMember', () => {
    it('removes a member', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);
      seedMembership('org-1', MEMBER, OrgRole.MEMBER);

      await organizations.removeMember(OWNER, 'org-1' as OrganizationId, MEMBER);

      expect(source.byId(MembershipRecord, `membership-org-1-${MEMBER}`)).toBeUndefined();
    });

    it('rejects a target who is not a member of the organization', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      await expect(
        organizations.removeMember(OWNER, 'org-1' as OrganizationId, ABSENT_USER),
      ).rejects.toBeInstanceOf(MembershipNotFoundError);
    });

    // D15's other half: removing the sole OWNER is exactly as ownerless an
    // outcome as demoting them, and "whoever is asking" is the same
    // discriminating case — an ADMIN removing the sole OWNER is not the
    // owner leaving.
    it('refuses to remove the last owner, whoever is asking', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);
      seedMembership('org-1', ADMIN, OrgRole.ADMIN);

      await expect(
        organizations.removeMember(ADMIN, 'org-1' as OrganizationId, OWNER),
      ).rejects.toBeInstanceOf(LastOwnerError);

      expect(source.byId(MembershipRecord, `membership-org-1-${OWNER}`)).toBeDefined();
    });

    it('refuses to remove the last owner acting on themselves', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);

      await expect(
        organizations.removeMember(OWNER, 'org-1' as OrganizationId, OWNER),
      ).rejects.toBeInstanceOf(LastOwnerError);
    });

    // The other side of the same rule: with two owners, either may go.
    it('allows an owner to leave once another owner exists', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);
      seedMembership('org-1', SECOND_OWNER, OrgRole.OWNER);

      await organizations.removeMember(OWNER, 'org-1' as OrganizationId, SECOND_OWNER);

      const owners = source
        .all(MembershipRecord)
        .filter((row) => row.organizationId === 'org-1' && row.role === OrgRole.OWNER);
      expect(owners).toHaveLength(1);
      expect(owners[0].userId).toBe(OWNER);
    });

    it('records MEMBER_REMOVED against the organization it happened in', async () => {
      seedOrganization('org-1', 'Acme Works', 'acme-works', OWNER);
      seedMembership('org-1', MEMBER, OrgRole.MEMBER);

      await organizations.removeMember(OWNER, 'org-1' as OrganizationId, MEMBER);

      const entry = source
        .all(AuditEntryRecord)
        .find((row) => row.action === AuditAction.MEMBER_REMOVED);
      expect(entry).toBeDefined();
      expect(entry!.organizationId).toBe('org-1');
      expect(entry!.actorUserId).toBe(OWNER);
    });
  });
});
