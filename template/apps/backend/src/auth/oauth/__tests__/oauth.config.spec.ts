import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { DevOAuthProvider } from '../adapters/DevOAuthProvider';
import { GitHubOAuthProvider } from '../adapters/GitHubOAuthProvider';
import { GoogleOAuthProvider } from '../adapters/GoogleOAuthProvider';
import { OidcOAuthProvider } from '../adapters/OidcOAuthProvider';
import { buildOAuthProviders } from '../oauth.config';
import type { IOAuthProvider } from '../IOAuthProvider';

function configOf(env: Record<string, string>): ConfigService {
  return new ConfigService(env);
}

describe('buildOAuthProviders', () => {
  it('registers nothing when nothing is configured', () => {
    expect(buildOAuthProviders(configOf({ PUBLIC_API_URL: 'http://localhost:3000' }))).toEqual([]);
  });

  it('registers Google only when both of its variables are present', () => {
    const half = buildOAuthProviders(configOf({
      PUBLIC_API_URL: 'http://localhost:3000',
      OAUTH_GOOGLE_CLIENT_ID: 'id',
      // secret absent
    }));
    expect(half).toEqual([]);
  });

  it('registers each fully configured provider once', () => {
    const built = buildOAuthProviders(configOf({
      PUBLIC_API_URL: 'http://localhost:3000',
      OAUTH_GOOGLE_CLIENT_ID: 'id', OAUTH_GOOGLE_CLIENT_SECRET: 'OAUTH_GOOGLE_CLIENT_SECRET',
      OAUTH_GITHUB_CLIENT_ID: 'id', OAUTH_GITHUB_CLIENT_SECRET: 'OAUTH_GITHUB_CLIENT_SECRET',
    }));
    expect(built.map((p) => p.provider)).toEqual([AuthProvider.GOOGLE, AuthProvider.GITHUB]);
  });

  it('refuses to start when the development provider is configured in production', () => {
    expect(() => buildOAuthProviders(configOf({
      NODE_ENV: 'production',
      PUBLIC_API_URL: 'https://api.example.test',
      OAUTH_DEV_ENABLED: '1',
    }))).toThrow(/OAUTH_DEV_ENABLED/);
  });

  it('refuses at start-up rather than quietly declining to register', () => {
    // The distinction this asserts: a silent decline is the failure mode where a
    // staging configuration reaches production and nobody ever learns which half
    // of the condition saved them.
    let registered: IOAuthProvider[] | null = null;
    try {
      registered = buildOAuthProviders(configOf({
        NODE_ENV: 'production', PUBLIC_API_URL: 'https://api.example.test', OAUTH_DEV_ENABLED: '1',
      }));
    } catch { /* expected */ }
    expect(registered).toBeNull();
  });

  it('registers the development provider outside production', () => {
    const built = buildOAuthProviders(configOf({
      NODE_ENV: 'development',
      PUBLIC_API_URL: 'http://localhost:3000',
      OAUTH_DEV_ENABLED: '1',
      OAUTH_DEV_EMAIL: 'dev-signin@example.test',
    }));
    expect(built.map((p) => p.provider)).toEqual([AuthProvider.OIDC]);
  });

  it('refuses to start when the development provider is enabled but OAUTH_DEV_EMAIL is not', () => {
    // Same shape as the PUBLIC_API_URL regression case just below: the one
    // address this adapter will ever assert has to come from configuration,
    // fail at start-up when it is missing, and never fall back to a
    // placeholder nobody chose.
    expect(() => buildOAuthProviders(configOf({
      NODE_ENV: 'development',
      PUBLIC_API_URL: 'http://localhost:3000',
      OAUTH_DEV_ENABLED: '1',
    }))).toThrow(/OAUTH_DEV_EMAIL/);
  });

  it('refuses to start when a provider is configured but PUBLIC_API_URL is not', () => {
    // Same reasoning as apps/backend/src/mail/templates/reset-password.ts: the redirect
    // origin is deployment-configured or it is not trustworthy, and a missing value must
    // fail at start-up rather than surface as a broken link built from whatever a request
    // happened to carry.
    expect(() => buildOAuthProviders(configOf({
      OAUTH_GOOGLE_CLIENT_ID: 'id', OAUTH_GOOGLE_CLIENT_SECRET: 'OAUTH_GOOGLE_CLIENT_SECRET',
    }))).toThrow(/PUBLIC_API_URL/);
  });

  describe('the development/real-OIDC collision (PF-1)', () => {
    const collidingEnv = {
      PUBLIC_API_URL: 'http://localhost:3000',
      OAUTH_DEV_ENABLED: '1',
      OAUTH_OIDC_CLIENT_ID: 'id',
      OAUTH_OIDC_CLIENT_SECRET: 'OAUTH_OIDC_CLIENT_SECRET',
      OAUTH_OIDC_ISSUER_URL: 'https://issuer.example.test',
    };

    it('refuses to start when both are fully configured', () => {
      expect(() => buildOAuthProviders(configOf(collidingEnv))).toThrow(/OAUTH_DEV_ENABLED/);
    });

    it('names the OIDC variables too, not just the dev one', () => {
      expect(() => buildOAuthProviders(configOf(collidingEnv))).toThrow(/OAUTH_OIDC_CLIENT_ID/);
    });

    it('refuses outside production as well — this is not the production guard', () => {
      expect(() => buildOAuthProviders(configOf({ ...collidingEnv, NODE_ENV: 'development' })))
        .toThrow(/OAUTH_DEV_ENABLED/);
    });

    it('registers the real OIDC provider when only it is configured — not a silent no-op', () => {
      // A fully configured provider is never silently dropped, same as Google or GitHub
      // (see "registers each fully configured provider once" above) — "does not refuse
      // the collision" must not be confused with "does not register". An earlier version
      // of this test asserted `toEqual([])` here, which encoded exactly that confusion: it
      // read as coverage for the collision guard while actually pinning a defect where a
      // correctly configured OIDC deployment booted with an empty provider list.
      const oidcOnly = {
        PUBLIC_API_URL: 'http://localhost:3000',
        OAUTH_OIDC_CLIENT_ID: 'id',
        OAUTH_OIDC_CLIENT_SECRET: 'OAUTH_OIDC_CLIENT_SECRET',
        OAUTH_OIDC_ISSUER_URL: 'https://issuer.example.test',
      };
      const built = buildOAuthProviders(configOf(oidcOnly));
      expect(built.map((p) => p.provider)).toEqual([AuthProvider.OIDC]);
    });

    it('refuses to start when only the real OIDC provider is configured but PUBLIC_API_URL is not', () => {
      // The direct regression case for the same gap: OIDC's three variables must gate
      // PUBLIC_API_URL exactly as Google's and GitHub's two do (see "refuses to start when
      // a provider is configured but PUBLIC_API_URL is not" above) — this is that same
      // assertion, with OIDC as the configured provider instead of Google.
      expect(() => buildOAuthProviders(configOf({
        OAUTH_OIDC_CLIENT_ID: 'id',
        OAUTH_OIDC_CLIENT_SECRET: 'OAUTH_OIDC_CLIENT_SECRET',
        OAUTH_OIDC_ISSUER_URL: 'https://issuer.example.test',
      }))).toThrow(/PUBLIC_API_URL/);
    });

    it('does not refuse when only the development side is configured', () => {
      const built = buildOAuthProviders(configOf({
        PUBLIC_API_URL: 'http://localhost:3000',
        OAUTH_DEV_ENABLED: '1',
        OAUTH_DEV_EMAIL: 'dev-signin@example.test',
      }));
      expect(built.map((p) => p.provider)).toEqual([AuthProvider.OIDC]);
    });
  });

  describe('the placeholder seam is closed', () => {
    // `UnimplementedOAuthProvider` (the placeholder Tasks 6-8 replaced branch by
    // branch) has been deleted outright — this task was its last construction
    // site, and a placeholder with nothing left constructing it is dead code, not
    // a safety net. What replaces "no provider is an instanceof the placeholder"
    // is the stronger, positive form: every provider this factory can return is
    // an instance of a real, named adapter class. A closed accept-list catches
    // exactly what the negative check caught (a provider that looks registered
    // but authenticates nobody) and additionally catches any *other* stand-in
    // that might be reintroduced later, which a check against one specific
    // deleted class name could not.
    //
    // `OAUTH_DEV_ENABLED` and the real OIDC variables can never be configured
    // together (the PF-1 guard above throws first) — see `buildOAuthProviders`'s
    // own "Two refusals" doc — so "every provider it is legal to enable at once"
    // is two configurations, not one: dev + Google + GitHub, and real OIDC +
    // Google + GitHub.
    const REAL_ADAPTER_CLASSES = [
      DevOAuthProvider, GoogleOAuthProvider, GitHubOAuthProvider, OidcOAuthProvider,
    ];

    function expectOnlyRealAdapters(providers: IOAuthProvider[]): void {
      for (const provider of providers) {
        expect(REAL_ADAPTER_CLASSES.some((Adapter) => provider instanceof Adapter)).toBe(true);
      }
    }

    it('builds only real adapters with the development provider alongside Google and GitHub', () => {
      const built = buildOAuthProviders(configOf({
        PUBLIC_API_URL: 'http://localhost:3000',
        OAUTH_DEV_ENABLED: '1',
        OAUTH_DEV_EMAIL: 'dev-signin@example.test',
        OAUTH_GOOGLE_CLIENT_ID: 'id', OAUTH_GOOGLE_CLIENT_SECRET: 'OAUTH_GOOGLE_CLIENT_SECRET',
        OAUTH_GITHUB_CLIENT_ID: 'id', OAUTH_GITHUB_CLIENT_SECRET: 'OAUTH_GITHUB_CLIENT_SECRET',
      }));

      expect(built.map((p) => p.provider)).toEqual(
        [AuthProvider.GOOGLE, AuthProvider.GITHUB, AuthProvider.OIDC],
      );
      expectOnlyRealAdapters(built);
    });

    it('builds only real adapters with the real generic OIDC provider alongside Google and GitHub', () => {
      const built = buildOAuthProviders(configOf({
        PUBLIC_API_URL: 'http://localhost:3000',
        OAUTH_OIDC_CLIENT_ID: 'id',
        OAUTH_OIDC_CLIENT_SECRET: 'OAUTH_OIDC_CLIENT_SECRET',
        OAUTH_OIDC_ISSUER_URL: 'https://issuer.example.test',
        OAUTH_GOOGLE_CLIENT_ID: 'id', OAUTH_GOOGLE_CLIENT_SECRET: 'OAUTH_GOOGLE_CLIENT_SECRET',
        OAUTH_GITHUB_CLIENT_ID: 'id', OAUTH_GITHUB_CLIENT_SECRET: 'OAUTH_GITHUB_CLIENT_SECRET',
      }));

      expect(built.map((p) => p.provider)).toEqual(
        [AuthProvider.GOOGLE, AuthProvider.GITHUB, AuthProvider.OIDC],
      );
      expectOnlyRealAdapters(built);
    });
  });
});
