import { Body, Controller, Get, INestApplication, Post, Req, Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IsString } from 'class-validator';
import type { Request } from 'express';
import request from 'supertest';
import { ConsumedTokenError } from '__FORGE_SCOPE__/core/auth/errors';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AppModule, GLOBAL_PROVIDERS, I18N, typeOrmOptions } from '../app.module';
import { configureApp } from '../app.setup';
import { AuditEntryRecord } from '../audit/audit-entry-record.entity';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from '../auth/auth.controller';
import { AuthModule, accessTokenSigningOptions } from '../auth/auth.module';
import { Public } from '../auth/decorators';
import { EmailVerificationTokenRecord } from '../auth/entities/email-verification-token-record.entity';
import { PasswordResetTokenRecord } from '../auth/entities/password-reset-token-record.entity';
import { RefreshTokenRecord } from '../auth/entities/refresh-token-record.entity';
import { SessionRecord } from '../auth/entities/session-record.entity';
import { REFRESH_COOKIE } from '../auth/refresh-cookie';
import { ACCESS_TOKEN_TTL_SECONDS, SessionService } from '../auth/session/session.service';
import { JwtStrategy } from '../auth/strategies';
import { ResourceGrantRecord } from '../authorization/resource-grant-record.entity';
import { HealthModule } from '../health/health.module';
import { AuthIdentityRecord } from '../identities/auth-identity-record.entity';
import { IdentitiesModule } from '../identities/identities.module';
import { IdentitiesService } from '../identities/identities.service';
import { MailModule } from '../mail';
import { InvitationRecord } from '../organizations/invitation-record.entity';
import { MembershipRecord } from '../organizations/membership-record.entity';
import { OrganizationRecord } from '../organizations/organization-record.entity';
import { UserRecord } from '../users/user-record.entity';
import { UsersModule } from '../users/users.module';

/**
 * # The composition root
 *
 * **Every assertion in this file exists because deleting one line of shipped
 * wiring left the whole backend suite green.** A review injected sixteen such
 * deletions into `main.ts`, `app.module.ts`, `auth.module.ts`,
 * `jwt.strategy.ts`, `health.controller.ts` and `refresh-cookie.ts`, and fifteen
 * of them passed 165 tests. The reason was uniform: every behavioural spec in
 * this backend assembles its own Nest testing module, so none of them can see
 * the files that decide whether the verified-correct pieces are connected at
 * all. Five of the fifteen were silent security regressions.
 *
 * The rule this file follows, and the rule that made the sixteenth fault fire:
 * **import the artifact, do not rebuild it.** Where the wiring is a value —
 * {@link GLOBAL_PROVIDERS}, {@link typeOrmOptions},
 * {@link accessTokenSigningOptions} — the spec uses that exact value, and a
 * separate assertion pins that the module uses it too, so the two halves cannot
 * drift. Where it is imperative — {@link configureApp} — the spec calls the
 * shipped function against a probe application.
 *
 * | Deleted from shipped code | Caught by |
 * |---|---|
 * | `app.setup.ts`: `app.use(cookieParser())` | `configureApp › parses the Cookie header` |
 * | `app.module.ts`: the `APP_FILTER` provider | `GLOBAL_PROVIDERS › answers a refusal the domain expressed with its own status` |
 * | `app.module.ts`: the `APP_PIPE` provider | `GLOBAL_PROVIDERS › rejects a body carrying a field no DTO declares` |
 * | `app.module.ts`: the `APP_GUARD` provider | `GLOBAL_PROVIDERS › closes a route that does not open itself` (and `global-guard.spec.ts`) |
 * | `app.module.ts`: `AuthModule` from `imports` | `AppModule › imports AuthModule` |
 * | `app.module.ts`: `AuditModule` from `imports` | `AppModule › imports AuditModule` |
 * | `app.module.ts`: `I18nModule` from `imports` | `AppModule › registers I18nModule` |
 * | `app.module.ts`: an entity from the list | `the database connection › lists every entity` |
 * | `app.module.ts`: `OrganizationRecord` from the entity list | `the database connection › lists every entity` — a repository for it resolves nothing, and every `organizations` read or write in Task 10 fails at start-up |
 * | `app.module.ts`: `MembershipRecord` from the entity list | `the database connection › lists every entity` — same fault, for every membership Task 11 reads or writes |
 * | `app.module.ts`: `InvitationRecord` from the entity list | `the database connection › lists every entity` — same fault, for every invitation Task 12 reads or writes |
 * | `app.module.ts`: `ResourceGrantRecord` from the entity list | `the database connection › lists every entity` — same fault, for every grant Task 13 reads or writes |
 * | `app.module.ts`: `providers: GLOBAL_PROVIDERS` replaced by a copy | `AppModule › uses the exported provider array itself` |
 * | `app.setup.ts`: `credentials: true` on CORS | `configureApp › lets a cross-origin caller send the renewal cookie` |
 * | `health.controller.ts`: `@Public()` | `health › is reachable with no credential` |
 * | `auth.module.ts`: `controllers: [AuthController]` | `AuthModule › registers the controller` |
 * | `app.module.ts`: `UsersModule` from `imports` | `AppModule › imports UsersModule` |
 * | `app.module.ts`: `IdentitiesModule` from `imports` | `AppModule › imports IdentitiesModule` |
 * | `auth.module.ts`: `IdentitiesModule` from `imports` | `AuthModule › gets its identity service from one place` |
 * | `users.module.ts`: `controllers`/`providers` | `users/__tests__/users.controller.spec.ts › UsersModule wires it` |
 * | `audit.module.ts`: `controllers`/`providers` | `audit/__tests__/audit.controller.spec.ts › AuditModule wires it` |
 * | `identities.module.ts`: `controllers`/`providers` | `identities/__tests__/identities.controller.spec.ts › IdentitiesModule wires it` |
 * | `auth.module.ts`: `getOrThrow` → a default | `access credentials › refuse to boot without a signing key` |
 * | `auth.module.ts`: `expiresIn` → a long lifetime | `access credentials › are short-lived` |
 * | `jwt.strategy.ts`: `getOrThrow` → a default | `global-guard.spec.ts › refuses to construct without a signing key` |
 * | `jwt.strategy.ts`: `ignoreExpiration: true` | `global-guard.spec.ts › refuses a credential that has expired` |
 * | `jwt.strategy.ts`: credential read from the query string | `global-guard.spec.ts › refuses a credential offered in the query string` |
 * | `refresh-cookie.ts`: `secure` in production | `the renewal cookie › is Secure in production` |
 *
 * What is still beyond reach: the single line `configureApp(app)` in `main.ts`.
 * Reaching it would mean starting the real `AppModule`, which needs a database.
 * `main.ts` does nothing else.
 */

/** This spec's signing key. Not a credential: it signs nothing outside this file. */
const SIGNING_KEY = 'composition-root-spec-signing-key';

const DB_URL = 'postgresql://probe:probe@127.0.0.1:1/probe';

/** The origin the probe application is configured to allow. */
const CORS_ORIGIN_UNDER_TEST = 'http://localhost:3001';

const ACTOR = '11111111-1111-4111-8111-111111111111' as UserId;
const SESSION = '22222222-2222-4222-8222-222222222222' as SessionId;

/** The configuration a fully-configured deployment would have. */
const complete = (): ConfigService =>
  new ConfigService({ JWT_SECRET: SIGNING_KEY, DATABASE_URL: DB_URL });

/** Reads a module's `imports` off its own decorator, without instantiating it. */
const moduleImports = (target: Type<unknown>): unknown[] =>
  Reflect.getMetadata(MODULE_METADATA.IMPORTS, target) ?? [];

/** Reads a module's `providers` the same way. */
const moduleProviders = (target: Type<unknown>): unknown[] =>
  Reflect.getMetadata(MODULE_METADATA.PROVIDERS, target) ?? [];

/** Reads a module's `controllers` the same way. */
const moduleControllers = (target: Type<unknown>): unknown[] =>
  Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, target) ?? [];

/** The dynamic module `target` imports for `owner` (`TypeOrmModule`, `JwtModule`, …). */
const dynamicImport = (
  target: Type<unknown>,
  owner: unknown,
): Record<string, unknown> | undefined =>
  moduleImports(target).find(
    (entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && (entry as { module?: unknown }).module === owner,
  );

/**
 * Whether `factory` is the `useFactory` of some provider inside `node`.
 *
 * A search rather than a fixed path: a dynamic module's internal shape is the
 * library's business and moves between versions, but "this exact function is the
 * factory somewhere in there" is the claim worth pinning, and it is the claim
 * that fails the moment somebody inlines a different factory.
 */
const usesFactory = (node: unknown, factory: unknown, depth = 0): boolean => {
  if (depth > 6 || node === null || typeof node !== 'object') return false;
  if ((node as { useFactory?: unknown }).useFactory === factory) return true;
  return Object.values(node).some((value) =>
    Array.isArray(value)
      ? value.some((entry) => usesFactory(entry, factory, depth + 1))
      : usesFactory(value, factory, depth + 1),
  );
};

/** A body shape with exactly one declared field, for the validation probe. */
class ProbeDto {
  @IsString()
  name!: string;
}

/**
 * Routes that exist only to be asked. Every one of them is `@Public()` except
 * `closed`, which carries nothing at all and is the stand-in for every endpoint
 * somebody adds later without thinking about authentication.
 */
@Controller('probe')
class ProbeController {
  @Get('closed')
  public closed(): { reached: true } {
    return { reached: true };
  }

  @Public()
  @Get('cookies')
  public cookies(@Req() req: Request & { cookies?: Record<string, unknown> }): { seen: unknown } {
    return { seen: req.cookies?.probe ?? null };
  }

  @Public()
  @Get('refusal')
  public refusal(): never {
    // A refusal the DOMAIN expressed. Without the global exception filter it is
    // a 500: "an unexpected error occurred" for a link somebody used twice.
    throw new ConsumedTokenError();
  }

  @Public()
  @Post('validated')
  public validated(@Body() body: ProbeDto): { name: string } {
    return { name: body.name };
  }
}

describe('the composition root', () => {
  describe('AppModule declares what the application is made of', () => {
    it.each([
      ['HealthModule', HealthModule],
      ['MailModule', MailModule],
      ['AuditModule', AuditModule],
      ['IdentitiesModule', IdentitiesModule],
      ['AuthModule', AuthModule],
      ['UsersModule', UsersModule],
    ])('imports %s', (_name, imported) => {
      expect(moduleImports(AppModule)).toContain(imported);
    });

    it('registers I18nModule, without which every message is a translation key', () => {
      // The plumbing (`i18n/en/*.json`, `common/i18n/`, the interceptor) shipped
      // from the first phase and went unregistered, so `HttpExceptionFilter`'s
      // `i18n ? translate(key) : key` fallback answered every request with the
      // key itself. Nothing noticed, because nothing asserted the module existed.
      expect(moduleImports(AppModule)).toContain(I18N);
    });

    it('uses the exported provider array itself, not a copy of it', () => {
      // Reference equality on purpose. Every behavioural assertion below
      // registers `GLOBAL_PROVIDERS`; this is what makes them assertions about
      // the application rather than about an array only the spec uses.
      expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule)).toBe(GLOBAL_PROVIDERS);
    });
  });

  describe('the database connection', () => {
    it('is built by the exported factory, not by one inlined in the module', () => {
      expect(usesFactory(dynamicImport(AppModule, TypeOrmModule), typeOrmOptions)).toBe(true);
    });

    it('lists every entity this application reads or writes', () => {
      // Named one by one rather than counted: a count passes while an entity is
      // swapped for another, and a missing entity is a repository Nest cannot
      // resolve — which surfaces at start-up in production and nowhere else.
      expect(typeOrmOptions(complete()).entities).toEqual([
        UserRecord,
        AuthIdentityRecord,
        SessionRecord,
        RefreshTokenRecord,
        EmailVerificationTokenRecord,
        PasswordResetTokenRecord,
        AuditEntryRecord,
        OrganizationRecord,
        MembershipRecord,
        InvitationRecord,
        ResourceGrantRecord,
      ]);
    });

    it('refuses to boot with no DATABASE_URL rather than choosing one', () => {
      expect(() => typeOrmOptions(new ConfigService({}))).toThrow();
    });

    it('never lets TypeORM alter the schema', () => {
      // `synchronize: true` would let the application rewrite the very table
      // whose privileges make the audit log append-only.
      expect(typeOrmOptions(complete())).toMatchObject({ synchronize: false });
    });
  });

  describe('AuthModule', () => {
    it('registers the controller, without which /auth exists nowhere', () => {
      expect(moduleControllers(AuthModule)).toContain(AuthController);
    });

    it('provides the strategy the global guard resolves', () => {
      // Without this provider passport has no `jwt` strategy registered, and the
      // shape of the failure is the worst in this file: `@Public()` routes still
      // answer, so `GET /health` returns 200 and the container reports HEALTHY,
      // while every authenticated route in the application fails. A deployment
      // looks entirely well and nobody can sign in.
      //
      // The probe application below registers `JwtStrategy` itself — it has to,
      // to exercise the guard at all — which is exactly why this assertion has
      // to exist separately: the fix for "the spec assembles its own module"
      // reintroduced that same blindness for this one provider.
      expect(moduleProviders(AuthModule)).toContain(JwtStrategy);
    });

    it('gets its identity service from one place rather than binding a second', () => {
      // `IdentitiesService` and the two ports behind it used to be providers of
      // this module. They are `IdentitiesModule`'s now, and this module imports
      // it. Binding them in both would give the application two hashers and two
      // registries — harmless while both are stateless, and exactly the kind of
      // accident that stops being harmless the moment one holds a connection or
      // a cache.
      expect(moduleImports(AuthModule)).toContain(IdentitiesModule);
      expect(moduleProviders(AuthModule)).not.toContain(IdentitiesService);
    });

    it('signs with the exported factory, not with one inlined in the module', () => {
      expect(usesFactory(dynamicImport(AuthModule, JwtModule), accessTokenSigningOptions)).toBe(
        true,
      );
    });
  });

  describe('access credentials', () => {
    it('refuse to boot without a signing key rather than falling back to a shared one', () => {
      // A default here is a key every project generated from this template
      // shares, and whoever holds it can mint a credential for any account on
      // any of them.
      expect(() => accessTokenSigningOptions(new ConfigService({}))).toThrow();
    });

    it('are configured to be short-lived', () => {
      expect(accessTokenSigningOptions(complete()).signOptions?.expiresIn).toBe(
        ACCESS_TOKEN_TTL_SECONDS,
      );
      // A literal bound, not the constant: an assertion that reads the same
      // constant the code wrote cannot fail whatever it is changed to. This is
      // the window in which a revoked session keeps working.
      expect(ACCESS_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(60 * 60);
    });

    it('ACTUALLY expire that soon — read off a credential the service minted', () => {
      // The assertion above pins the module's DEFAULT, and a default is not a
      // guarantee: `this.jwt.sign(claims, { expiresIn: '365d' })` at the one call
      // site that mints overrides it, and every assertion in this file that reads
      // the options object stays green. That is fault F12 again, reached from the
      // other end.
      //
      // So this reads `exp` off a credential `SessionService` really produced,
      // signed by a `JwtService` really configured by the shipped factory. The
      // three repositories and the data source are `null` because minting touches
      // none of them; if that ever stops being true this line fails loudly rather
      // than quietly testing something else.
      const jwt = new JwtService(accessTokenSigningOptions(complete()));
      const sessions = new SessionService(null as never, null as never, jwt, null as never);

      const claims = jwt.decode(sessions.mintAccessToken(ACTOR, SESSION)) as {
        iat: number;
        exp: number;
      };

      expect(claims.exp - claims.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
    });
  });

  describe('the renewal cookie', () => {
    it('is Secure in production', () => {
      // The controller spec asserts the flag is ABSENT under `NODE_ENV=test`,
      // which is the direction that cannot fail: `secure: false` satisfies it.
      // This is the other direction, and it is the one that matters — without it
      // the credential is sent over plain HTTP by a production deployment.
      const before = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        expect(REFRESH_COOKIE.attributes()).toMatchObject({ secure: true });
      } finally {
        process.env.NODE_ENV = before;
      }
    });
  });

  describe('a probe application wired the way the real one is', () => {
    let app: INestApplication;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            ignoreEnvFile: true,
            load: [() => ({ JWT_SECRET: SIGNING_KEY, CORS_ORIGIN: CORS_ORIGIN_UNDER_TEST })],
          }),
          PassportModule,
          // THE SHIPPED REGISTRATION, so the rendering assertion below is about
          // the application's own translation setup and not about one this file
          // wrote.
          I18N,
          // The shipped health module, so `@Public()` on its controller is what
          // is under test rather than a decorator this file wrote.
          HealthModule,
        ],
        controllers: [ProbeController],
        // THE SHIPPED ARRAY. Not a copy: removing an entry from `app.module.ts`
        // removes it from here.
        providers: [
          ...GLOBAL_PROVIDERS,
          JwtStrategy,
          // `GLOBAL_PROVIDERS` now carries `PlatformAdminOverrideInterceptor`,
          // which needs this. Nothing in this file passes through
          // `PlatformAdminGuard`, so the interceptor never writes anything here —
          // but it is constructed, which is the point: a probe application that
          // registers the shipped array has to be able to build every provider in
          // it, so a provider added there with an unsatisfiable dependency fails
          // here rather than at start-up in production.
          {
            provide: AuditService,
            useValue: { record: async () => undefined } as unknown as AuditService,
          },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      // THE SHIPPED FUNCTION, called the way `main.ts` calls it.
      configureApp(app);
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    describe('GLOBAL_PROVIDERS', () => {
      it('closes a route that does not open itself', async () => {
        await request(app.getHttpServer()).get('/probe/closed').expect(401);
      });

      it('rejects a body carrying a field no DTO declares', async () => {
        // `whitelist` + `forbidNonWhitelisted` are the only thing doing this.
        // Without the pipe the unknown field is accepted and the route runs.
        await request(app.getHttpServer())
          .post('/probe/validated')
          .send({ name: 'ada', unexpected: 'and unvalidated' })
          .expect(400);
      });

      it('accepts a body that declares exactly what the DTO does', async () => {
        // The other direction, so the assertion above cannot be satisfied by a
        // pipe that rejects everything.
        await request(app.getHttpServer())
          .post('/probe/validated')
          .send({ name: 'ada' })
          .expect(201, { name: 'ada' });
      });

      it('answers a refusal the domain expressed with its own status, not 500', async () => {
        await request(app.getHttpServer()).get('/probe/refusal').expect(410);
      });

      it('renders the message rather than emitting the translation key', async () => {
        // What registering `I18nModule` bought. Before it, this body read
        // `{"message":"errors.auth.token_consumed"}`.
        const response = await request(app.getHttpServer()).get('/probe/refusal').expect(410);

        expect(response.body.message).not.toMatch(/^errors\./);
        expect(response.body.message).toBe('That link has already been used');
      });
    });

    describe('health', () => {
      it('is reachable with no credential', async () => {
        // Without `@Public()` the global guard answers 401, the container
        // healthcheck's `fetch` resolves with `ok: false`, the container is
        // reported unhealthy for ever and every service waiting on
        // `service_healthy` stalls. The whole stack fails to boot on a decorator.
        await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
      });
    });

    describe('configureApp', () => {
      it('parses the Cookie header, without which no renewal can read its credential', async () => {
        const response = await request(app.getHttpServer())
          .get('/probe/cookies')
          .set('Cookie', 'probe=present')
          .expect(200);

        expect(response.body).toEqual({ seen: 'present' });
      });

      it('lets a cross-origin caller send the renewal cookie', async () => {
        // `credentials: true`. Without it the browser sets the cookie and then
        // never sends it back, and every renewal from the webapp's own origin
        // fails with a 401 that looks exactly like an expired session.
        const response = await request(app.getHttpServer())
          .get('/probe/cookies')
          .set('Origin', CORS_ORIGIN_UNDER_TEST)
          .expect(200);

        expect(response.headers['access-control-allow-credentials']).toBe('true');
        expect(response.headers['access-control-allow-origin']).toBe(CORS_ORIGIN_UNDER_TEST);
      });
    });
  });
});
