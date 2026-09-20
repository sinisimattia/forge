import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import {
  InvalidOrganizationSlugError,
  OrganizationNameRequiredError,
  OrganizationNotFoundError,
} from '__FORGE_SCOPE__/core/organizations/errors';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { AuditService } from '../../audit/audit.service';
import { FakeDataSource, FakeEntityManager } from '../../common/testing';
import { UserRecord } from '../../users/user-record.entity';
import { MembershipRecord } from '../membership-record.entity';
import { OrganizationRecord } from '../organization-record.entity';
import { OrganizationsService } from '../organizations.service';

/**
 * The two things this class exists to get right and nothing outside it can
 * see: the owner membership is created in the SAME transaction as the
 * organization, and every mutation's audit entry carries the organization it
 * happened in — never `null`, which was Phase 2's own shipped defect until
 * Task 8 made the field assertable.
 *
 * The rest — refusing a non-member, the not-found/not-mine collapse, an
 * omitted field being left alone — pins the same behaviour
 * `runIOrganizationServiceContract` pins for the in-memory reference, because
 * this implementation is not run against that suite yet: Task 15 wires the
 * conformance driver once members and invitations exist. Until then, this
 * file is the only thing holding this class to that contract.
 */

const OWNER = 'user-owner' as UserId;
const OUTSIDER = 'user-outsider' as UserId;
const ABSENT = '99999999-9999-4999-8999-999999999999' as OrganizationId;

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
    );

    organizations = new OrganizationsService(
      repo<OrganizationRecord>(OrganizationRecord),
      repo<MembershipRecord>(MembershipRecord),
      source as unknown as DataSource,
      audit,
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
    // the organization — the field Phase 2 shipped nullable and Task 8 made
    // assertable. An entry recorded with a null organization here is the
    // exact defect Task 8's measurement was about, so this asserts the field
    // rather than assuming it is populated.
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
});
