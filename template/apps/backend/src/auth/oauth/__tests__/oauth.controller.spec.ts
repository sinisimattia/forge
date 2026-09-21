import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
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
 * The routes, the wiring, and the error surface — Task 12.
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
    it('sets the renewal cookie and redirects to the webapp on a successful sign-in', async () => {
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
      const location = redirectedTo(response);
      expect(location).toBe(`${PUBLIC_WEBAPP_URL}/dashboard`);
      expect(location).not.toContain(credentials.accessToken);
      expect(location).not.toContain(credentials.refreshToken);
    });

    it('lands on the default path when the authorization carried none', async () => {
      const controller = build([AuthProvider.GOOGLE]);
      oauth.complete.mockResolvedValue({ status: 'LINKED', redirectTo: null });
      const response = fakeResponse();

      await controller.callback('GOOGLE', 'code', 'state', CLIENT_REQUEST, response as unknown as Response);

      expect(redirectedTo(response)).toBe(`${PUBLIC_WEBAPP_URL}/`);
    });

    it('redirects, rather than answering a status code, on every refusal', async () => {
      const controller = build([AuthProvider.GOOGLE]);
      oauth.complete.mockResolvedValue({
        status: 'REFUSED', code: 'EMAIL_ALREADY_REGISTERED', redirectTo: '/sign-in',
      });
      const response = fakeResponse();

      await controller.callback('GOOGLE', 'code', 'state', CLIENT_REQUEST, response as unknown as Response);

      // The caller is a browser that followed a redirect here. A JSON 400
      // would show a person a raw error document on an origin they did not
      // choose to visit.
      expect(response.redirect).toHaveBeenCalledWith(
        HttpStatus.FOUND, expect.stringContaining('error=EMAIL_ALREADY_REGISTERED'),
      );
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
