import { INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { ObjectLiteral, Repository } from 'typeorm';
import request from 'supertest';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { PlatformAdminGuard } from '../../auth/guards';
import { JwtStrategy } from '../../auth/strategies';
import { PermissionsGuard, PrincipalService } from '../../authorization';
import { ResourceGrantRecord } from '../../authorization/resource-grant-record.entity';
import { FakeDataSource } from '../../common/testing';
import { MembershipRecord } from '../../organizations/membership-record.entity';
import { OrganizationRecord } from '../../organizations/organization-record.entity';
import { UserRecord } from '../../users/user-record.entity';
import { AuditEntryRecord } from '../audit-entry-record.entity';
import { AuditController } from '../audit.controller';
import { AuditModule } from '../audit.module';
import { AuditService } from '../audit.service';
import { OrganizationAuditController } from '../organization-audit.controller';

/**
 * The organization-scoped half of spec §9.6: `GET /organizations/:id/audit`.
 *
 * `AuditService.query` (the cross-tenant, platform-admin read) already has
 * its own suite in `audit.controller.spec.ts`, and this file does not repeat
 * it. What is new here is the scoping this route owes and nowhere else in
 * this backend needs to prove: whatever a caller's OWN query says, this route
 * answers about the organization the ROUTE names — never the caller's.
 */

const OWNER = '11111111-1111-4111-8111-111111111111' as UserId;
const ADMIN = '22222222-2222-4222-8222-222222222222' as UserId;
const MEMBER = '33333333-3333-4333-8333-333333333333' as UserId;
const ROOT = '44444444-4444-4444-8444-444444444444' as UserId;
const SESSION = '55555555-5555-4555-8555-555555555555' as SessionId;

const ORG_A = '66666666-6666-4666-8666-666666666666';
const ORG_B = '77777777-7777-4777-8777-777777777777';

const SIGNING_KEY = 'organization-audit-controller-spec-signing-key';

const EPOCH = new Date('2026-09-20T10:00:00.000Z');

const entryRow = (
  id: string,
  organizationId: string | null,
  actorUserId: string,
  at: string,
): Record<string, unknown> => ({
  id,
  organizationId,
  actorUserId,
  action: AuditAction.PROFILE_UPDATED,
  resourceType: null,
  resourceId: null,
  metadata: {},
  clientAddress: null,
  clientLabel: null,
  occurredAt: new Date(at),
});

describe('OrganizationAuditController', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let source: FakeDataSource;
  let audit: AuditService;

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  beforeEach(async () => {
    source = new FakeDataSource();

    const userRow = (id: string, platformRole: PlatformRole): Record<string, unknown> => ({
      id,
      email: `${id}@example.test`,
      displayName: 'Somebody',
      status: UserStatus.ACTIVE,
      platformRole,
      emailVerifiedAt: EPOCH,
      createdAt: EPOCH,
      updatedAt: EPOCH,
      deletedAt: null,
    });
    source.seed(UserRecord, [
      userRow(OWNER, PlatformRole.PLATFORM_USER),
      userRow(ADMIN, PlatformRole.PLATFORM_USER),
      userRow(MEMBER, PlatformRole.PLATFORM_USER),
      userRow(ROOT, PlatformRole.PLATFORM_ADMIN),
    ]);
    source.seed(OrganizationRecord, [
      { id: ORG_A, name: 'Org A', slug: 'org-a', createdAt: EPOCH, updatedAt: EPOCH, deletedAt: null },
      { id: ORG_B, name: 'Org B', slug: 'org-b', createdAt: EPOCH, updatedAt: EPOCH, deletedAt: null },
    ]);
    source.seed(MembershipRecord, [
      { id: 'membership-a-owner', organizationId: ORG_A, userId: OWNER, role: OrgRole.OWNER, createdAt: EPOCH, updatedAt: EPOCH },
      { id: 'membership-a-admin', organizationId: ORG_A, userId: ADMIN, role: OrgRole.ADMIN, createdAt: EPOCH, updatedAt: EPOCH },
      { id: 'membership-a-member', organizationId: ORG_A, userId: MEMBER, role: OrgRole.MEMBER, createdAt: EPOCH, updatedAt: EPOCH },
    ]);

    // Two organizations' worth of history, plus one platform-level entry
    // (no tenant), so every filter in this file has something to fail on.
    source.seed(AuditEntryRecord, [
      entryRow('entry-a-1', ORG_A, OWNER, '2026-09-20T09:00:00Z'),
      entryRow('entry-a-2', ORG_A, MEMBER, '2026-09-20T09:30:00Z'),
      entryRow('entry-b-1', ORG_B, OWNER, '2026-09-20T09:15:00Z'),
      entryRow('platform-1', null, ROOT, '2026-09-20T08:00:00Z'),
    ]);

    audit = new AuditService(
      repo<AuditEntryRecord>(AuditEntryRecord),
      repo<UserRecord>(UserRecord),
      repo<MembershipRecord>(MembershipRecord),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: SIGNING_KEY })] }),
        I18N,
        PassportModule,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [AuditController, OrganizationAuditController],
      providers: [
        // THE SHIPPED ARRAY, so the statuses below are the ones the
        // application really produces.
        ...GLOBAL_PROVIDERS,
        JwtStrategy,
        { provide: AuditService, useValue: audit },
        // Both guards, constructed by the framework exactly as the
        // application constructs them — `GET /audit`'s own, and the one
        // `GET /organizations/:id/audit` names.
        PlatformAdminGuard,
        PermissionsGuard,
        PrincipalService,
        { provide: getRepositoryToken(UserRecord), useValue: repo<UserRecord>(UserRecord) },
        {
          provide: getRepositoryToken(MembershipRecord),
          useValue: repo<MembershipRecord>(MembershipRecord),
        },
        {
          provide: getRepositoryToken(OrganizationRecord),
          useValue: repo<OrganizationRecord>(OrganizationRecord),
        },
        {
          provide: getRepositoryToken(ResourceGrantRecord),
          useValue: repo<ResourceGrantRecord>(ResourceGrantRecord),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    jwt = moduleRef.get(JwtService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const bearer = (userId: UserId): string => `Bearer ${jwt.sign({ sub: userId, sid: SESSION })}`;

  describe('authentication', () => {
    it('is closed to a caller with no credential', async () => {
      await request(app.getHttpServer()).get(`/organizations/${ORG_A}/audit`).expect(401);
    });
  });

  /**
   * The assertion most likely to be written unfailable. A conflicting filter
   * — `organizationId` naming a DIFFERENT organization from the route's — is
   * what tells an implementation that merges the caller's query into the
   * store's filter apart from one that does not: an omitted filter passes
   * both.
   */
  describe('scoping — the property that matters', () => {
    it('scopes the page to the organization in the route, whatever the query says, called directly', async () => {
      const controller = new OrganizationAuditController(audit);

      const page = await controller.list(
        { userId: OWNER, sessionId: SESSION },
        ORG_A,
        { page: 1, limit: 50, organizationId: ORG_B },
      );

      expect(page.data.length).toBeGreaterThan(0);
      expect(page.data.every((entry) => entry.organizationId === ORG_A)).toBe(true);
      expect(page.data.some((entry) => entry.organizationId === ORG_B)).toBe(false);
    });

    it('scopes the page to the organization in the route over the wire, whatever the query string says', async () => {
      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_A}/audit?organizationId=${ORG_B}&limit=50`)
        .set('Authorization', bearer(OWNER))
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      const scoped = response.body.data.every(
        (entry: { organizationId: string }) => entry.organizationId === ORG_A,
      );
      expect(scoped).toBe(true);
    });

    it('lists an organization\'s own entries when the caller sends no conflicting filter', async () => {
      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_A}/audit`)
        .set('Authorization', bearer(OWNER))
        .expect(200);

      expect(response.body.meta.total).toBe(2);
      expect(
        response.body.data.map((entry: { id: string }) => entry.id).sort(),
      ).toEqual(['entry-a-1', 'entry-a-2']);
    });
  });

  describe('GET /audit did not widen', () => {
    // The cross-tenant, platform-admin surface stays exactly as narrow as it
    // always was. An organization administrator — real ADMIN role, real
    // membership, real `audit:read` on their own organization — still meets
    // `PlatformAdminGuard`'s 404 on the deployment-wide route.
    it('still refuses an organization administrator with 404', async () => {
      // Established first: this same account CAN read its own organization's
      // history through the route this task adds — the refusal below is
      // about `GET /audit` specifically, not about the account.
      await request(app.getHttpServer())
        .get(`/organizations/${ORG_A}/audit`)
        .set('Authorization', bearer(ADMIN))
        .expect(200);

      await request(app.getHttpServer())
        .get('/audit')
        .set('Authorization', bearer(ADMIN))
        .expect(404);
    });

    it('still lets a platform administrator through', async () => {
      await request(app.getHttpServer())
        .get('/audit')
        .set('Authorization', bearer(ROOT))
        .expect(200);
    });
  });

  /**
   * Authorization, asserted by the one actor whose answer differs.
   *
   * | Deleted from shipped code | Caught by |
   * |---|---|
   * | `organization-audit.controller.ts`: the guard or the permission on `GET /organizations/:id/audit` | `refuses a MEMBER reading the organization's history` |
   */
  describe('authorization: what a role does and does not carry', () => {
    it('refuses a MEMBER reading the organization\'s history', async () => {
      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_A}/audit`)
        .set('Authorization', bearer(MEMBER));

      expect(response.status).toBe(404);
    });

    it('lets an ADMIN read it, so the refusal above is about the role', async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${ORG_A}/audit`)
        .set('Authorization', bearer(ADMIN))
        .expect(200);
    });

    it('refuses a non-member organization\'s history', async () => {
      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_B}/audit`)
        .set('Authorization', bearer(MEMBER));

      expect(response.status).toBe(404);
    });
  });

  describe('AuditModule wires it, which no probe application can show', () => {
    it('registers OrganizationAuditController', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AuditModule)).toContain(
        OrganizationAuditController,
      );
    });
  });
});
