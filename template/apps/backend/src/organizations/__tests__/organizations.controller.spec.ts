import { INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import request from 'supertest';
import type { Response } from 'supertest';
import { Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { AuditService } from '../../audit/audit.service';
import { FakeDataSource } from '../../common/testing';
import { JwtStrategy } from '../../auth/strategies';
import { UserRecord } from '../../users/user-record.entity';
import { MembershipRecord } from '../membership-record.entity';
import { OrganizationRecord } from '../organization-record.entity';
import { OrganizationsController } from '../organizations.controller';
import { OrganizationsModule } from '../organizations.module';
import { OrganizationsService } from '../organizations.service';

/**
 * The transport half of organization CRUD.
 *
 * What is asserted here and nowhere else is the shape of the request and the
 * response: that every route is closed to a caller with no credential, that
 * `forbidNonWhitelisted` refuses a body carrying a field the DTO does not
 * declare, and that a handler delegates to `OrganizationsService` rather than
 * reimplementing it. Behaviour that does not depend on the wire — the
 * transaction, the audit entries, the tenant-scoped read — is
 * `organizations.service.spec.ts`'s job.
 *
 * `PermissionsGuard` is not on any of these routes yet (Task 13), so every
 * assertion below is about authentication, never authorization: a caller
 * with any valid credential may act on any organization they are a member
 * of, and nothing here is a test of who may do what once they are.
 */

const OWNER = '11111111-1111-4111-8111-111111111111' as UserId;
const OUTSIDER = '22222222-2222-4222-8222-222222222222' as UserId;
const SESSION = '33333333-3333-4333-8333-333333333333' as SessionId;

// `:id` runs through `ParseUuidParamPipe`, so every seeded organization id
// used in a path has to be UUID-shaped, unlike the service spec's plain
// strings.
const ORG_1 = '44444444-4444-4444-8444-444444444444';
const ORG_MINE = '55555555-5555-4555-8555-555555555555';
const ORG_THEIRS = '66666666-6666-4666-8666-666666666666';
const ORG_ABSENT = '77777777-7777-4777-8777-777777777777';

const SIGNING_KEY = 'organizations-controller-spec-signing-key';

const EPOCH = new Date('2026-09-20T10:00:00.000Z');

describe('OrganizationsController', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let source: FakeDataSource;

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  beforeEach(async () => {
    source = new FakeDataSource();

    const audit = new AuditService(
      repo<AuditEntryRecord>(AuditEntryRecord),
      repo<UserRecord>(UserRecord),
    );
    const organizations = new OrganizationsService(
      repo<OrganizationRecord>(OrganizationRecord),
      repo<MembershipRecord>(MembershipRecord),
      source as unknown as DataSource,
      audit,
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: SIGNING_KEY })] }),
        I18N,
        PassportModule,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [OrganizationsController],
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

  /** Seeds an organization with `owner` as its sole OWNER. */
  const seedOrganization = (id: string, name: string, slug: string, owner: string): void => {
    source.seed(OrganizationRecord, [
      { id, name, slug, createdAt: EPOCH, updatedAt: EPOCH, deletedAt: null },
    ]);
    source.seed(MembershipRecord, [
      {
        id: `membership-${id}`,
        organizationId: id,
        userId: owner,
        role: OrgRole.OWNER,
        createdAt: EPOCH,
        updatedAt: EPOCH,
      },
    ]);
  };

  /** Every route this controller mounts, as a verb, a path and a body. */
  const ROUTES: [string, string, Record<string, unknown> | undefined][] = [
    ['post', '/organizations', { name: 'Acme Works', slug: 'acme-works' }],
    ['get', '/organizations', undefined],
    ['get', `/organizations/${ORG_1}`, undefined],
    ['patch', `/organizations/${ORG_1}`, { name: 'Renamed' }],
    ['delete', `/organizations/${ORG_1}`, undefined],
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

  describe('POST /organizations', () => {
    it('creates an organization and returns it', async () => {
      const response = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', bearer(OWNER))
        .send({ name: 'Acme Works', slug: 'acme-works' })
        .expect(201);

      expect(response.body).toMatchObject({ name: 'Acme Works', slug: 'acme-works' });
      expect(Organization.fromJSON(response.body)).toBeInstanceOf(Organization);
    });

    it('makes the caller its OWNER', async () => {
      const response = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', bearer(OWNER))
        .send({ name: 'Acme Works', slug: 'acme-works' })
        .expect(201);

      const memberships = source
        .all(MembershipRecord)
        .filter((row) => row.organizationId === response.body.id);
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({ userId: OWNER, role: OrgRole.OWNER });
    });

    it('refuses a body carrying a field this DTO does not declare', async () => {
      await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', bearer(OWNER))
        .send({ name: 'Acme Works', slug: 'acme-works', ownerId: OWNER })
        .expect(400);
    });

    it('refuses a blank name, mapped by the domain rather than the DTO', async () => {
      // `IsNotEmpty` catches a literal empty string; `'   '` passes the DTO and
      // is refused by `Organization`'s own invariant instead — this is the
      // seam between the two layers, not a gap in either.
      await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', bearer(OWNER))
        .send({ name: '   ', slug: 'acme-works' })
        .expect(422);
    });
  });

  describe('GET /organizations', () => {
    it('lists only the caller\'s own organizations', async () => {
      seedOrganization(ORG_MINE, 'Mine', 'mine', OWNER);
      seedOrganization(ORG_THEIRS, 'Theirs', 'theirs', OUTSIDER);

      const response = await request(app.getHttpServer())
        .get('/organizations')
        .set('Authorization', bearer(OWNER))
        .expect(200);

      expect(response.body.data.map((organization: { id: string }) => organization.id)).toEqual([
        ORG_MINE,
      ]);
      expect(response.body.meta.total).toBe(1);
    });
  });

  describe('GET /organizations/:id', () => {
    it('returns the organization for a member', async () => {
      seedOrganization(ORG_1, 'Acme Works', 'acme-works', OWNER);

      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}`)
        .set('Authorization', bearer(OWNER))
        .expect(200);

      expect(response.body.id).toBe(ORG_1);
    });

    it('does not reveal an organization to a non-member', async () => {
      seedOrganization(ORG_1, 'Acme Works', 'acme-works', OWNER);

      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}`)
        .set('Authorization', bearer(OUTSIDER));

      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('Acme Works');
    });

    // The property `OrganizationNotFoundError`'s shared refusal exists for:
    // a non-member and a never-issued id must be ONE answer, not two that
    // happen to share a status. Comparing statuses alone would pass an
    // implementation that answered 404 to both but put "you are not a member
    // of this organization" in one body and "no such organization" in the
    // other — which leaks exactly what the shared status was chosen to hide,
    // through the one channel a status code cannot close.
    it('answers a non-member exactly as it answers an id nobody ever issued', async () => {
      seedOrganization(ORG_1, 'Acme Works', 'acme-works', OWNER);

      const notMine = await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}`)
        .set('Authorization', bearer(OUTSIDER));

      const neverIssued = await request(app.getHttpServer())
        .get(`/organizations/${ORG_ABSENT}`)
        .set('Authorization', bearer(OUTSIDER));

      expect(notMine.status).toBe(neverIssued.status);
      expect(notMine.body).toStrictEqual(neverIssued.body);
    });
  });

  describe('PATCH /organizations/:id', () => {
    it('changes the name', async () => {
      seedOrganization(ORG_1, 'Acme Works', 'acme-works', OWNER);

      const response = await request(app.getHttpServer())
        .patch(`/organizations/${ORG_1}`)
        .set('Authorization', bearer(OWNER))
        .send({ name: 'Renamed Works' })
        .expect(200);

      expect(response.body.name).toBe('Renamed Works');
      expect(source.byId(OrganizationRecord, ORG_1)?.name).toBe('Renamed Works');
    });

    it('refuses a non-member, and changes nothing', async () => {
      seedOrganization(ORG_1, 'Acme Works', 'acme-works', OWNER);

      await request(app.getHttpServer())
        .patch(`/organizations/${ORG_1}`)
        .set('Authorization', bearer(OUTSIDER))
        .send({ name: 'Hijacked' });

      expect(source.byId(OrganizationRecord, ORG_1)?.name).toBe('Acme Works');
    });

    it('refuses a body carrying a field this DTO does not declare', async () => {
      seedOrganization(ORG_1, 'Acme Works', 'acme-works', OWNER);

      await request(app.getHttpServer())
        .patch(`/organizations/${ORG_1}`)
        .set('Authorization', bearer(OWNER))
        .send({ name: 'Renamed', deletedAt: null })
        .expect(400);
    });
  });

  describe('DELETE /organizations/:id', () => {
    it('soft-deletes the organization', async () => {
      seedOrganization(ORG_1, 'Acme Works', 'acme-works', OWNER);

      await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}`)
        .set('Authorization', bearer(OWNER))
        .expect(204);

      expect(source.byId(OrganizationRecord, ORG_1)?.deletedAt).not.toBeNull();
    });

    it('refuses a non-member, and deletes nothing', async () => {
      seedOrganization(ORG_1, 'Acme Works', 'acme-works', OWNER);

      await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}`)
        .set('Authorization', bearer(OUTSIDER));

      expect(source.byId(OrganizationRecord, ORG_1)?.deletedAt).toBeNull();
    });
  });

  describe('the wire shape every caller is given', () => {
    it('carries exactly the keys core defines', async () => {
      const response = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', bearer(OWNER))
        .send({ name: 'Acme Works', slug: 'acme-works' })
        .expect(201);

      expect(Object.keys(response.body).sort().join(',')).toBe(
        'createdAt,deletedAt,id,name,slug,updatedAt',
      );
    });
  });

  describe('OrganizationsModule wires it, which no probe application can show', () => {
    it('registers the controller, without which /organizations exists nowhere', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, OrganizationsModule)).toContain(
        OrganizationsController,
      );
    });

    it('provides and exports the service', () => {
      const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, OrganizationsModule);
      expect(providers).toContain(OrganizationsService);
      expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, OrganizationsModule)).toContain(
        OrganizationsService,
      );
    });
  });
});
