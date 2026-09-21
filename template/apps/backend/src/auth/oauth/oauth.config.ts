import { ConfigService } from '@nestjs/config';
import { DevOAuthProvider } from './adapters/DevOAuthProvider';
import { GitHubOAuthProvider } from './adapters/GitHubOAuthProvider';
import { GoogleOAuthProvider } from './adapters/GoogleOAuthProvider';
import { OidcOAuthProvider } from './adapters/OidcOAuthProvider';
import type { IOAuthProvider } from './IOAuthProvider';

/** A config key is "configured" when it is present and non-empty — never merely truthy. */
function isConfigured(config: ConfigService, key: string): boolean {
  const value = config.get<string>(key);
  return typeof value === 'string' && value.length > 0;
}

/** An adapter needing a client id and a client secret has both, or neither counts. */
function hasCredentialPair(config: ConfigService, idKey: string, secretKey: string): boolean {
  return isConfigured(config, idKey) && isConfigured(config, secretKey);
}

/**
 * Which providers this deployment has, decided once at start-up.
 *
 * Exported by name so `AuthModule` uses this exact function — a spec that
 * rebuilt this logic would be testing itself, not the thing that ships.
 *
 * An adapter is built only when **every** variable it needs is present and
 * non-empty; a partially configured provider (one of two variables set) is
 * treated the same as an unconfigured one, silently — there is no
 * `MISCONFIGURED_PROVIDER` error, because a deployment mid-setup and a
 * deployment that never touched this provider are indistinguishable from here,
 * and both are safe to treat as "not offered."
 *
 * A **fully** configured provider is never silently dropped, which is the other
 * half of that same rule and just as load-bearing: all four presence flags
 * (`devEnabled`, `googleConfigured`, `githubConfigured`, `oidcConfigured`) feed
 * the same "is anything configured" decision and the same `PUBLIC_API_URL`
 * requirement below, on identical terms. None of the four is a special case
 * that skips either — a deployment that correctly set every `OAUTH_OIDC_*`
 * variable and nothing else must not boot cleanly with an empty provider list
 * just because it configured the one provider that also participates in the
 * refusal below.
 *
 * ## `PUBLIC_API_URL`
 *
 * Required, with no default, the moment any provider is about to be built —
 * never read off an incoming request. The reasoning is the one already written
 * down for `PUBLIC_WEBAPP_URL` in `apps/backend/src/mail/templates/reset-password.ts`:
 * a value built from a request's `Host` header is chosen by whoever sends the
 * request, not by this deployment, so a redirect URI built that way would let
 * anyone who can reach this API choose the origin an authorization code is
 * delivered to. There is exactly one trustworthy source for this origin: the
 * value this deployment configured once, ahead of time. It is validated here,
 * at start-up, rather than left to surface the first time a provider builds an
 * authorization URL, so a missing value is a boot failure and not a broken
 * sign-in link discovered by whoever clicks it first.
 *
 * (`OAuthService` — the one consumer of whatever this function
 * returns — reads this same variable unconditionally, in its own constructor,
 * whether or not any provider is configured. The check here is not made
 * redundant by that: `OAuthProviderRegistry`, which is built from this
 * function's own return value, is one of `OAuthService`'s dependencies, so
 * Nest constructs this function's result before `OAuthService` ever runs —
 * this is still the first place a missing value is caught, and the only place
 * that catches it *only* when a provider was actually configured, which is
 * what the four tests below this doc pin.)
 *
 * ## `OAUTH_DEV_EMAIL`
 *
 * Required whenever `OAUTH_DEV_ENABLED` is, on the same terms as every other
 * provider's own credentials: absent it, this factory refuses to build the
 * development provider rather than falling back to a placeholder address
 * nobody chose. It is the one address {@link DevOAuthProvider} will ever
 * assert — see that class's own doc for why a fixed, configured address
 * (never a page, never a request) is what makes it a *development* adapter
 * rather than an unauthenticated sign-in form with extra steps.
 *
 * ## Two refusals, not one
 *
 * **Production never runs the development provider.** `OAUTH_DEV_ENABLED`
 * registers an adapter that authenticates nobody, on purpose — it exists so a
 * freshly generated project can exercise federated sign-in with no developer
 * application registered anywhere. Set alongside `NODE_ENV=production`, that is
 * not a safe default to fall back on; this factory refuses to build anything
 * at all rather than let it run where a real user could reach it. The message
 * tells the operator to unset `OAUTH_DEV_ENABLED` and deliberately never
 * suggests changing `NODE_ENV`, which would silently disable every other
 * production behaviour this application has (see `refresh-cookie.ts`'s own
 * `secure` flag) to route around one variable.
 *
 * **The development provider and a real generic OIDC provider never register
 * together, in any environment.** Both claim `AuthProvider.OIDC` — the enum has
 * no separate member for "the fake one," and adding one would store a
 * distinction nothing about a persisted identity needs to know. Configuring
 * both would give `OAuthProviderRegistry.find('OIDC')` two adapters answering
 * to the one name, with no way to say which won beyond the order lines happen
 * to run in this file — silent precedence between a real provider and one that
 * authenticates nobody is worse than refusing outright, so this factory does
 * neither silently: it refuses, naming both variables, before either could be
 * built.
 */
export function buildOAuthProviders(config: ConfigService): IOAuthProvider[] {
  const devEnabled = isConfigured(config, 'OAUTH_DEV_ENABLED');
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  if (devEnabled && isProduction) {
    throw new Error(
      'OAUTH_DEV_ENABLED is set with NODE_ENV=production. The development provider '
      + 'authenticates nobody by design — it exists only so a freshly generated project can '
      + 'exercise federated sign-in with no developer application registered anywhere — and '
      + 'must never run where a real user could reach it. Unset OAUTH_DEV_ENABLED for this '
      + 'environment. Changing NODE_ENV is not the fix: it would silently disable every other '
      + 'production behaviour this application has along with this one guard.',
    );
  }

  const oidcConfigured = hasCredentialPair(
    config, 'OAUTH_OIDC_CLIENT_ID', 'OAUTH_OIDC_CLIENT_SECRET',
  ) && isConfigured(config, 'OAUTH_OIDC_ISSUER_URL');

  if (devEnabled && oidcConfigured) {
    throw new Error(
      'OAUTH_DEV_ENABLED and OAUTH_OIDC_CLIENT_ID/OAUTH_OIDC_CLIENT_SECRET/OAUTH_OIDC_ISSUER_URL '
      + 'are all set. The development provider and a real generic OIDC provider both register '
      + 'under AuthProvider.OIDC, so this deployment would end up with two adapters answering '
      + 'to the same name, and registry.find(\'OIDC\') would silently return whichever this '
      + 'factory happened to build first — whether sign-in is genuine would depend on the order '
      + 'of lines in this file. Unset OAUTH_DEV_ENABLED to use the real provider, or unset the '
      + 'three OAUTH_OIDC_* variables to keep the development one.',
    );
  }

  const googleConfigured = hasCredentialPair(
    config, 'OAUTH_GOOGLE_CLIENT_ID', 'OAUTH_GOOGLE_CLIENT_SECRET',
  );
  const githubConfigured = hasCredentialPair(
    config, 'OAUTH_GITHUB_CLIENT_ID', 'OAUTH_GITHUB_CLIENT_SECRET',
  );

  if (!googleConfigured && !githubConfigured && !oidcConfigured && !devEnabled) {
    return [];
  }

  // Required the moment any provider is about to be built, including the
  // development one — see this function's own `## PUBLIC_API_URL` doc above.
  // The value itself is not needed below: every real adapter's redirect URI
  // is built by `OAuthService`, not here — `DevOAuthProvider` does not need it
  // either (its `authorizationUrl` now echoes back
  // `params.redirectUri`, which is already that same value). Called for the
  // throw alone, so a deployment missing it still fails here rather than on
  // whichever adapter happens to be built first.
  config.getOrThrow<string>('PUBLIC_API_URL');

  const providers: IOAuthProvider[] = [];
  if (googleConfigured) {
    providers.push(new GoogleOAuthProvider({
      clientId: config.getOrThrow<string>('OAUTH_GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow<string>('OAUTH_GOOGLE_CLIENT_SECRET'),
    }));
  }
  if (githubConfigured) {
    providers.push(new GitHubOAuthProvider({
      clientId: config.getOrThrow<string>('OAUTH_GITHUB_CLIENT_ID'),
      clientSecret: config.getOrThrow<string>('OAUTH_GITHUB_CLIENT_SECRET'),
    }));
  }
  // oidcConfigured and devEnabled are mutually exclusive by construction: the PF-1
  // guard above throws before this point whenever both are true, so at most one of
  // these two branches ever runs and AuthProvider.OIDC is never pushed twice.
  if (oidcConfigured) {
    providers.push(new OidcOAuthProvider(
      config.getOrThrow<string>('OAUTH_OIDC_ISSUER_URL'),
      {
        clientId: config.getOrThrow<string>('OAUTH_OIDC_CLIENT_ID'),
        clientSecret: config.getOrThrow<string>('OAUTH_OIDC_CLIENT_SECRET'),
      },
    ));
  }
  if (devEnabled) {
    // Required whenever the development provider is enabled, on the same
    // "fail at start-up, not on first click" terms as every other
    // provider's own credentials above — see `DevOAuthProvider`'s own doc
    // for why this is the one and only address it will ever assert, and why
    // that has to come from configuration rather than a page.
    providers.push(new DevOAuthProvider(config.getOrThrow<string>('OAUTH_DEV_EMAIL')));
  }

  return providers;
}
