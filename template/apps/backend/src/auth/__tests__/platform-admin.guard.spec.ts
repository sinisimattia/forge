import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
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
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { AuditService } from '../../audit/audit.service';
import { MembershipRecord } from '../../organizations/membership-record.entity';
import { UserRecord } from '../../users/user-record.entity';
import { Public } from '../decorators';
import { PlatformAdminGuard } from '../guards';
import { JwtStrategy } from '../strategies';
import { FakeDataSource } from '../../common/testing';

/**
 * The two branches of `PlatformAdminGuard` that no ordinary route can reach.
 *
 * Both were measured to be untested before this file existed: deleting
 * `if (actor === undefined) throw` and `if (row === null) throw` from the guard
 * left all 343 tests green, because every route in every other spec goes through
 * the global `JwtAuthGuard` first — which always puts an actor on the request,
 * and never checks that the actor's account still exists.
 *
 * So this file builds the two situations deliberately:
 *
 * - **A `@Public()` route that is also guarded.** Nonsense as a design, and
 *   precisely the mistake the branch exists for: somebody opens an
 *   administrative endpoint "to debug it" and the guard is then handed a request
 *   with nobody on it. Waving it through would make that mistake invisible.
 * - **A credential this server really signed, for an account that is gone.**
 *   Nothing is read from the database to authenticate a request
 *   (`strategies/jwt.strategy.ts` says so and states the cost), so a valid
 *   credential outlives the row it names by up to the access-credential
 *   lifetime. The guard is the first thing on an administrative route that looks.
 */

const SIGNING_KEY = 'platform-admin-guard-spec-signing-key';

const ROOT = '11111111-1111-4111-8111-111111111111' as UserId;
const GONE = '99999999-9999-4999-8999-999999999999' as UserId;
const SESSION = '22222222-2222-4222-8222-222222222222' as SessionId;

const EPOCH = new Date('2026-09-18T10:00:00.000Z');

/**
 * Two routes that exist only to be asked, both guarded.
 *
 * `open` carries `@Public()` as well, which is the fault the guard's
 * absent-actor branch is written against. It is declared here rather than found
 * among the real endpoints because no real endpoint is like this — and it must
 * not become one.
 */
@Controller('probe')
@UseGuards(PlatformAdminGuard)
class ProbeController {
  @Get('closed')
  public closed(): { reached: true } {
    return { reached: true };
  }

  @Public()
  @Get('open')
  public open(): { reached: true } {
    return { reached: true };
  }

  /**
   * A guarded route whose handler fails.
   *
   * It exists for the interceptor's error path, which nothing else in this
   * backend reaches: every other guarded handler succeeds. That branch shipped
   * under a paragraph asserting it was there, and replacing it with a plain
   * re-raise left all 379 tests green.
   */
  @Get('broken')
  public broken(): never {
    throw new Error('the handler failed after the guard had already passed');
  }
}

describe('PlatformAdminGuard', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let source: FakeDataSource;

  beforeEach(async () => {
    source = new FakeDataSource();
    source.seed(UserRecord, [
      {
        id: ROOT,
        email: 'root@example.test',
        displayName: 'Root',
        status: UserStatus.ACTIVE,
        platformRole: PlatformRole.PLATFORM_ADMIN,
        emailVerifiedAt: EPOCH,
        createdAt: EPOCH,
        updatedAt: EPOCH,
        deletedAt: null,
      },
    ]);

    const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
      source.getRepository(entity) as unknown as Repository<T>;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: SIGNING_KEY })] }),
        I18N,
        PassportModule,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [ProbeController],
      providers: [
        ...GLOBAL_PROVIDERS,
        JwtStrategy,
        PlatformAdminGuard,
        AuditService,
        { provide: getRepositoryToken(UserRecord), useValue: repo<UserRecord>(UserRecord) },
        {
          provide: getRepositoryToken(AuditEntryRecord),
          useValue: repo<AuditEntryRecord>(AuditEntryRecord),
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

  const overrides = (): Record<string, unknown>[] =>
    source
      .all(AuditEntryRecord)
      .filter((entry) => entry.action === AuditAction.PLATFORM_ADMIN_OVERRIDE);

  it('lets a platform administrator through, and records the pass', async () => {
    await request(app.getHttpServer())
      .get('/probe/closed')
      .set('Authorization', bearer(ROOT))
      .expect(200, { reached: true });

    expect(overrides()).toHaveLength(1);
  });

  it('refuses a request nothing proved, even on a route marked @Public()', async () => {
    // The global guard lets this request past with no actor on it, so the
    // administrative guard is the only thing standing between an accidentally
    // public administrative endpoint and everybody. Waving it through — `if
    // (actor === undefined) return true` — leaves every other test in this
    // backend green, which is why this one exists.
    await request(app.getHttpServer()).get('/probe/open').expect(404);
    expect(overrides()).toHaveLength(0);
  });

  it('refuses a validly-signed credential whose account is gone', async () => {
    // Nothing is read from the database to authenticate a request, so a
    // credential this server signed outlives the row it names. An account
    // removed by a repair script, or a restore that rolled a row back, keeps
    // presenting a credential that verifies perfectly.
    await request(app.getHttpServer())
      .get('/probe/closed')
      .set('Authorization', bearer(GONE))
      .expect(404);

    expect(overrides()).toHaveLength(0);
  });

  it('records the pass even when the handler then fails', async () => {
    // The event recorded is the PASS, which has already happened by the time any
    // handler runs — a handler that throws does not un-pass it, and an
    // administrator whose request failed is exactly as interesting to whoever
    // reads the history afterwards. Recording only on success would make a
    // failing administrative route the one kind of pass that leaves no trace,
    // which is the trace somebody looks for first.
    //
    // This is the ninth time in this phase that a sentence in a comment was true
    // and depended on a branch no test exercised. The branch is
    // `PlatformAdminOverrideInterceptor`'s `catchError`; replacing it with a
    // plain re-raise left all 379 tests green.
    await request(app.getHttpServer())
      .get('/probe/broken')
      .set('Authorization', bearer(ROOT))
      .expect(500);

    expect(overrides()).toHaveLength(1);
    expect(overrides()[0].actorUserId).toBe(ROOT);
    expect((overrides()[0].metadata as { path: string }).path).toContain('/probe/broken');
  });

  it('writes exactly one entry for a failing request, not two', async () => {
    // Both `tap` paths run `write`, which clears the marker before doing
    // anything precisely so the success path and the error path cannot both
    // write for one request. Asserted rather than trusted: this table refuses
    // UPDATE and DELETE, so a duplicate is permanent.
    await request(app.getHttpServer())
      .get('/probe/broken')
      .set('Authorization', bearer(ROOT))
      .expect(500);

    expect(overrides()).toHaveLength(1);
  });

  it('still answers the handler\'s own failure, not the interceptor\'s success', async () => {
    // The original error has to survive being re-raised past the write. An
    // interceptor that swallowed it would turn a broken administrative route
    // into a silent 200.
    const response = await request(app.getHttpServer())
      .get('/probe/broken')
      .set('Authorization', bearer(ROOT));

    expect(response.status).toBe(500);
  });

  it('refuses an ordinary account, having read its standing from the row', async () => {
    // The standing is read from the row and never from the credential's claims.
    // The claims carry two fields and are not re-issued when a role changes, so
    // a role copied into one would keep whatever it was minted with — an
    // administrator demoted at noon would go on operating the deployment until
    // their credential lapsed.
    source.update(UserRecord, { id: ROOT }, { platformRole: PlatformRole.PLATFORM_USER });

    await request(app.getHttpServer())
      .get('/probe/closed')
      .set('Authorization', bearer(ROOT))
      .expect(404);
  });
});
