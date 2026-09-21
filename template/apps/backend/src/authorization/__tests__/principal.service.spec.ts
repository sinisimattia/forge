import { NotFoundException } from '@nestjs/common';
import type { ObjectLiteral, Repository } from 'typeorm';
import { can } from '__FORGE_SCOPE__/core/authorization/policies';
import type { GrantId, ResourceType } from '__FORGE_SCOPE__/core/authorization/types';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { FakeDataSource } from '../../common/testing';
import { MembershipRecord } from '../../organizations/membership-record.entity';
import { UserRecord } from '../../users/user-record.entity';
import { PrincipalService } from '../principal.service';
import { ResourceGrantRecord } from '../resource-grant-record.entity';

/**
 * The hydrator: the one place the three facts an access decision reads are
 * established, and — design ruling R2 — the one place a grant's expiry is
 * judged at all.
 *
 * That second sentence is why this file is written carefully. `can` never reads
 * `expiresAt`: a clock inside it would stop the same principal and resource
 * producing the same answer, which is exactly what lets the server decide a
 * request and a client predict what the server would say. So `isGrantLive` runs
 * here and nowhere else, and **an expired grant that survives the filter is
 * honoured by `can` without complaint** — there is no second check to catch it.
 * An untested hydrator would make `expiresAt` decorative across the whole
 * system, which is a column that looks like a rule and is not one.
 */

const ACTOR = '11111111-1111-4111-8111-111111111111' as UserId;
const STRANGER = '22222222-2222-4222-8222-222222222222' as UserId;

const ORG_A = '33333333-3333-4333-8333-333333333333' as OrganizationId;
const ORG_B = '44444444-4444-4444-8444-444444444444' as OrganizationId;

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

/** The instant every expiry below is judged against. */
const NOW = new Date('2026-06-01T00:00:00.000Z');

const AT = (iso: string): Date => new Date(iso);

describe('PrincipalService', () => {
  let source: FakeDataSource;
  let service: PrincipalService;

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  const seedUser = (id: string, platformRole = PlatformRole.PLATFORM_USER): void => {
    source.seed(UserRecord, [
      {
        id,
        email: `${id}@example.test`,
        displayName: 'Somebody',
        status: UserStatus.ACTIVE,
        platformRole,
        emailVerifiedAt: EPOCH,
        createdAt: EPOCH,
        updatedAt: EPOCH,
        deletedAt: null,
      },
    ]);
  };

  const seedMembership = (organizationId: string, userId: string, role: OrgRole): void => {
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

  const seedGrant = (id: string, subjectUserId: string, expiresAt: Date | null): void => {
    source.seed(ResourceGrantRecord, [
      {
        id,
        organizationId: ORG_A,
        subjectUserId,
        resourceType: 'document',
        resourceId: 'doc-1',
        permission: 'organization:update',
        grantedBy: null,
        createdAt: EPOCH,
        expiresAt,
      },
    ]);
  };

  beforeEach(() => {
    source = new FakeDataSource();
    service = new PrincipalService(
      repo<UserRecord>(UserRecord),
      repo<MembershipRecord>(MembershipRecord),
      repo<ResourceGrantRecord>(ResourceGrantRecord),
    );
    seedUser(ACTOR);
  });

  describe('grants, which is the only place expiry is judged (R2)', () => {
    it('excludes a grant that has expired as of the instant it was given', async () => {
      seedGrant('live', ACTOR, AT('2026-12-01T00:00:00.000Z'));
      seedGrant('lapsed', ACTOR, AT('2026-05-31T23:59:59.999Z'));

      const principal = await service.hydrate(ACTOR, NOW);

      expect(principal.grants.map((grant) => grant.id)).toEqual(['live']);
    });

    it('keeps a grant with no expiry', async () => {
      // `null` means "never lapses", and a comparison that read it as "in the
      // past" would silently drop every permanent exception in the deployment —
      // a failure that looks exactly like a correctly-refused request.
      seedGrant('forever', ACTOR, null);

      const principal = await service.hydrate(ACTOR, NOW);

      expect(principal.grants.map((grant) => grant.id)).toEqual(['forever']);
    });

    it('excludes a grant expiring at exactly the instant it is judged', async () => {
      // `isGrantLive`'s boundary is exclusive, matching `Invitation.isExpiredAt`
      // so that the two things that lapse in this domain agree about what their
      // last moment was. Asserted here because this is the only caller.
      seedGrant('on-the-boundary', ACTOR, NOW);

      const principal = await service.hydrate(ACTOR, NOW);

      expect(principal.grants).toEqual([]);
    });

    it('judges expiry against the instant it is given, not against the clock', async () => {
      // The same stored grant, two instants, two answers. Without this, an
      // implementation that read `Date.now()` itself would pass every other
      // case in this describe block.
      seedGrant('lapses-in-july', ACTOR, AT('2026-07-01T00:00:00.000Z'));

      const before = await service.hydrate(ACTOR, AT('2026-06-01T00:00:00.000Z'));
      const after = await service.hydrate(ACTOR, AT('2026-08-01T00:00:00.000Z'));

      expect(before.grants.map((grant) => grant.id)).toEqual(['lapses-in-july']);
      expect(after.grants).toEqual([]);
    });

    it('carries no grant belonging to somebody else', async () => {
      seedUser(STRANGER);
      seedGrant('theirs', STRANGER, null);

      const principal = await service.hydrate(ACTOR, NOW);

      expect(principal.grants).toEqual([]);
    });

    it('hands `can` a grant it honours without re-checking expiry', async () => {
      // The other half of R2, stated as the consequence rather than the rule:
      // `can` does not judge `expiresAt`, so whatever survives the filter above
      // is authority. This is what makes the filter load-bearing rather than
      // belt-and-braces, and it is asserted here so that nobody "simplifies"
      // the hydrator on the assumption that `can` would catch it.
      const lapsed = {
        id: 'lapsed' as GrantId,
        subjectUserId: ACTOR,
        organizationId: ORG_A,
        resourceType: 'document' as ResourceType,
        resourceId: 'doc-1',
        permission: 'organization:update' as const,
        grantedBy: null,
        createdAt: EPOCH,
        expiresAt: AT('2020-01-01T00:00:00.000Z'),
      };

      const permitted = can(
        {
          userId: ACTOR,
          platformRole: PlatformRole.PLATFORM_USER,
          memberships: [{ organizationId: ORG_A, role: OrgRole.VIEWER }],
          grants: [lapsed],
        },
        'organization:update',
        { organizationId: ORG_A, resourceType: 'document' as ResourceType, resourceId: 'doc-1' },
      );

      expect(permitted).toBe(true);
    });
  });

  describe('memberships', () => {
    it('carries every membership the person holds', async () => {
      // Every one, not "the membership for the current organization". `can`
      // chooses among them by the RESOURCE's organization, and narrowing here
      // would put the choosing in a second place that cannot see the resource —
      // which is the ambient tenancy ADR-0007 exists to forbid.
      seedMembership(ORG_A, ACTOR, OrgRole.OWNER);
      seedMembership(ORG_B, ACTOR, OrgRole.VIEWER);

      const principal = await service.hydrate(ACTOR, NOW);

      expect(
        [...principal.memberships].sort((left, right) =>
          left.organizationId.localeCompare(right.organizationId),
        ),
      ).toEqual([
        { organizationId: ORG_A, role: OrgRole.OWNER },
        { organizationId: ORG_B, role: OrgRole.VIEWER },
      ]);
    });

    it('carries no membership belonging to somebody else', async () => {
      seedUser(STRANGER);
      seedMembership(ORG_A, STRANGER, OrgRole.OWNER);

      const principal = await service.hydrate(ACTOR, NOW);

      expect(principal.memberships).toEqual([]);
    });

    it('carries an empty list rather than omitting the field', async () => {
      // `Principal.memberships` is required precisely so that a hydrator which
      // forgot cannot pass `undefined` and have `can` read the absence as a
      // deliberate "belongs to nothing".
      const principal = await service.hydrate(ACTOR, NOW);

      expect(principal.memberships).toEqual([]);
      expect(principal.grants).toEqual([]);
    });
  });

  describe('the platform role', () => {
    it('reads the platform role from the row, not from anything passed in', async () => {
      // `PlatformAdminGuard` states the reasoning and it is the same here: the
      // access credential is not re-issued when somebody's role changes, so a
      // role taken from it would be whatever it was minted with. Nothing but
      // `userId` is passed to `hydrate`, so there is nowhere else this could
      // come from — which is the property, expressed as an interface.
      source.seed(UserRecord, [
        {
          id: STRANGER,
          email: 'admin@example.test',
          displayName: 'Administrator',
          status: UserStatus.ACTIVE,
          platformRole: PlatformRole.PLATFORM_ADMIN,
          emailVerifiedAt: EPOCH,
          createdAt: EPOCH,
          updatedAt: EPOCH,
          deletedAt: null,
        },
      ]);

      const principal = await service.hydrate(STRANGER, NOW);

      expect(principal.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);
      expect(principal.userId).toBe(STRANGER);
    });

    it('follows the row when the role changes under a live credential', async () => {
      // The window `JwtStrategy` documents, closed for authorization: a role
      // withdrawn at noon stops authorizing at the next request, not when the
      // credential lapses. A hydrator that cached would fail this.
      const promoted = await service.hydrate(ACTOR, NOW);
      expect(promoted.platformRole).toBe(PlatformRole.PLATFORM_USER);

      await repo<UserRecord>(UserRecord).update(
        { id: ACTOR },
        { platformRole: PlatformRole.PLATFORM_ADMIN },
      );

      const afterwards = await service.hydrate(ACTOR, NOW);
      expect(afterwards.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);
    });
  });

  it('refuses a subject no account answers to', async () => {
    // The same answer `PermissionsGuard` gives for a refusal. A credential whose
    // subject has been deleted learns nothing from being told which it was.
    await expect(service.hydrate(STRANGER, NOW)).rejects.toThrow(NotFoundException);
  });
});
