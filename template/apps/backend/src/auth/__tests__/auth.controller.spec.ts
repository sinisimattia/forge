import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { AuditService } from '../../audit/audit.service';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthenticationRejectionReason, AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import { SessionNotFoundError } from '__FORGE_SCOPE__/core/auth/errors';
import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { REFRESH_COOKIE } from '../refresh-cookie';
import { SESSION_TTL_SECONDS } from '../session/session.service';
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
 * because the extraction gate that produced this project reads a quoted literal
 * assigned to a credential-shaped key as a populated credential wherever it
 * appears. That is exactly the shape it should flag, and it is also the shape a
 * test fixture written inline takes, so the fixtures are named instead.
 * `Argon2PasswordHasher.spec.ts` established the same idiom.
 */
const PLAINTEXT = 'a correct horse battery staple';
const OTHER_PLAINTEXT = 'an entirely different long phrase';
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
  let recovery: { method: string; args: unknown[] }[];

  beforeEach(async () => {
    rejectWith = null;
    logouts = [];
    recovery = [];

    const auth = {
      register: async () => undefined,
      verifyEmail: async () => undefined,
      resendVerification: async (...args: unknown[]) => {
        recovery.push({ method: 'resendVerification', args });
      },
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
      requestPasswordReset: async (...args: unknown[]) => {
        recovery.push({ method: 'requestPasswordReset', args });
      },
      resetPassword: async (...args: unknown[]) => {
        recovery.push({ method: 'resetPassword', args });
      },
      changePasswordAndReissue: async (...args: unknown[]) => {
        recovery.push({ method: 'changePasswordAndReissue', args });
        return { session: SESSION, accessToken: ISSUED_ACCESS, refreshToken: ISSUED_RENEWAL };
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
        // The application's own translation registration. The enumeration
        // assertions below compare RENDERED bodies, so they have to be rendered
        // the way the application renders them: before `I18N` existed they
        // compared two identical translation keys, which is a weaker claim than
        // it looks.
        I18N,
        PassportModule,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [AuthController],
      providers: [
        // THE SHIPPED ARRAY, not a hand-assembled substitute for it. It used to
        // be `{ provide: APP_GUARD, useClass: JwtAuthGuard }` plus a
        // `useGlobalFilters` call below, which left this file unable to see the
        // application's own validation pipe — so a body missing a required field
        // reached a handler here and was refused in production, and a body
        // carrying a field no DTO declares was accepted here and refused there.
        // Both directions are assertions this file now makes.
        ...GLOBAL_PROVIDERS,
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
        JwtStrategy,
        { provide: AuthService, useValue: auth },
        { provide: RefreshTokenService, useValue: refresh },
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

  const bearer = (): string => `Bearer ${jwt.sign({ sub: ACTOR_ID, sid: SESSION_ID })}`;

  /** The `Set-Cookie` header a request produced, as one string. */
  const cookieFrom = (headers: Record<string, unknown>): string => {
    const raw = headers['set-cookie'];
    return Array.isArray(raw) ? raw.join('\n') : String(raw);
  };

  describe('which routes are reachable without a credential', () => {
    // A missing `@Public()` on any of these three makes signing in impossible:
    // a caller has no credential precisely because it is trying to get one.
    it.each([
      ['/auth/register', { email: 'a@b.test', displayName: 'A', secret: PLAINTEXT }],
      ['/auth/login', { email: 'a@b.test', secret: PLAINTEXT }],
      ['/auth/verify-email', { credential: 'x' }],
      ['/auth/resend-verification', { email: 'a@b.test' }],
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

    it('renders prose, so the byte-equality above is a claim about what a caller sees', async () => {
      // Before `I18nModule` was registered this body was the translation key
      // itself, and two keys compare equal for a reason that has nothing to do
      // with the property being asserted. Pinned against the English literal
      // rather than against the key, so the rendering cannot silently regress.
      const response = await attempt(AuthenticationRejectionReason.INVALID_SECRET);

      expect(response.body).toEqual({
        error: 'Unauthorized',
        message: 'That email address and password do not match an account',
      });
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

  describe('recovery', () => {
    // The third of the three endpoints that take an address without proving
    // anything, and the one that had no route at all for a phase while
    // `AuthService.resendVerification` existed and was tested. `IAuthService`
    // names the method, so a caller implementing that contract over this API
    // could not honour it — which is where the gap surfaced.
    it('POST /auth/resend-verification is reachable with no credential and answers like the others', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: 'ada@example.test' });

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ status: 'accepted' });
      expect(recovery.map((call) => call.method)).toEqual(['resendVerification']);
    });

    // The enumeration property, stated as one claim rather than inferred from
    // two literals: a known address and an unknown one must produce the same
    // status and the same body, or this endpoint is an oracle.
    it('answers a known and an unknown address identically', async () => {
      const known = await request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: 'ada@example.test' });
      const unknown = await request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: 'nobody@example.test' });

      expect(known.status).toBe(unknown.status);
      expect(known.body).toEqual(unknown.body);
    });

    it('POST /auth/forgot-password is reachable with no credential', async () => {
      // A caller asking for a recovery link has, by definition, no usable
      // credential — that is why they are asking.
      const response = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'ada@example.test' });

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ status: 'accepted' });
      expect(recovery.map((call) => call.method)).toEqual(['requestPasswordReset']);
    });

    it('POST /auth/reset-password is reachable with no credential and spends the credential', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ credential: 'a-delivered-value', secret: PLAINTEXT });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'reset' });
      expect(recovery[0]).toEqual({
        method: 'resetPassword',
        args: ['a-delivered-value', PLAINTEXT],
      });
    });

    it('sets no renewal cookie on a completed reset', async () => {
      // Recovery does not sign anybody in. Whoever completes one signs in with
      // the secret they have just chosen, which is also the first proof they
      // have it right.
      const response = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ credential: 'a-delivered-value', secret: PLAINTEXT });

      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('POST /auth/change-password is NOT reachable without a credential', async () => {
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .send({ currentSecret: PLAINTEXT, newSecret: OTHER_PLAINTEXT })
        .expect(401);
    });

    // NOTE the limit of this block. The services below are fakes, so what is
    // asserted here is that the controller CALLS them with the right arguments
    // and shapes the response — not what they do to each other. The composed
    // property ("every other session dies and the caller's stays usable") and
    // the statement ORDER that produces it are unobservable against a fake
    // `SessionService` handing back canned values: a review reversed the two
    // statements and this file stayed green. `change-password.spec.ts` drives
    // the real services over an in-memory store and owns that property.
    it('proves the current secret and re-issues for the caller it is serving', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', bearer())
        .send({ currentSecret: PLAINTEXT, newSecret: OTHER_PLAINTEXT })
        .expect(200);

      expect(recovery[0]).toMatchObject({
        // One call, not two. The change and the re-issue are one transaction in
        // `AuthService`, so there is no longer an order here to get wrong —
        // `change-password.spec.ts` drives the real services and owns that
        // property.
        method: 'changePasswordAndReissue',
        // The fourth argument is the client context the controller builds from
        // the request; `auth.controller.spec.ts` does not own what goes in it.
        args: [ACTOR_ID, PLAINTEXT, OTHER_PLAINTEXT, expect.any(Object)],
      });
      // The service ends every session, the caller's included. Without the
      // re-issue the caller is signed out by their own password change, which
      // reads as the change having failed.
      expect(response.body.accessToken).toBe(ISSUED_ACCESS);
      expect(cookieFrom(response.headers)).toContain(`${REFRESH_COOKIE.name}=${ISSUED_RENEWAL}`);
    });

    it('refuses a change body that omits the current secret', async () => {
      // Without it the endpoint would let anybody holding a borrowed session
      // replace the password and lock the owner out.
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', bearer())
        .send({ newSecret: OTHER_PLAINTEXT })
        .expect(400);
      expect(recovery).toEqual([]);
    });
  });

  describe('the renewal cookie', () => {
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

    it('tells the browser to keep it for the session\'s own lifetime, and no longer', () => {
      // Read off the header the browser actually receives, not off
      // `REFRESH_COOKIE.maxAgeMs`. A constant is a configuration; what the
      // browser is told is the behaviour, and `res.cookie` is free to translate
      // one into the other however it likes — or to be handed something else by
      // a call site.
      expect(REFRESH_COOKIE.maxAgeMs).toBe(SESSION_TTL_SECONDS * 1000);
      // A literal ceiling as well, so raising the constant is a decision
      // somebody takes here rather than one that slips through: a renewal
      // credential the browser keeps for a year is a year of not signing in
      // again, which is the one thing that reliably evicts a copied credential.
      expect(SESSION_TTL_SECONDS).toBeLessThanOrEqual(60 * 60 * 24 * 90);
    });

    it('emits that lifetime on the wire', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'ada@example.test', secret: PLAINTEXT });

      const maxAge = /Max-Age=(\d+)/.exec(cookieFrom(response.headers));
      expect(maxAge).not.toBeNull();
      expect(Number(maxAge![1])).toBe(SESSION_TTL_SECONDS);
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
