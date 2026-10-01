import { INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { ObjectLiteral, Repository } from 'typeorm';
import request from 'supertest';
import type { Response } from 'supertest';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { AuditService } from '../../audit/audit.service';
import { FakeDataSource, UNMETERED_THROTTLING } from '../../common/testing';
import { JwtStrategy } from '../../auth/strategies';
import { MembershipRecord } from '../../organizations/membership-record.entity';
import { OrganizationRecord } from '../../organizations/organization-record.entity';
import { UserRecord } from '../../users/user-record.entity';
import { AuthorizationModule } from '../authorization.module';
import { AuthorizationService } from '../authorization.service';
import { GrantsController } from '../grants.controller';
import { PermissionsGuard } from '../permissions.guard';
import { PrincipalService } from '../principal.service';
import { ResourceGrantRecord } from '../resource-grant-record.entity';

/**
 * The transport half of grants: issuing, listing, withdrawing.
 *
 * Same division of labour as `members.controller.spec.ts`: core's own
 * `runIAuthorizationServiceContract` already pins `AuthorizationService`'s
 * domain behavior (a grant never crosses a tenant, issuing/listing/revoking
 * scope correctly). What belongs here is that a route delegates to it rather
 * than reimplementing it, that each of the four routes' own permission
 * actually gates the route, and the one refusal that is this controller's own
 * addition rather than core's: `platform:administer` can never be handed to
 * `POST /organizations/:id/grants`, whoever is asking.
 */

const OWNER = '11111111-1111-4111-8111-111111111111' as UserId;
const ADMIN = '22222222-2222-4222-8222-222222222222' as UserId;
const MEMBER = '33333333-3333-4333-8333-333333333333' as UserId;
const OUTSIDER = '44444444-4444-4444-8444-444444444444' as UserId;
const SESSION = '55555555-5555-4555-8555-555555555555' as SessionId;

const ORG_1 = '66666666-6666-4666-8666-666666666666';
const ORG_2 = '77777777-7777-4777-8777-777777777777';
const GRANT_ABSENT = '88888888-8888-4888-8888-888888888888';

const SIGNING_KEY = 'grants-controller-spec-signing-key';

const EPOCH = new Date('2026-09-20T10:00:00.000Z');

describe('GrantsController', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let source: FakeDataSource;

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  beforeEach(async () => {
    source = new FakeDataSource();
    for (const account of [OWNER, ADMIN, MEMBER, OUTSIDER]) seedAccount(account);

    const audit = new AuditService(
      repo<AuditEntryRecord>(AuditEntryRecord),
      repo<UserRecord>(UserRecord),
      repo<MembershipRecord>(MembershipRecord),
    );
    const authorization = new AuthorizationService(
      repo<ResourceGrantRecord>(ResourceGrantRecord),
      repo<MembershipRecord>(MembershipRecord),
      audit,
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: SIGNING_KEY })] }),
        I18N,
        PassportModule,
        UNMETERED_THROTTLING,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [GrantsController],
      providers: [
        // THE SHIPPED ARRAY, so the statuses below are the ones the
        // application really produces.
        ...GLOBAL_PROVIDERS,
        JwtStrategy,
        { provide: AuthorizationService, useValue: authorization },
        { provide: AuditService, useValue: audit },
        {
          provide: getRepositoryToken(ResourceGrantRecord),
          useValue: repo<ResourceGrantRecord>(ResourceGrantRecord),
        },
        {
          provide: getRepositoryToken(MembershipRecord),
          useValue: repo<MembershipRecord>(MembershipRecord),
        },
        {
          provide: getRepositoryToken(OrganizationRecord),
          useValue: repo<OrganizationRecord>(OrganizationRecord),
        },
        {
          provide: getRepositoryToken(UserRecord),
          useValue: repo<UserRecord>(UserRecord),
        },
        // Constructed by the framework, exactly as the application constructs
        // them — the guard every route names, and the hydrator it asks.
        PermissionsGuard,
        PrincipalService,
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

  const seedAccount = (id: string): void => {
    source.seed(UserRecord, [
      {
        id,
        email: `${id}@example.test`,
        displayName: 'Somebody',
        status: UserStatus.ACTIVE,
        platformRole: PlatformRole.PLATFORM_USER,
        emailVerifiedAt: EPOCH,
        createdAt: EPOCH,
        updatedAt: EPOCH,
        deletedAt: null,
      },
    ]);
  };

  /** Seeds `org` with `owner` as its sole OWNER. */
  const seedOrganization = (id: string, owner: string): void => {
    source.seed(OrganizationRecord, [
      { id, name: 'Acme Works', slug: `acme-works-${id}`, createdAt: EPOCH, updatedAt: EPOCH, deletedAt: null },
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
  const seedMembership = (organizationId: string, userId: string, role: OrgRole): void => {
    source.seed(MembershipRecord, [
      { id: `membership-${organizationId}-${userId}`, organizationId, userId, role, createdAt: EPOCH, updatedAt: EPOCH },
    ]);
  };

  /** Seeds a grant directly, with a real UUID id so it can be named in a path. */
  const seedGrant = (
    id: string,
    organizationId: string,
    subjectUserId: string,
    overrides: Partial<{ resourceType: string; resourceId: string; permission: string }> = {},
  ): void => {
    source.seed(ResourceGrantRecord, [
      {
        id,
        organizationId,
        subjectUserId,
        resourceType: overrides.resourceType ?? 'document',
        resourceId: overrides.resourceId ?? 'doc-1',
        permission: overrides.permission ?? 'organization:update',
        grantedBy: OWNER,
        createdAt: EPOCH,
        expiresAt: null,
      },
    ]);
  };

  /** Every route this controller mounts, as a verb, a path and a body. */
  const ROUTES: [string, string, Record<string, unknown> | undefined][] = [
    [
      'post',
      `/organizations/${ORG_1}/grants`,
      { subjectUserId: MEMBER, resourceType: 'document', resourceId: 'doc-1', permission: 'organization:update' },
    ],
    ['get', `/organizations/${ORG_1}/grants`, undefined],
    ['delete', `/organizations/${ORG_1}/grants/${GRANT_ABSENT}`, undefined],
  ];

  const call = (verb: string, path: string, body?: Record<string, unknown>): Promise<Response> => {
    const agent = request(app.getHttpServer()) as unknown as Record<
      string,
      (path: string) => request.Test
    >;
    const test = agent[verb](path);
    return body === undefined ? test : test.send(body);
  };

  describe('authentication', () => {
    it.each(ROUTES)('%s %s is closed to a caller with no credential', async (verb, path, body) => {
      const response = await call(verb, path, body);
      expect(response.status).toBe(401);
    });
  });

  describe('POST /organizations/:id/grants', () => {
    it('issues a grant, recording the actor as grantedBy', async () => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, MEMBER, OrgRole.MEMBER);

      const response = await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/grants`)
        .set('Authorization', bearer(OWNER))
        .send({
          subjectUserId: MEMBER,
          resourceType: 'document',
          resourceId: 'doc-1',
          permission: 'organization:update',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        organizationId: ORG_1,
        subjectUserId: MEMBER,
        resourceType: 'document',
        resourceId: 'doc-1',
        permission: 'organization:update',
        grantedBy: OWNER,
      });
      expect(source.all(ResourceGrantRecord)).toHaveLength(1);
    });

    it('records GRANT_CREATED against the organization the grant was issued in', async () => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, MEMBER, OrgRole.MEMBER);

      await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/grants`)
        .set('Authorization', bearer(OWNER))
        .send({
          subjectUserId: MEMBER,
          resourceType: 'document',
          resourceId: 'doc-1',
          permission: 'organization:update',
        })
        .expect(201);

      const entry = source
        .all(AuditEntryRecord)
        .find((row) => row.action === AuditAction.GRANT_CREATED);
      expect(entry).toBeDefined();
      // Against the world's own seeded id, never against the service's own
      // return — a tautology would pass even if `organizationId` were dropped
      // on the way to the store.
      expect(entry!.organizationId).toBe(ORG_1);
      expect(entry!.actorUserId).toBe(OWNER);
    });

    // The write-side half of "grants never widen into another tenant" — the
    // read end is `can()`'s own organization match, and both halves are
    // needed: either alone leaves a path (spec §9.5).
    it('refuses a grant for somebody who is not a member, and issues nothing', async () => {
      seedOrganization(ORG_1, OWNER);
      // OUTSIDER belongs to no organization at all — real account, no membership.

      const response = await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/grants`)
        .set('Authorization', bearer(OWNER))
        .send({
          subjectUserId: OUTSIDER,
          resourceType: 'document',
          resourceId: 'doc-1',
          permission: 'organization:update',
        });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CROSS_TENANT_GRANT');
      expect(source.all(ResourceGrantRecord)).toHaveLength(0);
    });

    // Ruling 2. `can()` already excludes `platform:administer` from layer
    // three on the read side; this is the write side of the same rule. An
    // ADMIN holds `grant:create`, and without this refusal they could persist
    // a grant for the deployment's one unbounded permission.
    it('refuses to issue a grant naming platform:administer, whoever is asking', async () => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, MEMBER, OrgRole.MEMBER);

      const response = await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/grants`)
        .set('Authorization', bearer(OWNER))
        .send({
          subjectUserId: MEMBER,
          resourceType: 'document',
          resourceId: 'doc-1',
          permission: 'platform:administer',
        });

      expect(response.status).toBe(400);
      expect(source.all(ResourceGrantRecord)).toHaveLength(0);
    });

    it('refuses a body carrying a field this DTO does not declare', async () => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, MEMBER, OrgRole.MEMBER);

      await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/grants`)
        .set('Authorization', bearer(OWNER))
        .send({
          subjectUserId: MEMBER,
          resourceType: 'document',
          resourceId: 'doc-1',
          permission: 'organization:update',
          organizationId: ORG_1,
        })
        .expect(400);
    });
  });

  describe('GET /organizations/:id/grants', () => {
    it('lists an organization\'s grants, and none of another organization\'s', async () => {
      seedOrganization(ORG_1, OWNER);
      seedOrganization(ORG_2, ADMIN);
      seedMembership(ORG_1, MEMBER, OrgRole.MEMBER);
      seedMembership(ORG_2, MEMBER, OrgRole.MEMBER);
      seedGrant('99999999-9999-4999-8999-999999999991', ORG_1, MEMBER);
      seedGrant('99999999-9999-4999-8999-999999999992', ORG_2, MEMBER);

      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/grants`)
        .set('Authorization', bearer(OWNER))
        .expect(200);

      expect(response.body.meta.total).toBe(1);
      expect(response.body.data.map((g: { id: string }) => g.id)).toEqual([
        '99999999-9999-4999-8999-999999999991',
      ]);
    });

    it('does not reveal a non-member organization\'s grants', async () => {
      seedOrganization(ORG_1, OWNER);
      seedGrant('99999999-9999-4999-8999-999999999991', ORG_1, OWNER);

      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/grants`)
        .set('Authorization', bearer(OUTSIDER));

      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('document');
    });
  });

  describe('DELETE /organizations/:id/grants/:grantId', () => {
    const GRANT_1 = '99999999-9999-4999-8999-999999999991';

    it('withdraws a grant', async () => {
      seedOrganization(ORG_1, OWNER);
      seedGrant(GRANT_1, ORG_1, OWNER);

      await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/grants/${GRANT_1}`)
        .set('Authorization', bearer(OWNER))
        .expect(204);

      expect(source.byId(ResourceGrantRecord, GRANT_1)).toBeUndefined();
    });

    it('records GRANT_REVOKED against the organization the grant belonged to', async () => {
      seedOrganization(ORG_1, OWNER);
      seedGrant(GRANT_1, ORG_1, OWNER);

      await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/grants/${GRANT_1}`)
        .set('Authorization', bearer(OWNER))
        .expect(204);

      const entry = source
        .all(AuditEntryRecord)
        .find((row) => row.action === AuditAction.GRANT_REVOKED);
      expect(entry).toBeDefined();
      expect(entry!.organizationId).toBe(ORG_1);
      expect(entry!.actorUserId).toBe(OWNER);
    });

    it('answers an id nobody ever issued with 404', async () => {
      seedOrganization(ORG_1, OWNER);

      const response = await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/grants/${GRANT_ABSENT}`)
        .set('Authorization', bearer(OWNER));

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('GRANT_NOT_FOUND');
    });

    // Indistinguishable on purpose — core's own contract states it, and this
    // is that collapse surviving to the wire.
    it('answers another organization\'s grant exactly as an id nobody ever issued', async () => {
      seedOrganization(ORG_1, OWNER);
      seedOrganization(ORG_2, ADMIN);
      seedGrant(GRANT_1, ORG_2, ADMIN);

      const theirs = await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/grants/${GRANT_1}`)
        .set('Authorization', bearer(OWNER));
      const neverIssued = await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/grants/${GRANT_ABSENT}`)
        .set('Authorization', bearer(OWNER));

      expect(theirs.status).toBe(neverIssued.status);
      expect(theirs.body).toStrictEqual(neverIssued.body);
      // And it must still be there — a refusal that deleted it would be the
      // worse failure.
      expect(source.byId(ResourceGrantRecord, GRANT_1)).toBeDefined();
    });
  });

  /**
   * Authorization, asserted by the one actor whose answer differs.
   *
   * | Deleted from shipped code | Caught by |
   * |---|---|
   * | `grants.controller.ts`: the guard or the permission on `GET /organizations/:id/grants` | `refuses a MEMBER listing an organization's grants` |
   * | `grants.controller.ts`: the guard or the permission on `POST /organizations/:id/grants` | `refuses a MEMBER issuing a grant, and issues nothing` |
   * | `grants.controller.ts`: the guard or the permission on `DELETE /organizations/:id/grants/:grantId` | `refuses a MEMBER revoking a grant, which stays` |
   */
  describe('authorization: what a role does and does not carry', () => {
    const GRANT_1 = '99999999-9999-4999-8999-999999999991';

    beforeEach(() => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, MEMBER, OrgRole.MEMBER);
    });

    it('refuses a MEMBER listing an organization\'s grants', async () => {
      seedGrant(GRANT_1, ORG_1, OWNER);

      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/grants`)
        .set('Authorization', bearer(MEMBER));

      expect(response.status).toBe(404);
    });

    it('refuses a MEMBER issuing a grant, and issues nothing', async () => {
      const response = await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/grants`)
        .set('Authorization', bearer(MEMBER))
        .send({
          subjectUserId: OWNER,
          resourceType: 'document',
          resourceId: 'doc-1',
          permission: 'organization:update',
        });

      expect(response.status).toBe(404);
      expect(source.all(ResourceGrantRecord)).toHaveLength(0);
    });

    it('refuses a MEMBER revoking a grant, which stays', async () => {
      seedGrant(GRANT_1, ORG_1, OWNER);

      const response = await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/grants/${GRANT_1}`)
        .set('Authorization', bearer(MEMBER));

      expect(response.status).toBe(404);
      expect(source.byId(ResourceGrantRecord, GRANT_1)).toBeDefined();
    });

    it('lets an ADMIN do all three, so the refusals above are about the role', async () => {
      // Without this the three cases above are equally satisfied by a guard
      // that refused everybody, which is a guard nobody notices is broken
      // until an organization cannot administer any grant at all.
      seedMembership(ORG_1, ADMIN, OrgRole.ADMIN);
      // Seeded directly, with a real UUID id: `FakeDataSource.insert` assigns
      // its own non-UUID id (`fake-ResourceGrantRecord-N`), which
      // `ParseUuidParamPipe` on the `DELETE` route would refuse outright — a
      // fact about this fake store, not about the route under test here.
      seedGrant(GRANT_1, ORG_1, OWNER);

      await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/grants`)
        .set('Authorization', bearer(ADMIN))
        .expect(200);

      await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/grants`)
        .set('Authorization', bearer(ADMIN))
        .send({
          subjectUserId: MEMBER,
          resourceType: 'document',
          resourceId: 'doc-1',
          permission: 'organization:update',
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/grants/${GRANT_1}`)
        .set('Authorization', bearer(ADMIN))
        .expect(204);
    });
  });

  describe('AuthorizationModule wires it, which no probe application can show', () => {
    it('registers GrantsController', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AuthorizationModule)).toContain(
        GrantsController,
      );
    });
  });
});
