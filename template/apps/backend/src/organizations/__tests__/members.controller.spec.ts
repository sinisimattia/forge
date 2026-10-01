import { INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import request from 'supertest';
import type { Response } from 'supertest';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { AuditService } from '../../audit/audit.service';
import { FakeDataSource, UNMETERED_THROTTLING } from '../../common/testing';
import { PermissionsGuard, PrincipalService } from '../../authorization';
import { ResourceGrantRecord } from '../../authorization/resource-grant-record.entity';
import { JwtStrategy } from '../../auth/strategies';
import type { IMailer } from '../../mail';
import { UserRecord } from '../../users/user-record.entity';
import { InvitationRecord } from '../invitation-record.entity';
import { MembersController } from '../members.controller';
import { MembershipRecord } from '../membership-record.entity';
import { OrganizationRecord } from '../organization-record.entity';
import { OrganizationsModule } from '../organizations.module';
import { OrganizationsService } from '../organizations.service';

/** This suite exercises none of the invitation mail; a stub that records nothing suffices. */
const NOOP_MAILER: IMailer = { send: async () => undefined };

const WEBAPP_URL = 'https://app.example.test';

/**
 * The transport half of members: listing, role changes, removal.
 *
 * Same division of labour as `organizations.controller.spec.ts`: this file
 * asserts the shape of the request and the response, and that a route
 * delegates to `OrganizationsService` rather than reimplementing it. The
 * invariant itself — the owner count, the transaction, "whoever is asking" —
 * is `organizations.service.spec.ts`'s job; what belongs here is that a
 * `LastOwnerError` the service throws reaches the wire as the status this
 * backend chose for it (409), and that the non-member/never-issued collapse
 * `OrganizationsController` observes holds on this controller too.
 *
 * `@UseGuards(PermissionsGuard)` sits on all three routes. The last
 * describe block is what can tell a guarded route from an unguarded one here:
 * a MEMBER may see who else belongs and may change nobody's role, and the
 * service — which asks only whether the actor holds a membership — cannot tell
 * those two apart.
 */

const OWNER = '11111111-1111-4111-8111-111111111111' as UserId;
const ADMIN = '22222222-2222-4222-8222-222222222222' as UserId;
const MEMBER = '33333333-3333-4333-8333-333333333333' as UserId;
const OUTSIDER = '44444444-4444-4444-8444-444444444444' as UserId;
const SESSION = '55555555-5555-4555-8555-555555555555' as SessionId;

const ORG_1 = '66666666-6666-4666-8666-666666666666';
const ORG_ABSENT = '77777777-7777-4777-8777-777777777777';

const SIGNING_KEY = 'members-controller-spec-signing-key';

const EPOCH = new Date('2026-09-20T10:00:00.000Z');

describe('MembersController', () => {
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
    const organizations = new OrganizationsService(
      repo<OrganizationRecord>(OrganizationRecord),
      repo<MembershipRecord>(MembershipRecord),
      repo<InvitationRecord>(InvitationRecord),
      repo<UserRecord>(UserRecord),
      source as unknown as DataSource,
      audit,
      NOOP_MAILER,
      new ConfigService({ PUBLIC_WEBAPP_URL: WEBAPP_URL }),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: SIGNING_KEY })] }),
        I18N,
        PassportModule,
        UNMETERED_THROTTLING,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [MembersController],
      providers: [
        // THE SHIPPED ARRAY, so the statuses below are the ones the
        // application really produces.
        ...GLOBAL_PROVIDERS,
        JwtStrategy,
        { provide: OrganizationsService, useValue: organizations },
        { provide: AuditService, useValue: audit },
        {
          provide: getRepositoryToken(OrganizationRecord),
          useValue: repo<OrganizationRecord>(OrganizationRecord),
        },
        {
          provide: getRepositoryToken(MembershipRecord),
          useValue: repo<MembershipRecord>(MembershipRecord),
        },
        // Constructed by the framework, exactly as the application constructs
        // them — the guard the routes name and the hydrator it asks.
        PermissionsGuard,
        PrincipalService,
        { provide: getRepositoryToken(UserRecord), useValue: repo<UserRecord>(UserRecord) },
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

  /**
   * Seeds a real account.
   *
   * Every actor below needs one now: `PrincipalService` reads the platform role
   * off the row rather than out of the credential, so a credential whose subject
   * has no row is refused — which is the property, not an inconvenience.
   */
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
      { id, name: 'Acme Works', slug: 'acme-works', createdAt: EPOCH, updatedAt: EPOCH, deletedAt: null },
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

  /** Every route this controller mounts, as a verb, a path and a body. */
  const ROUTES: [string, string, Record<string, unknown> | undefined][] = [
    ['get', `/organizations/${ORG_1}/members`, undefined],
    ['patch', `/organizations/${ORG_1}/members/${MEMBER}`, { role: 'ADMIN' }],
    ['delete', `/organizations/${ORG_1}/members/${MEMBER}`, undefined],
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

  describe('GET /organizations/:id/members', () => {
    it('lists the members for a caller who belongs to the organization', async () => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, MEMBER, OrgRole.MEMBER);

      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/members`)
        .set('Authorization', bearer(OWNER))
        .expect(200);

      expect(response.body.meta.total).toBe(2);
      expect(response.body.data.map((m: { userId: string }) => m.userId).sort()).toEqual(
        [OWNER, MEMBER].sort(),
      );
    });

    it('does not reveal a non-member organization\'s members', async () => {
      seedOrganization(ORG_1, OWNER);

      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/members`)
        .set('Authorization', bearer(OUTSIDER));

      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('Acme Works');
    });

    // The same collapse `OrganizationsController` guards: a non-member and a
    // never-issued organization id must be ONE answer, in status and in body.
    it('answers a non-member exactly as it answers an id nobody ever issued', async () => {
      seedOrganization(ORG_1, OWNER);

      const notMine = await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/members`)
        .set('Authorization', bearer(OUTSIDER));

      const neverIssued = await request(app.getHttpServer())
        .get(`/organizations/${ORG_ABSENT}/members`)
        .set('Authorization', bearer(OUTSIDER));

      expect(notMine.status).toBe(neverIssued.status);
      expect(notMine.body).toStrictEqual(neverIssued.body);
    });
  });

  describe('PATCH /organizations/:id/members/:userId', () => {
    it('changes a member\'s role', async () => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, MEMBER, OrgRole.MEMBER);

      const response = await request(app.getHttpServer())
        .patch(`/organizations/${ORG_1}/members/${MEMBER}`)
        .set('Authorization', bearer(OWNER))
        .send({ role: 'ADMIN' })
        .expect(200);

      expect(response.body.role).toBe('ADMIN');
      expect(source.byId(MembershipRecord, `membership-${ORG_1}-${MEMBER}`)?.role).toBe('ADMIN');
    });

    it('refuses a body carrying a field this DTO does not declare', async () => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, MEMBER, OrgRole.MEMBER);

      await request(app.getHttpServer())
        .patch(`/organizations/${ORG_1}/members/${MEMBER}`)
        .set('Authorization', bearer(OWNER))
        .send({ role: 'ADMIN', userId: MEMBER })
        .expect(400);
    });

    it('refuses a role this DTO does not recognize', async () => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, MEMBER, OrgRole.MEMBER);

      await request(app.getHttpServer())
        .patch(`/organizations/${ORG_1}/members/${MEMBER}`)
        .set('Authorization', bearer(OWNER))
        .send({ role: 'SUPREME_LEADER' })
        .expect(400);
    });

    it('rejects a target who is not a member, with 404', async () => {
      seedOrganization(ORG_1, OWNER);

      await request(app.getHttpServer())
        .patch(`/organizations/${ORG_1}/members/${MEMBER}`)
        .set('Authorization', bearer(OWNER))
        .send({ role: 'ADMIN' })
        .expect(404);
    });

    // D15 reaching the wire: whoever asks, demoting the sole OWNER is
    // refused, and refused with 409 — a legal request the CURRENT state of
    // the membership set refuses, not a hidden thing and not a malformed
    // request.
    it('refuses to demote the last owner, whoever is asking, with 409', async () => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, ADMIN, OrgRole.ADMIN);

      const response = await request(app.getHttpServer())
        .patch(`/organizations/${ORG_1}/members/${OWNER}`)
        .set('Authorization', bearer(ADMIN))
        .send({ role: 'ADMIN' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('LAST_OWNER');
      expect(source.byId(MembershipRecord, `membership-${ORG_1}-${OWNER}`)?.role).toBe(OrgRole.OWNER);
    });

    it('allows demoting an owner once another owner exists', async () => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, ADMIN, OrgRole.OWNER);

      await request(app.getHttpServer())
        .patch(`/organizations/${ORG_1}/members/${ADMIN}`)
        .set('Authorization', bearer(OWNER))
        .send({ role: 'ADMIN' })
        .expect(200);
    });
  });

  describe('DELETE /organizations/:id/members/:userId', () => {
    it('removes a member', async () => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, MEMBER, OrgRole.MEMBER);

      await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/members/${MEMBER}`)
        .set('Authorization', bearer(OWNER))
        .expect(204);

      expect(source.byId(MembershipRecord, `membership-${ORG_1}-${MEMBER}`)).toBeUndefined();
    });

    it('rejects a target who is not a member, with 404', async () => {
      seedOrganization(ORG_1, OWNER);

      await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/members/${MEMBER}`)
        .set('Authorization', bearer(OWNER))
        .expect(404);
    });

    it('refuses to remove the last owner, whoever is asking, with 409', async () => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, ADMIN, OrgRole.ADMIN);

      const response = await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/members/${OWNER}`)
        .set('Authorization', bearer(ADMIN));

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('LAST_OWNER');
      expect(source.byId(MembershipRecord, `membership-${ORG_1}-${OWNER}`)).toBeDefined();
    });

    it('allows an owner to leave once another owner exists', async () => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, ADMIN, OrgRole.OWNER);

      await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/members/${ADMIN}`)
        .set('Authorization', bearer(OWNER))
        .expect(204);
    });
  });

  /**
   * Authorization, asserted by the one actor whose answer differs.
   *
   * | Deleted from shipped code | Caught by |
   * |---|---|
   * | `members.controller.ts`: the guard or the permission on `PATCH /organizations/:id/members/:userId` | `refuses a MEMBER changing somebody else's role` |
   * | `members.controller.ts`: the guard or the permission on `DELETE /organizations/:id/members/:userId` | `refuses a MEMBER removing somebody` |
   */
  describe('authorization: what a role does and does not carry', () => {
    beforeEach(() => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, MEMBER, OrgRole.MEMBER);
    });

    it('lets a MEMBER see who else belongs, which `member:read` is', async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/members`)
        .set('Authorization', bearer(MEMBER))
        .expect(200);
    });

    it('refuses a MEMBER changing somebody else\'s role', async () => {
      seedMembership(ORG_1, ADMIN, OrgRole.ADMIN);

      const response = await request(app.getHttpServer())
        .patch(`/organizations/${ORG_1}/members/${ADMIN}`)
        .set('Authorization', bearer(MEMBER))
        .send({ role: 'VIEWER' });

      expect(response.status).toBe(404);
      expect(source.byId(MembershipRecord, `membership-${ORG_1}-${ADMIN}`)?.role).toBe(
        OrgRole.ADMIN,
      );
    });

    it('refuses a MEMBER removing somebody', async () => {
      seedMembership(ORG_1, ADMIN, OrgRole.ADMIN);

      const response = await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/members/${ADMIN}`)
        .set('Authorization', bearer(MEMBER));

      expect(response.status).toBe(404);
      expect(source.byId(MembershipRecord, `membership-${ORG_1}-${ADMIN}`)).toBeDefined();
    });

    it('refuses a VIEWER even the member list', async () => {
      // `ROLE_PERMISSIONS[VIEWER]` is `organization:read` alone, so a VIEWER
      // belongs to the organization and may not see who else does. Without the
      // guard the service shows them the whole list.
      seedMembership(ORG_1, OUTSIDER, OrgRole.VIEWER);

      await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/members`)
        .set('Authorization', bearer(OUTSIDER))
        .expect(404);
    });
  });

  describe('OrganizationsModule wires it, which no probe application can show', () => {
    it('registers MembersController', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, OrganizationsModule)).toContain(
        MembersController,
      );
    });
  });
});
