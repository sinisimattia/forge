import { HttpStatus, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';
import request from 'supertest';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { IdentitiesController } from '../../../identities/identities.controller';
import { IS_PUBLIC } from '../../decorators';
import { REFRESH_COOKIE } from '../../refresh-cookie';
import type { IOAuthProvider } from '../IOAuthProvider';
import { OAuthProviderRegistry } from '../oauth-provider.registry';
import { OAuthController } from '../oauth.controller';
import { OAuthService } from '../oauth.service';

const PUBLIC_WEBAPP_URL = 'https://app.example.test';

/**
 * The literal this suite pins `OAuthController`'s own (unexported) constant
 * against — written out here rather than imported, the same discipline
 * `DOMAIN_ERROR_CODES`'s own webapp-side snapshot test uses: comparing the
 * controller's value to itself would pass no matter what that value was.
 * This is the route Nuxt's file-based routing turns
 * `apps/webapp/app/pages/oauth/callback.vue` into; the two apps share no
 * package (ADR-0008), so this literal is the whole of the cross-check.
 */
const OAUTH_CALLBACK_PATH = '/oauth/callback';

/**
 * The same pin for the second page this controller can land a browser on —
 * written out here rather than imported, for the reason above. This is the
 * route Nuxt turns `apps/webapp/app/pages/mfa/challenge.vue` into. **That
 * file does not exist yet**, so this literal is not merely the whole of the
 * cross-check, it is currently the only statement anywhere of where the
 * webapp half has to be built.
 */
const MFA_CHALLENGE_PATH = '/mfa/challenge';

/** A challenge token fixture, named after itself — see {@link ACCESS_TOKEN}. */
const CHALLENGE_TOKEN = 'CHALLENGE_TOKEN';

/** A fake adapter carrying nothing but the one field the registry reads. */
function fakeProvider(provider: AuthProvider): IOAuthProvider {
  return {
    provider,
    authorizationUrl: () => { throw new Error('not called in this suite'); },
    fetchAccount: () => { throw new Error('not called in this suite'); },
  };
}

function fakeResponse(): { redirect: jest.Mock; cookie: jest.Mock } {
  return { redirect: jest.fn(), cookie: jest.fn() };
}

function fakeRequest(): Request {
  return { ip: '203.0.113.9', get: () => undefined } as unknown as Request;
}

/** The location a mocked `response.redirect(status, url)` was called with. */
function redirectedTo(response: { redirect: jest.Mock }): string {
  return response.redirect.mock.calls[0][1] as string;
}

const CLIENT_REQUEST = fakeRequest();

/**
 * Fixture credential values, named after themselves — the same idiom
 * `identity-world.ts` already uses for a signing key, and the one that needs
 * no exemption marker of any kind. `tools/sanitize.mjs`'s populated-secret
 * rule matches a `TOKEN`-shaped key next to any non-empty quoted value, with
 * no way to tell a fixture literal from a real one by content alone, but
 * exempts a value that is exactly its own UPPER_SNAKE key name. Passed by
 * reference below, never inlined as a second quoted literal.
 */
const ACCESS_TOKEN = 'ACCESS_TOKEN';
const REFRESH_TOKEN = 'REFRESH_TOKEN';

/**
 * The routes, the wiring, and the error surface.
 *
 * `OAuthService` and `OAuthProviderRegistry` are stand-ins here, not the real
 * classes: this file is about what `OAuthController` does with what they hand
 * back, never about `begin`/`complete`/`beginLink` themselves, which have
 * their own suites (`oauth.service.begin.spec.ts`, `oauth.service.complete.spec.ts`).
 * `OAuthProviderRegistry` is the one real collaborator built directly — it
 * carries no `@Injectable()` and every other spec in this folder constructs
 * it with `new` the same way.
 */
describe('OAuthController', () => {
  let oauth: { begin: jest.Mock; beginLink: jest.Mock; complete: jest.Mock };

  /** Builds a controller with the given providers registered and a fresh mock service. */
  const build = (available: AuthProvider[]): OAuthController => {
    oauth = { begin: jest.fn(), beginLink: jest.fn(), complete: jest.fn() };
    const registry = new OAuthProviderRegistry(available.map(fakeProvider));
    return new OAuthController(
      oauth as unknown as OAuthService,
      registry,
      new ConfigService({ PUBLIC_WEBAPP_URL }),
    );
  };

  describe('providers', () => {
    it('lists only the providers this deployment configured', () => {
      const controller = build([AuthProvider.GOOGLE, AuthProvider.GITHUB]);
      expect(controller.providers()).toEqual({
        providers: [AuthProvider.GOOGLE, AuthProvider.GITHUB],
      });
    });

    it('lists nothing, rather than failing, when none are configured', () => {
      // An unconfigured provider is absent from the login page, never a
      // crash and never a button that fails when someone presses it
      // (ADR-0008).
      const controller = build([]);
      expect(controller.providers()).toEqual({ providers: [] });
    });

    it('is @Public() — the login page reading it has no credential to have proven', () => {
      expect(Reflect.getMetadata(IS_PUBLIC, OAuthController.prototype.providers)).toBe(true);
    });
  });

  describe('redirectToProvider', () => {
    it('redirects to the provider and sets no cookie on the way out', async () => {
      const controller = build([AuthProvider.GOOGLE]);
      oauth.begin.mockResolvedValue('https://accounts.google.test/authorize?state=abc');
      const response = fakeResponse();

      await controller.redirectToProvider('GOOGLE', '/dashboard', response as unknown as Response);

      expect(oauth.begin).toHaveBeenCalledWith('GOOGLE', '/dashboard');
      expect(response.redirect).toHaveBeenCalledWith(
        HttpStatus.FOUND,
        'https://accounts.google.test/authorize?state=abc',
      );
      expect(response.cookie).not.toHaveBeenCalled();
    });

    it('treats an absent redirectTo as none, not as the literal query value', async () => {
      const controller = build([AuthProvider.GOOGLE]);
      oauth.begin.mockResolvedValue('https://accounts.google.test/authorize');
      const response = fakeResponse();

      await controller.redirectToProvider('GOOGLE', undefined, response as unknown as Response);

      expect(oauth.begin).toHaveBeenCalledWith('GOOGLE', null);
    });

    it('is @Public() — beginning a sign-in has no credential yet to have proven', () => {
      expect(
        Reflect.getMetadata(IS_PUBLIC, OAuthController.prototype.redirectToProvider),
      ).toBe(true);
    });
  });

  describe('callback', () => {
    it('sets the renewal cookie and redirects to the callback page, carrying the destination as redirectTo', async () => {
      const controller = build([AuthProvider.GOOGLE]);
      const credentials = {
        session: {
          id: 'session-id' as SessionId,
          userId: 'user-id' as UserId,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
          revokedAt: null,
          clientAddress: null,
          clientLabel: null,
        },
        accessToken: ACCESS_TOKEN,
        refreshToken: REFRESH_TOKEN,
      };
      oauth.complete.mockResolvedValue({ status: 'SIGNED_IN', credentials, redirectTo: '/dashboard' });
      const response = fakeResponse();

      await controller.callback(
        'GOOGLE', 'the-code', 'the-state', CLIENT_REQUEST, response as unknown as Response,
      );

      // R5: the credential is in a cookie, and the URL carries nothing.
      expect(response.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE.name, REFRESH_TOKEN, expect.anything(),
      );
      const location = new URL(redirectedTo(response));
      // NOT `${PUBLIC_WEBAPP_URL}/dashboard` — a successful authorization no
      // longer lands directly on its own destination. It lands on the one
      // page that can actually renew a session and show a refusal, carrying
      // the destination as a query value. See `landingUrl`'s own TSDoc for
      // why: a refusal that found the same row used to land wherever THIS
      // authorization was headed, on a page that renders no `error` at all.
      expect(location.origin + location.pathname).toBe(`${PUBLIC_WEBAPP_URL}${OAUTH_CALLBACK_PATH}`);
      expect(location.searchParams.get('redirectTo')).toBe('/dashboard');
      expect(location.searchParams.get('error')).toBeNull();
      expect(location.toString()).not.toContain(credentials.accessToken);
      expect(location.toString()).not.toContain(credentials.refreshToken);
    });

    it('lands on the challenge page, with the token and no cookie, when a second factor is owed', async () => {
      // Spec §8.4's ending on the wire. The two halves that have to meet are
      // the token and the destination: a controller that redirected to the
      // ordinary callback page would leave the token nowhere it can be spent,
      // and one that landed here without it would send somebody to a page
      // that cannot ask them for anything.
      const controller = build([AuthProvider.GOOGLE]);
      oauth.complete.mockResolvedValue({
        status: 'MFA_REQUIRED', challengeToken: CHALLENGE_TOKEN, redirectTo: '/dashboard',
      });
      const response = fakeResponse();

      await controller.callback('GOOGLE', 'code', 'state', CLIENT_REQUEST, response as unknown as Response);

      const location = new URL(redirectedTo(response));
      expect(location.origin + location.pathname).toBe(`${PUBLIC_WEBAPP_URL}${MFA_CHALLENGE_PATH}`);
      expect(location.searchParams.get('challengeToken')).toBe(CHALLENGE_TOKEN);
      // The destination survives the detour: whoever completes the factor
      // still ends up where they were going.
      expect(location.searchParams.get('redirectTo')).toBe('/dashboard');
      // The one that would catch a session issued and merely not mentioned at
      // this boundary. Only SIGNED_IN sets the renewal cookie.
      expect(response.cookie).not.toHaveBeenCalled();
      expect(location.searchParams.get('error')).toBeNull();
    });

    it('lands on the callback page with no redirectTo when the authorization carried none', async () => {
      const controller = build([AuthProvider.GOOGLE]);
      oauth.complete.mockResolvedValue({ status: 'LINKED', redirectTo: null });
      const response = fakeResponse();

      await controller.callback('GOOGLE', 'code', 'state', CLIENT_REQUEST, response as unknown as Response);

      const location = new URL(redirectedTo(response));
      expect(location.origin + location.pathname).toBe(`${PUBLIC_WEBAPP_URL}${OAUTH_CALLBACK_PATH}`);
      // Omitted, not sent empty — the callback page reads its absence as
      // "nowhere was recorded" and falls back to its own default.
      expect(location.searchParams.has('redirectTo')).toBe(false);
      // Completing a LINK must never issue a session — the actor already had
      // one, proven by reaching this authenticated flow in the first place.
      // Only SIGNED_IN sets the renewal cookie.
      expect(response.cookie).not.toHaveBeenCalled();
    });

    it('redirects to the callback page on every refusal, carrying the destination it would otherwise have hidden the message on', async () => {
      const controller = build([AuthProvider.GOOGLE]);
      oauth.complete.mockResolvedValue({
        status: 'REFUSED', code: 'EMAIL_ALREADY_REGISTERED', redirectTo: '/sign-in',
      });
      const response = fakeResponse();

      await controller.callback('GOOGLE', 'code', 'state', CLIENT_REQUEST, response as unknown as Response);

      // The caller is a browser that followed a redirect here. A JSON 400
      // would show a person a raw error document on an origin they did not
      // choose to visit.
      const location = new URL(redirectedTo(response));
      // **The regression this suite exists to catch.** A `redirectTo` this
      // authorization carried must land the browser on the callback page —
      // which actually renders `error` — never directly on `/sign-in`, which
      // does not: that was the defect ("a refusal with no route forward")
      // this whole flow was rebuilt to close.
      expect(location.origin + location.pathname).toBe(`${PUBLIC_WEBAPP_URL}${OAUTH_CALLBACK_PATH}`);
      expect(location.searchParams.get('redirectTo')).toBe('/sign-in');
      expect(location.searchParams.get('error')).toBe('EMAIL_ALREADY_REGISTERED');
      expect(response.cookie).not.toHaveBeenCalled();
    });

    it('puts no provider-supplied text in the redirect', async () => {
      const controller = build([AuthProvider.GOOGLE]);
      // The provider's error is data from somewhere else. What is rendered
      // is one of this repository's own codes.
      oauth.complete.mockRejectedValue(new Error('<script>whatever</script>'));
      const response = fakeResponse();

      await controller.callback('GOOGLE', 'code', 'state', CLIENT_REQUEST, response as unknown as Response);

      const location = redirectedTo(response);
      expect(location).toContain('error=PROVIDER_UNAVAILABLE');
      expect(location).not.toContain('script');
    });

    it('never lets an exception escape — every failure becomes a redirect', async () => {
      const controller = build([AuthProvider.GOOGLE]);
      oauth.complete.mockRejectedValue(new Error('anything at all, including something unanticipated'));
      const response = fakeResponse();

      await expect(
        controller.callback('GOOGLE', 'code', 'state', CLIENT_REQUEST, response as unknown as Response),
      ).resolves.toBeUndefined();
      expect(response.redirect).toHaveBeenCalledWith(
        HttpStatus.FOUND, expect.stringContaining('error=PROVIDER_UNAVAILABLE'),
      );
    });

    it('redirects without ever calling complete when the provider sent no code', async () => {
      // A real provider redirect carries no `code` when a person refuses
      // consent — only `error=access_denied` and the `state`. Nothing here
      // is a row this application could look up.
      const controller = build([AuthProvider.GOOGLE]);
      const response = fakeResponse();

      await controller.callback(
        'GOOGLE', undefined, 'the-state', CLIENT_REQUEST, response as unknown as Response,
      );

      expect(oauth.complete).not.toHaveBeenCalled();
      expect(redirectedTo(response)).toContain('error=AUTHORIZATION_UNKNOWN');
    });

    it('is @Public() — its caller is the provider\'s own redirect, carrying nothing of ours but the state', () => {
      expect(Reflect.getMetadata(IS_PUBLIC, OAuthController.prototype.callback)).toBe(true);
    });
  });

  describe('linking requires a proven identity', () => {
    it('requires a proven identity to begin a link', () => {
      // The link route lives on IdentitiesController, not here, and carries
      // no @Public(): the global JwtAuthGuard closes it. Asserted by reading
      // the metadata off the shipped handler, not by calling it.
      expect(
        Reflect.getMetadata(IS_PUBLIC, IdentitiesController.prototype.beginLink),
      ).toBeUndefined();
    });
  });
});

/**
 * `OAuthController` compiled into a real Nest testing module and driven over
 * HTTP — the same pattern `identities.controller.spec.ts` already uses.
 *
 * Every case above calls a method directly, with a hand-built `Response`
 * mock, which is fast and precise about *what a method does with what it is
 * given* but proves nothing about *whether Nest ever hands it those things
 * in the first place*. Two properties specifically need a real, routed
 * application to be evidenced at all:
 *
 * - **Route declaration order.** `oauth.controller.ts`'s own comment explains
 *   that `providers` must be declared before `:provider`, or Express reads
 *   `GET /auth/oauth/providers` as `:provider = "providers"` and the literal
 *   route is never reached. Reordering the two methods breaks nothing a
 *   direct-call test can see — `controller.providers()` still returns the
 *   right thing when called directly — and the actual symptom is the login
 *   page's own provider list 404ing, which is exactly the ADR-0008 failure
 *   this whole task exists to prevent.
 * - **The callback's argument binding.** `redirectToProvider`'s own suite
 *   asserts `oauth.begin` is called with the right arguments; nothing did
 *   the equivalent for `callback` — a swapped `@Query('code')`/`@Query('state')`,
 *   or a dropped `clientContextOf(request)`, would pass every case above,
 *   because they all call `controller.callback(...)` directly with
 *   already-correct arguments rather than letting Nest extract them from a
 *   request.
 */
describe('OAuthController — mounted as a real controller', () => {
  let app: INestApplication;
  let oauth: { begin: jest.Mock; beginLink: jest.Mock; complete: jest.Mock };

  beforeEach(async () => {
    oauth = { begin: jest.fn(), beginLink: jest.fn(), complete: jest.fn() };
    const registry = new OAuthProviderRegistry(
      [AuthProvider.GOOGLE, AuthProvider.GITHUB].map(fakeProvider),
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [OAuthController],
      providers: [
        { provide: OAuthService, useValue: oauth },
        { provide: OAuthProviderRegistry, useValue: registry },
        { provide: ConfigService, useValue: new ConfigService({ PUBLIC_WEBAPP_URL }) },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers GET /auth/oauth/providers itself, rather than letting :provider swallow it', async () => {
    const response = await request(app.getHttpServer()).get('/auth/oauth/providers').expect(200);

    expect(response.body).toEqual({ providers: [AuthProvider.GOOGLE, AuthProvider.GITHUB] });
    // If the literal route had been swallowed, this would have reached
    // `redirectToProvider` instead, which calls `begin` and tries to redirect —
    // the negative half of the assertion above, made explicit.
    expect(oauth.begin).not.toHaveBeenCalled();
  });

  it('binds the callback\'s code, state and client context to exactly what a request carried', async () => {
    oauth.complete.mockResolvedValue({ status: 'REFUSED', code: 'AUTHORIZATION_UNKNOWN', redirectTo: null });

    await request(app.getHttpServer())
      .get('/auth/oauth/GOOGLE/callback')
      .query({ code: 'the-real-code', state: 'the-real-state' })
      .set('User-Agent', 'oauth-controller-spec-agent')
      .expect(302);

    expect(oauth.complete).toHaveBeenCalledTimes(1);
    const [provider, code, state, client] = oauth.complete.mock.calls[0];
    // Named individually, not `toHaveBeenCalledWith(...)` against the whole
    // tuple: a swapped `code`/`state` is the exact defect this test exists
    // to catch, and asserting each argument by its own name is what makes a
    // swap fail on the argument that actually moved rather than on the call
    // as an undifferentiated blob.
    expect(provider).toBe('GOOGLE');
    expect(code).toBe('the-real-code');
    expect(state).toBe('the-real-state');
    expect(client).toMatchObject({ label: 'oauth-controller-spec-agent' });
  });
});
