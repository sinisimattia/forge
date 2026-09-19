import { INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import cookieParser from 'cookie-parser';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import request from 'supertest';
import type { Response } from 'supertest';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { AuditService } from '../../audit/audit.service';
import { FakeDataSource } from '../../common/testing';
import { RefreshTokenRecord } from '../../auth/entities/refresh-token-record.entity';
import { SessionRecord } from '../../auth/entities/session-record.entity';
import { PlatformAdminGuard } from '../../auth/guards';
import { REFRESH_COOKIE } from '../../auth/refresh-cookie';
import { SessionService } from '../../auth/session/session.service';
import { JwtStrategy } from '../../auth/strategies';
import { UserRecord } from '../user-record.entity';
import { UsersController } from '../users.controller';
import { UsersModule } from '../users.module';
import { UsersService } from '../users.service';

/**
 * The transport half of the profile and administration surface.
 *
 * What is asserted here and nowhere else is the **shape of a refusal**, which is
 * a property of what crosses the wire and invisible to a service test:
 *
 * - Every administrative route answers a non-administrator `404`, with the body
 *   a route that does not exist would produce. A `403` would confirm that the
 *   route is real and — on `GET /users/:id` — that the id in it names a real
 *   account, which is an enumeration oracle over every account on the
 *   deployment.
 * - That every administrative route on this controller is guarded **at all**.
 *   Deleting `@UseGuards(PlatformAdminGuard)` from one of them breaks no type
 *   and fails no lint rule; the service's own check keeps refusing, so a test
 *   asserting only "it was refused" stays green. The status is what changes,
 *   from 404 to 403, and {@link ADMIN_ROUTES} below drives the assertion over
 *   each of them so that none can be forgotten one at a time. The table is the
 *   list — no prose here repeats how many there are, because a count written
 *   beside a list is a count that goes stale the first time the list grows.
 */

const SIGNING_KEY = 'users-controller-spec-signing-key';

const ADA = '11111111-1111-4111-8111-111111111111' as UserId;
const GRACE = '22222222-2222-4222-8222-222222222222' as UserId;
const ROOT = '33333333-3333-4333-8333-333333333333' as UserId;
const SESSION = '44444444-4444-4444-8444-444444444444' as SessionId;

const EPOCH = new Date('2026-09-18T10:00:00.000Z');

const userRow = (id: string, platformRole: PlatformRole): Record<string, unknown> => ({
  id,
  email: `${id}@example.test`,
  displayName: `Name of ${id}`,
  status: UserStatus.ACTIVE,
  platformRole,
  emailVerifiedAt: EPOCH,
  createdAt: EPOCH,
  updatedAt: EPOCH,
  deletedAt: null,
});

describe('UsersController', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let source: FakeDataSource;

  beforeEach(async () => {
    source = new FakeDataSource();
    source.seed(UserRecord, [
      userRow(ADA, PlatformRole.PLATFORM_USER),
      userRow(GRACE, PlatformRole.PLATFORM_USER),
      userRow(ROOT, PlatformRole.PLATFORM_ADMIN),
    ]);

    const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
      source.getRepository(entity) as unknown as Repository<T>;

    const audit = new AuditService(
      repo<AuditEntryRecord>(AuditEntryRecord),
      repo<UserRecord>(UserRecord),
    );
    const sessions = new SessionService(
      repo<SessionRecord>(SessionRecord),
      repo<RefreshTokenRecord>(RefreshTokenRecord),
      new JwtService({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      source as unknown as DataSource,
    );
    const users = new UsersService(repo<UserRecord>(UserRecord), sessions, audit);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: SIGNING_KEY })] }),
        I18N,
        PassportModule,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [UsersController],
      providers: [
        // THE SHIPPED ARRAY, so the statuses below are the ones the application
        // really produces.
        ...GLOBAL_PROVIDERS,
        JwtStrategy,
        { provide: UsersService, useValue: users },
        { provide: AuditService, useValue: audit },
        // Constructed by the framework, exactly as the application constructs it.
        PlatformAdminGuard,
        { provide: getRepositoryToken(UserRecord), useValue: repo<UserRecord>(UserRecord) },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    jwt = moduleRef.get(JwtService);
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const bearer = (userId: UserId): string => `Bearer ${jwt.sign({ sub: userId, sid: SESSION })}`;

  /** Every administrative route, as a verb, a path and a body. */
  const ADMIN_ROUTES: [string, string, Record<string, unknown> | undefined][] = [
    ['get', '/users', undefined],
    ['get', `/users/${GRACE}`, undefined],
    ['patch', `/users/${GRACE}/platform-role`, { platformRole: PlatformRole.PLATFORM_ADMIN }],
    ['patch', `/users/${GRACE}/status`, { status: UserStatus.SUSPENDED }],
  ];

  const call = (verb: string, path: string, body?: Record<string, unknown>): Promise<Response> => {
    const agent = request(app.getHttpServer()) as unknown as Record<
      string,
      (path: string) => request.Test
    >;
    const test = agent[verb](path);
    return body === undefined ? test : test.send(body);
  };

  describe('the actor\'s own account', () => {
    it('is closed to a caller with no credential', async () => {
      await request(app.getHttpServer()).get('/users/me').expect(401);
    });

    it('returns the actor, not somebody else', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', bearer(ADA))
        .expect(200);

      expect(response.body.id).toBe(ADA);
    });

    it('is reached by `me` and not parsed as an identifier', async () => {
      // Route order. Declared the other way round, `GET /users/:id` matches
      // first, `me` fails the UUID pipe, and the endpoint every signed-in caller
      // uses answers 400 while every test that asks for a real id passes.
      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', bearer(ADA));

      expect(response.status).not.toBe(400);
    });

    it('carries exactly the keys core defines and survives its reviver', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', bearer(ADA))
        .expect(200);

      // The wire shape the webapp parses. A field added here is a field the
      // other side drops, silently and only for whoever added it.
      expect(Object.keys(response.body).sort().join(',')).toBe(
        'createdAt,deletedAt,displayName,email,emailVerifiedAt,id,platformRole,status,updatedAt',
      );
      expect(User.fromJSON(response.body)).toBeInstanceOf(User);
    });

    it('carries no secret material of any kind', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', bearer(ADA))
        .expect(200);

      const body = JSON.stringify(response.body).toLowerCase();
      for (const forbidden of ['secret', 'hash', 'password', 'argon', 'salt', 'token']) {
        expect(body).not.toContain(forbidden);
      }
    });

    it('changes the display name', async () => {
      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', bearer(ADA))
        .send({ displayName: 'Ada Lovelace' })
        .expect(200);

      expect(response.body.displayName).toBe('Ada Lovelace');
    });

    it('refuses a body carrying a field the profile shape does not declare', async () => {
      // `forbidNonWhitelisted`. Without it, `platformRole` in a profile update is
      // silently dropped and the caller believes they were refused nothing.
      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', bearer(ADA))
        .send({ displayName: 'Ada', platformRole: PlatformRole.PLATFORM_ADMIN })
        .expect(400);
      expect(source.byId(UserRecord, ADA)?.platformRole).toBe(PlatformRole.PLATFORM_USER);
    });

    it('closes the account and clears the renewal cookie with it', async () => {
      const response = await request(app.getHttpServer())
        .delete('/users/me')
        .set('Authorization', bearer(ADA))
        .expect(204);

      expect(source.byId(UserRecord, ADA)?.deletedAt).not.toBeNull();

      // Clearing matters as much as the soft delete: the renewal credential is a
      // value in a browser, and a browser that keeps it presents it on every
      // renewal after the account has gone.
      const raw = response.headers['set-cookie'];
      const cookie = Array.isArray(raw) ? raw.join('\n') : String(raw);
      expect(cookie).toContain(`${REFRESH_COOKIE.name}=;`);
      expect(cookie).toContain('Path=/auth');
    });
  });

  describe('the administrative routes', () => {
    it.each(ADMIN_ROUTES)('%s %s is closed to a caller with no credential', async (verb, path, body) => {
      const response = await call(verb, path, body);
      expect(response.status).toBe(401);
    });

    it.each(ADMIN_ROUTES)('%s %s answers a non-administrator 404, not 403', async (verb, path, body) => {
      // 404 is the assertion, and it is what makes the guard's deletion visible:
      // without it the request reaches `UsersService`, whose own check refuses
      // with 403. Driven over every route by a table so that one of them cannot
      // lose its guard unnoticed.
      const test = call(verb, path, body);
      const response = await (test as request.Test).set('Authorization', bearer(ADA));
      expect(response.status).toBe(404);
    });

    it.each(ADMIN_ROUTES)('%s %s changes nothing when it refuses', async (verb, path, body) => {
      const test = call(verb, path, body);
      await (test as request.Test).set('Authorization', bearer(ADA));

      expect(source.byId(UserRecord, GRACE)).toMatchObject({
        status: UserStatus.ACTIVE,
        platformRole: PlatformRole.PLATFORM_USER,
      });
    });

    it('gives a non-administrator the body a route that does not exist gives', async () => {
      const refused = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', bearer(ADA));
      const missing = await request(app.getHttpServer())
        .get('/users/nothing/is/mounted/here')
        .set('Authorization', bearer(ADA));

      expect(refused.status).toBe(missing.status);
      expect(refused.body).toStrictEqual(missing.body);
    });

    it('lets an administrator list accounts', async () => {
      const response = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', bearer(ROOT))
        .expect(200);

      expect(response.body.data).toHaveLength(3);
      expect(response.body.meta.total).toBe(3);
    });

    it('lets an administrator read one account, and records the override', async () => {
      const response = await request(app.getHttpServer())
        .get(`/users/${GRACE}`)
        .set('Authorization', bearer(ROOT))
        .expect(200);

      expect(response.body.id).toBe(GRACE);

      // The override, asserted here and not only in the 404 table above, because
      // this route is the one whose guard the table CANNOT see: `UsersService`
      // answers an unentitled reader with `UserNotFoundError`, which is also a
      // 404, so deleting `@UseGuards` from this route changes no status. What it
      // does change is that an administrator reads somebody else's profile and
      // nothing records it — which spec §9.5 requires and which was measured to
      // stay green before this assertion existed.
      const overrides = source
        .all(AuditEntryRecord)
        .filter((entry) => entry.action === AuditAction.PLATFORM_ADMIN_OVERRIDE);
      expect(overrides).toHaveLength(1);
      expect(String((overrides[0].metadata as { path: string }).path)).toContain(GRACE);
    });

    it('lets an administrator suspend and reinstate', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${GRACE}/status`)
        .set('Authorization', bearer(ROOT))
        .send({ status: UserStatus.SUSPENDED })
        .expect(200);
      expect(source.byId(UserRecord, GRACE)?.status).toBe(UserStatus.SUSPENDED);

      await request(app.getHttpServer())
        .patch(`/users/${GRACE}/status`)
        .set('Authorization', bearer(ROOT))
        .send({ status: UserStatus.ACTIVE })
        .expect(200);
      expect(source.byId(UserRecord, GRACE)?.status).toBe(UserStatus.ACTIVE);
    });

    it('lets an administrator grant platform administration', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${GRACE}/platform-role`)
        .set('Authorization', bearer(ROOT))
        .send({ platformRole: PlatformRole.PLATFORM_ADMIN })
        .expect(200);

      expect(source.byId(UserRecord, GRACE)?.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);
    });

    it('refuses an administrator withdrawing their own standing, over the wire', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${ROOT}/platform-role`)
        .set('Authorization', bearer(ROOT))
        .send({ platformRole: PlatformRole.PLATFORM_USER })
        .expect(400);

      expect(source.byId(UserRecord, ROOT)?.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);
    });

    it('refuses an administrator suspending themselves, over the wire', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${ROOT}/status`)
        .set('Authorization', bearer(ROOT))
        .send({ status: UserStatus.SUSPENDED })
        .expect(400);

      expect(source.byId(UserRecord, ROOT)?.status).toBe(UserStatus.ACTIVE);
    });

    it('refuses a standing outside the enum', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${GRACE}/platform-role`)
        .set('Authorization', bearer(ROOT))
        .send({ platformRole: 'SUPERUSER' })
        .expect(400);
    });

    it('records an override for each administrative pass, and none for a refusal', async () => {
      await request(app.getHttpServer()).get('/users').set('Authorization', bearer(ROOT));
      await request(app.getHttpServer()).get('/users').set('Authorization', bearer(ADA));

      const overrides = source
        .all(AuditEntryRecord)
        .filter((entry) => entry.action === AuditAction.PLATFORM_ADMIN_OVERRIDE);
      expect(overrides).toHaveLength(1);
      expect(overrides[0].actorUserId).toBe(ROOT);
    });

    it('does not guard the actor\'s own routes', async () => {
      // The other direction, so "guard everything" cannot satisfy the table
      // above: an ordinary person must still reach their own account, and a
      // guard accidentally applied at class level would close it to everybody
      // but administrators.
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', bearer(ADA))
        .expect(200);

      const overrides = source
        .all(AuditEntryRecord)
        .filter((entry) => entry.action === AuditAction.PLATFORM_ADMIN_OVERRIDE);
      expect(overrides).toHaveLength(0);
    });
  });

  describe('UsersModule wires it, which no probe application can show', () => {
    it('registers the controller, without which /users exists nowhere', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, UsersModule)).toContain(
        UsersController,
      );
    });

    it('provides the service and the guard the controller resolves', () => {
      const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, UsersModule);
      expect(providers).toContain(UsersService);
      // Without this the application fails at start-up, which is a moment no
      // spec in this backend reaches.
      expect(providers).toContain(PlatformAdminGuard);
    });
  });
});
