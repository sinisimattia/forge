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
import { FakeDataSource } from '../../common/testing';
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

/** A well-formed actor id no entry names, so a filter on it matches nothing. */
const GONE = '44444444-4444-4444-8444-444444444444' as UserId;

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

      // Three, not four. The override this very read produces is written by
      // `PlatformAdminOverrideInterceptor` AFTER the handler, so it is not in
      // the page the handler returned. It was four while the guard wrote it, and
      // that is how this was found — as a test expecting three and receiving
      // four, rather than as a deduction.
      expect(response.body.data).toHaveLength(3);
      expect(response.body.meta).toMatchObject({ total: 3, page: 1, limit: 20 });
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

    it('appends to the thing being read, but never inside the page it returns', async () => {
      // Both halves matter. The pass is still recorded — spec §9.5 — so the
      // history really does grow by one on every look at it. What changed is
      // WHEN: after the handler, so a reader never sees the request they just
      // made sitting at the top of their own results.
      const first = await request(app.getHttpServer())
        .get('/audit')
        .set('Authorization', bearer(ROOT))
        .expect(200);
      expect(first.body.meta.total).toBe(3);
      expect(first.body.data.map((entry: { action: string }) => entry.action)).not.toContain(
        AuditAction.PLATFORM_ADMIN_OVERRIDE,
      );

      // And it really was written — by the time the response was delivered, not
      // at some point afterwards. The interceptor awaits the write, so this is
      // an ordering fact rather than a race that usually goes the right way.
      expect(overrides()).toHaveLength(1);

      const second = await request(app.getHttpServer())
        .get('/audit')
        .set('Authorization', bearer(ROOT))
        .expect(200);
      expect(second.body.meta.total).toBe(4);
    });
  });

  describe('paging through a history the reader is appending to', () => {
    it('repeats a row across three pages when the caller drops the bound', async () => {
      // The consequence the interceptor cannot fix, pinned so that the reason
      // `asOf` exists is visible rather than asserted. THREE pages, because two
      // cannot show a drift: a page that shifts by one still holds everything
      // the first page left, so the repeat only becomes visible on the third.
      const seen: string[] = [];
      for (const page of [1, 2, 3]) {
        const answered = await request(app.getHttpServer())
          .get(`/audit?page=${page}&limit=1`)
          .set('Authorization', bearer(ROOT))
          .expect(200);
        seen.push(...answered.body.data.map((entry: { id: string }) => entry.id));
      }

      expect(seen).toHaveLength(3);
      expect(new Set(seen).size).toBeLessThan(3);
    });

    it('answers three disjoint pages when every page carries the same bound', async () => {
      const first = await request(app.getHttpServer())
        .get('/audit?page=1&limit=1')
        .set('Authorization', bearer(ROOT))
        .expect(200);

      // The bound comes off the first response. A caller does not invent it —
      // which is the point of echoing it back rather than expecting one.
      const asOf = first.body.meta.asOf;
      expect(typeof asOf).toBe('string');

      const seen: string[] = [...first.body.data.map((entry: { id: string }) => entry.id)];
      for (const page of [2, 3]) {
        const answered = await request(app.getHttpServer())
          .get(`/audit?page=${page}&limit=1&asOf=${encodeURIComponent(asOf)}`)
          .set('Authorization', bearer(ROOT))
          .expect(200);
        expect(answered.body.meta.asOf).toBe(asOf);
        seen.push(...answered.body.data.map((entry: { id: string }) => entry.id));
      }

      expect(seen).toHaveLength(3);
      expect(new Set(seen).size).toBe(3);
      // And none of them is an entry the traversal itself caused.
      expect(seen.sort()).toEqual(['entry-1', 'entry-2', 'entry-3']);
    });

    it('holds meta.total to the bounded world too, not just the rows', async () => {
      // A total counted without the bound would tell a caller there are more
      // pages than their own traversal can reach, which is the same defect
      // wearing a different hat.
      const first = await request(app.getHttpServer())
        .get('/audit?limit=50')
        .set('Authorization', bearer(ROOT))
        .expect(200);
      const asOf = first.body.meta.asOf;

      const again = await request(app.getHttpServer())
        .get(`/audit?limit=50&asOf=${encodeURIComponent(asOf)}`)
        .set('Authorization', bearer(ROOT))
        .expect(200);

      expect(again.body.meta.total).toBe(3);
    });

    it('echoes a usable bound even when the page it answered was empty', async () => {
      // The branch nobody asserted. An empty page has no entry to take a bound
      // from, and the obvious answer — "now" — is wrong for exactly the reason it
      // is wrong everywhere else: it is read after the guard stamped this
      // request's own override, so a caller who filtered down to nothing and
      // then widened would be handed a bound that includes the read they just
      // made. Measured before the fix: the widened page came back holding the
      // override from the filtered one.
      const empty = await request(app.getHttpServer())
        .get(`/audit?actorId=${GONE}`)
        .set('Authorization', bearer(ROOT))
        .expect(200);
      expect(empty.body.data).toEqual([]);

      const widened = await request(app.getHttpServer())
        .get(`/audit?asOf=${encodeURIComponent(empty.body.meta.asOf)}`)
        .set('Authorization', bearer(ROOT))
        .expect(200);

      expect(
        widened.body.data.map((entry: { action: string }) => entry.action),
      ).not.toContain(AuditAction.PLATFORM_ADMIN_OVERRIDE);
      expect(widened.body.meta.total).toBe(3);
    });

    it('refuses a bound that is not an instant', async () => {
      await request(app.getHttpServer())
        .get('/audit?asOf=whenever')
        .set('Authorization', bearer(ROOT))
        .expect(400);
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
