import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
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
    }));
    expect(built.map((p) => p.provider)).toEqual([AuthProvider.OIDC]);
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

    it('does not refuse when only the real OIDC side is configured', () => {
      const oidcOnly = {
        PUBLIC_API_URL: 'http://localhost:3000',
        OAUTH_OIDC_CLIENT_ID: 'id',
        OAUTH_OIDC_CLIENT_SECRET: 'OAUTH_OIDC_CLIENT_SECRET',
        OAUTH_OIDC_ISSUER_URL: 'https://issuer.example.test',
      };
      expect(buildOAuthProviders(configOf(oidcOnly))).toEqual([]);
    });

    it('does not refuse when only the development side is configured', () => {
      const built = buildOAuthProviders(configOf({
        PUBLIC_API_URL: 'http://localhost:3000',
        OAUTH_DEV_ENABLED: '1',
      }));
      expect(built.map((p) => p.provider)).toEqual([AuthProvider.OIDC]);
    });
  });
});
