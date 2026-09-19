import { ForbiddenException, INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { ObjectLiteral, Repository } from 'typeorm';
import request from 'supertest';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { FakeDataSource } from '../../auth/__tests__/fake-data-source';
import { PlatformAdminGuard } from '../../auth/guards';
import { JwtStrategy } from '../../auth/strategies';
import { UserRecord } from '../../users/user-record.entity';
import { AuditEntryRecord } from '../audit-entry-record.entity';
import { AuditController } from '../audit.controller';
import { AuditModule } from '../audit.module';
import { AuditService } from '../audit.service';

/**
 * Reading the deployment's history, and the guard that decides who may.
 *
 * **`PlatformAdminGuard` is the exact shape of wiring that hides.** Deleting it
 * from a controller breaks no type, fails no lint rule, and opens an
 * administrative endpoint to everybody — and the service's own check would go on
 * refusing, so a test that only asserted "a non-administrator is refused" would
 * stay green through the deletion. That is why the tests below assert the
 * *status* of the refusal and not merely that there was one: the guard answers
 * 404 and the service answers 403, so removing the guard changes the answer a
 * stranger gets and a test sees it.
 *
 * The second half is here for the reason `__tests__/composition-root.spec.ts`
 * exists: the probe application below registers the guard itself, because it has
 * to in order to exercise it at all, which would hide the guard's absence from
 * the real `AuditModule`. So the module's own metadata is read back separately.
 */

const SIGNING_KEY = 'audit-controller-spec-signing-key';

const ADA = '11111111-1111-4111-8111-111111111111' as UserId;
const ROOT = '22222222-2222-4222-8222-222222222222' as UserId;
const SESSION = '33333333-3333-4333-8333-333333333333' as SessionId;

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

const entryRow = (id: string, action: AuditAction, at: string): Record<string, unknown> => ({
  id,
  organizationId: null,
  actorUserId: ADA,
  action,
  resourceType: 'user',
  resourceId: ADA,
  metadata: {},
  clientAddress: null,
  clientLabel: null,
  occurredAt: new Date(at),
});

describe('AuditController', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let source: FakeDataSource;
  let audit: AuditService;

  beforeEach(async () => {
    source = new FakeDataSource();
    source.seed(UserRecord, [
      userRow(ADA, PlatformRole.PLATFORM_USER),
      userRow(ROOT, PlatformRole.PLATFORM_ADMIN),
    ]);
    source.seed(AuditEntryRecord, [
      entryRow('entry-1', AuditAction.USER_REGISTERED, '2026-09-18T09:00:00Z'),
      entryRow('entry-2', AuditAction.LOGIN_SUCCEEDED, '2026-09-18T10:00:00Z'),
      entryRow('entry-3', AuditAction.LOGIN_FAILED, '2026-09-18T11:00:00Z'),
    ]);

    const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
      source.getRepository(entity) as unknown as Repository<T>;

    // The real service and the real guard over the in-memory store. Not fakes:
    // the guard's audit write is one of the things under test, and a fake
    // service would be the thing recording it.
    audit = new AuditService(
      repo<AuditEntryRecord>(AuditEntryRecord),
      repo<UserRecord>(UserRecord),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: SIGNING_KEY })] }),
        I18N,
        PassportModule,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [AuditController],
      providers: [
        // THE SHIPPED ARRAY — the global guard, the validation pipe and the
        // exception filter are the application's own, so the statuses compared
        // below are the ones a caller really receives.
        ...GLOBAL_PROVIDERS,
        JwtStrategy,
        { provide: AuditService, useValue: audit },
        // The guard is constructed BY the framework from the repository token,
        // exactly as the application constructs it — not handed over as an
        // instance this file built. An instance would still be the shipped
        // class, but it would not prove the class is one the framework can
        // actually resolve, and an unresolvable guard is a start-up failure no
        // spec here reaches.
        PlatformAdminGuard,
        { provide: getRepositoryToken(UserRecord), useValue: repo<UserRecord>(UserRecord) },
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

  /** Every `PLATFORM_ADMIN_OVERRIDE` the store now holds. */
  const overrides = (): Record<string, unknown>[] =>
    source
      .all(AuditEntryRecord)
      .filter((entry) => entry.action === AuditAction.PLATFORM_ADMIN_OVERRIDE);

  describe('who may read it', () => {
    it('is closed to a caller with no credential at all', async () => {
      await request(app.getHttpServer()).get('/audit').expect(401);
    });

    it('answers a non-administrator 404, not 403', async () => {
      // 404 and not 403 is the assertion, and it is what makes the guard's
      // deletion visible: without `@UseGuards(PlatformAdminGuard)` this request
      // reaches `AuditService.query`, which refuses it with 403, and the number
      // here changes. A test that only asserted "refused" would stay green.
      //
      // It is also the property on its own terms: a 403 confirms the route
      // exists to somebody who may not use it.
      await request(app.getHttpServer())
        .get('/audit')
        .set('Authorization', bearer(ADA))
        .expect(404);
    });

    it('gives a non-administrator the same body a missing route gives', async () => {
      const refused = await request(app.getHttpServer())
        .get('/audit')
        .set('Authorization', bearer(ADA));
      const missing = await request(app.getHttpServer())
        .get('/audit/nothing-is-mounted-here')
        .set('Authorization', bearer(ADA));

      // Same status and same prose. "You may not" and "there is no such thing"
      // have to be one answer, or the refusal is itself the information.
      expect(refused.status).toBe(missing.status);
      expect(refused.body).toStrictEqual(missing.body);
    });

    it('lets a platform administrator read it', async () => {
      const response = await request(app.getHttpServer())
        .get('/audit')
        .set('Authorization', bearer(ROOT))
        .expect(200);

      // Four, not three: the guard records this very read before the handler
      // runs, so the page contains the entry the request itself caused. See the
      // block below, which is where that is asserted as a property rather than
      // discovered as an off-by-one.
      expect(response.body.data).toHaveLength(4);
      expect(response.body.meta).toMatchObject({ total: 4, page: 1, limit: 20 });
    });

    it('records nothing when it refuses', async () => {
      await request(app.getHttpServer()).get('/audit').set('Authorization', bearer(ADA));

      // Otherwise anybody could fill an append-only table by asking for a route
      // they cannot reach — and a refusal is not an override, it is the ordinary
      // answer.
      expect(overrides()).toHaveLength(0);
    });
  });

  describe('every pass is recorded', () => {
    it('writes one PLATFORM_ADMIN_OVERRIDE per read', async () => {
      await request(app.getHttpServer()).get('/audit').set('Authorization', bearer(ROOT));
      expect(overrides()).toHaveLength(1);

      await request(app.getHttpServer()).get('/audit').set('Authorization', bearer(ROOT));
      expect(overrides()).toHaveLength(2);
    });

    it('names the administrator and what they reached', async () => {
      await request(app.getHttpServer())
        .get('/audit?action=LOGIN_FAILED')
        .set('Authorization', bearer(ROOT));

      const entry = overrides()[0];
      expect(entry.actorUserId).toBe(ROOT);
      expect(entry.resourceType).toBe('platform');
      // What was reached, or the entry says only that a power was used and not
      // which one.
      expect(entry.metadata).toMatchObject({ method: 'GET' });
      expect(String((entry.metadata as { path: string }).path)).toContain('/audit');
    });

    it('is a read that appends to the thing being read, and says so in its own answer', async () => {
      // Stated as an assertion rather than only in prose, because it is
      // surprising and because somebody will eventually decide it is a bug. It
      // is not: spec §9.5 requires every platform-administrative pass to be
      // logged and this is one. `audit.controller.ts` documents what it costs an
      // administrator paging through results, and what the fix would be.
      //
      // The guard runs before the handler, so a read's own entry is in the page
      // that read returns — the history grows by one on every look at it.
      const first = await request(app.getHttpServer())
        .get('/audit')
        .set('Authorization', bearer(ROOT))
        .expect(200);
      expect(first.body.meta.total).toBe(4);
      expect(first.body.data[0].action).toBe(AuditAction.PLATFORM_ADMIN_OVERRIDE);

      const second = await request(app.getHttpServer())
        .get('/audit')
        .set('Authorization', bearer(ROOT))
        .expect(200);
      expect(second.body.meta.total).toBe(5);
    });

    it('pushes the last row of page 1 onto page 2, which is what that costs', async () => {
      // The concrete consequence, pinned so nobody has to rediscover it from a
      // bug report: offset paging over a table the reader is appending to is
      // unstable, and here the reader is the one appending. The fix is an upper
      // bound on the window shared by every page of one traversal, which is a
      // change to core's `AuditQuery` — see `audit.controller.ts`.
      const first = await request(app.getHttpServer())
        .get('/audit?limit=2')
        .set('Authorization', bearer(ROOT))
        .expect(200);
      const second = await request(app.getHttpServer())
        .get('/audit?page=2&limit=2')
        .set('Authorization', bearer(ROOT))
        .expect(200);

      const lastOfFirst = first.body.data[first.body.data.length - 1].id;
      expect(second.body.data.map((entry: { id: string }) => entry.id)).toContain(lastOfFirst);
    });
  });

  describe('the page it returns', () => {
    it('is newest first', async () => {
      const response = await request(app.getHttpServer())
        .get('/audit')
        .set('Authorization', bearer(ROOT))
        .expect(200);

      const instants = response.body.data.map((entry: { occurredAt: string }) => entry.occurredAt);
      expect(instants).toEqual([...instants].sort().reverse());
    });

    it('narrows by action rather than ignoring the filter', async () => {
      const response = await request(app.getHttpServer())
        .get('/audit?action=LOGIN_FAILED')
        .set('Authorization', bearer(ROOT))
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].action).toBe(AuditAction.LOGIN_FAILED);
    });

    it('refuses a filter no DTO declares', async () => {
      // `forbidNonWhitelisted` on the shipped validation pipe. Without it an
      // unrecognized filter is silently ignored and the caller is handed a page
      // they believe is narrowed.
      await request(app.getHttpServer())
        .get('/audit?invented=1')
        .set('Authorization', bearer(ROOT))
        .expect(400);
    });

    it('refuses an action outside the enum', async () => {
      await request(app.getHttpServer())
        .get('/audit?action=NOT_AN_ACTION')
        .set('Authorization', bearer(ROOT))
        .expect(400);
    });

    it('caps how much can be asked for at once', async () => {
      await request(app.getHttpServer())
        .get('/audit?limit=100000')
        .set('Authorization', bearer(ROOT))
        .expect(400);
    });
  });

  describe('the service refuses independently of the guard', () => {
    // The guard is what a request meets. This is what a scheduled job or a
    // console command meets, neither of which passes through one — and it is
    // the check that survives somebody mounting a second audit endpoint and
    // forgetting the decorator.
    it('refuses a non-administrator reaching the service directly', async () => {
      await expect(audit.query(ADA, { page: 1, limit: 20 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses an actor whose account has gone', async () => {
      await expect(
        audit.query('99999999-9999-4999-8999-999999999999' as UserId, { page: 1, limit: 20 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('answers a platform administrator', async () => {
      // The other direction, so "refuse everybody" cannot satisfy the two above.
      const page = await audit.query(ROOT, { page: 1, limit: 20 });
      expect(page.meta.total).toBe(3);
    });
  });

  describe('AuditModule wires it, which no probe application can show', () => {
    // The probe above registers the controller and the guard itself. That is
    // necessary to exercise them and it is exactly the blindness
    // `composition-root.spec.ts` was written about, so the module's own metadata
    // is read back here.
    it('registers the controller, without which /audit exists nowhere', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AuditModule)).toContain(
        AuditController,
      );
    });

    it('provides the guard the controller resolves', () => {
      // Without this provider the application fails to start — but it fails at
      // start-up, which is a moment no spec in this backend reaches.
      expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuditModule)).toContain(
        PlatformAdminGuard,
      );
    });
  });
});
