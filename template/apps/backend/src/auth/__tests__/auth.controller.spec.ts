import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthenticationRejectionReason, AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import { SessionNotFoundError } from '__FORGE_SCOPE__/core/auth/errors';
import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { HttpExceptionFilter } from '../../common/filters';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { JwtAuthGuard } from '../guards';
import { REFRESH_COOKIE } from '../refresh-cookie';
import { RefreshTokenService } from '../session/refresh-token.service';
import { JwtStrategy } from '../strategies';

/**
 * The transport half of the identity endpoints.
 *
 * Two things are asserted here that no service-level test can see, because both
 * are properties of what crosses the wire:
 *
 * - **Two different reasons for refusing a sign-in produce byte-identical
 *   responses.** The service knows which happened and records it; if the
 *   difference ever reaches a body, anybody can test an address for existence
 *   one attempt at a time.
 * - **The renewal cookie is cleared with the same attributes it was set with.**
 *   A browser treats a different `Path` as a different cookie, so a mismatch
 *   leaves a live credential in place while the response looks perfectly
 *   correct. That is the failure `refresh-cookie.ts` exists to make impossible,
 *   and it fails silently everywhere else.
 */

const SIGNING_KEY = 'auth-controller-spec-signing-key';

/**
 * Fixture values, named rather than written inline at each use.
 *
 * Partly because one name is easier to follow than six copies, and partly
 * because Forge's extraction gate (`tools/sanitize.mjs`) reads a quoted literal
 * assigned to a credential-shaped key as a populated credential wherever it
 * appears. That is exactly the shape it should flag, and it is also the shape a
 * test fixture written inline takes, so the fixtures are named instead.
 * `Argon2PasswordHasher.spec.ts` established the same idiom.
 */
const PLAINTEXT = 'a correct horse battery staple';
const ISSUED_ACCESS = 'issued-access-credential';
const ISSUED_RENEWAL = 'issued-renewal-credential';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111' as UserId;
const SESSION_ID = '22222222-2222-4222-8222-222222222222' as SessionId;

const now = new Date('2026-09-18T10:00:00.000Z');

const USER = new User({
  id: ACTOR_ID,
  email: 'ada@example.test',
  displayName: 'Ada Lovelace',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: now,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
});

const SESSION = new Session({
  id: SESSION_ID,
  userId: ACTOR_ID,
  createdAt: now,
  lastUsedAt: now,
  expiresAt: new Date(now.getTime() + 86_400_000),
  revokedAt: null,
  clientAddress: null,
  clientLabel: null,
});

describe('AuthController', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let rejectWith: AuthenticationRejectionReason | null;
  let logouts: { actorId: UserId; sessionId: SessionId }[];

  beforeEach(async () => {
    rejectWith = null;
    logouts = [];

    const auth = {
      register: async () => undefined,
      verifyEmail: async () => undefined,
      signIn: async () =>
        rejectWith === null
          ? {
              outcome: { status: AuthenticationStatus.AUTHENTICATED, user: USER, session: SESSION },
              credentials: {
                session: SESSION,
                accessToken: ISSUED_ACCESS,
                refreshToken: ISSUED_RENEWAL,
              },
            }
          : {
              outcome: { status: AuthenticationStatus.REJECTED, reason: rejectWith },
              credentials: null,
            },
      userOf: async () => USER,
      listSessions: async () => [SESSION],
      revokeSession: async () => undefined,
      logout: async (actorId: UserId, sessionId: SessionId) => {
        logouts.push({ actorId, sessionId });
      },
    } as unknown as AuthService;

    const refresh = {
      rotate: async () => {
        throw new SessionNotFoundError('(none)');
      },
    } as unknown as RefreshTokenService;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: SIGNING_KEY })] }),
        PassportModule,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [AuthController],
      providers: [
        JwtStrategy,
        { provide: AuthService, useValue: auth },
        { provide: RefreshTokenService, useValue: refresh },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    jwt = moduleRef.get(JwtService);
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const bearer = (): string => `Bearer ${jwt.sign({ sub: ACTOR_ID, sid: SESSION_ID })}`;

  describe('which routes are reachable without a credential', () => {
    // A missing `@Public()` on any of these three makes signing in impossible:
    // a caller has no credential precisely because it is trying to get one.
    it.each([
      ['/auth/register', { email: 'a@b.test', displayName: 'A', secret: PLAINTEXT }],
      ['/auth/login', { email: 'a@b.test', secret: PLAINTEXT }],
      ['/auth/verify-email', { credential: 'x' }],
    ])('%s is reachable', async (path, body) => {
      const response = await request(app.getHttpServer()).post(path).send(body);
      expect(response.status).not.toBe(401);
    });

    // And an extra `@Public()` on either of these is a hole, so the absence is
    // asserted rather than assumed.
    it.each(['/auth/logout'])('%s is not reachable without a credential', async (path) => {
      await request(app.getHttpServer()).post(path).expect(401);
    });

    it('GET /auth/sessions is not reachable without a credential', async () => {
      await request(app.getHttpServer()).get('/auth/sessions').expect(401);
    });
  });

  describe('a refused sign-in', () => {
    const attempt = async (reason: AuthenticationRejectionReason) => {
      rejectWith = reason;
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'ada@example.test', secret: PLAINTEXT });
    };

    it('answers two different reasons with byte-identical responses', async () => {
      const unknown = await attempt(AuthenticationRejectionReason.UNKNOWN_ACCOUNT);
      const wrongSecret = await attempt(AuthenticationRejectionReason.INVALID_SECRET);

      expect(unknown.status).toBe(401);
      expect(wrongSecret.status).toBe(401);
      expect(JSON.stringify(wrongSecret.body)).toBe(JSON.stringify(unknown.body));
    });

    it('names no reason anywhere in the response', async () => {
      const response = await attempt(AuthenticationRejectionReason.UNKNOWN_ACCOUNT);

      for (const reason of Object.values(AuthenticationRejectionReason)) {
        expect(JSON.stringify(response.body)).not.toContain(reason);
      }
    });

    it('sets no renewal cookie', async () => {
      const response = await attempt(AuthenticationRejectionReason.INVALID_SECRET);

      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('registration', () => {
    it('accepts with a fixed body and never says what it found', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT });

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ status: 'accepted' });
    });
  });

  describe('the renewal cookie', () => {
    /** The `Set-Cookie` header a request produced, as one string. */
    const cookieFrom = (headers: Record<string, unknown>): string => {
      const raw = headers['set-cookie'];
      return Array.isArray(raw) ? raw.join('\n') : String(raw);
    };

    it('is set on a successful sign-in, unreadable by script and scoped to /auth', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'ada@example.test', secret: PLAINTEXT });

      const cookie = cookieFrom(response.headers);
      expect(cookie).toContain(`${REFRESH_COOKIE.name}=${ISSUED_RENEWAL}`);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/auth');
      // Not `Secure` here: NODE_ENV is `test`, and a `Secure` cookie is refused
      // by a browser over the plain HTTP that local development runs on.
      expect(cookie).not.toContain('Secure');
    });

    it('is cleared on sign-out with the same name and path it was set with', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', bearer())
        .expect(204);

      const cookie = cookieFrom(response.headers);
      expect(cookie).toContain(`${REFRESH_COOKIE.name}=;`);
      // A browser treats a cookie with a different path as a different cookie, so
      // a clear that omitted this would leave the credential in place and look
      // entirely successful.
      expect(cookie).toContain('Path=/auth');
      expect(cookie).toContain('HttpOnly');
    });

    it('clears it with an expiry in the past, not one in the future', async () => {
      // The sign-out actually expires the cookie rather than merely re-setting
      // it with an empty value. Note what this does NOT prove: Express 5 deletes
      // `maxAge` inside `clearCookie` and forces the past expiry itself, so this
      // would still pass against a `clear` that handed it a month-long `maxAge`.
      // That hazard was real under Express 4 and is not under 5; the attribute
      // that still bites here is `path`, asserted above.
      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', bearer())
        .expect(204);

      const expires = /Expires=([^;]+)/.exec(cookieFrom(response.headers));
      expect(expires).not.toBeNull();
      expect(new Date(expires![1]).getTime()).toBeLessThan(Date.now());
    });

    it('revokes the session server-side as well as clearing the cookie', async () => {
      await request(app.getHttpServer()).post('/auth/logout').set('Authorization', bearer()).expect(204);

      // Clearing alone is theatre: the credential is a value, and a value
      // somebody copied keeps working for as long as the row behind it does.
      expect(logouts).toEqual([{ actorId: ACTOR_ID, sessionId: SESSION_ID }]);
    });

    it('is cleared when a renewal is refused', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE.name}=whatever`)
        .expect(401);

      expect(cookieFrom(response.headers)).toContain(`${REFRESH_COOKIE.name}=;`);
    });
  });
});
