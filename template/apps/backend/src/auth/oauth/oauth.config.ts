import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';
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
 * Stands in for a real adapter until Tasks 6–8 write one.
 *
 * `buildOAuthProviders` below decides WHICH providers a deployment has — the
 * config-presence rules are this task's (Task 5's) whole job. What each
 * provider actually does once called is Tasks 6, 7 and 8's: the development
 * adapter, Google, the generic OIDC adapter and GitHub. Nothing in this
 * factory's own tests calls `authorizationUrl` or `fetchAccount`, and no route
 * can reach them yet either — `OAuthProviderRegistry` is not consumed until
 * Task 12 — so this class carries only the one thing the factory's contract
 * needs right now, `provider`, set correctly, and refuses loudly rather than
 * returning a value that would look like it worked.
 *
 * Each of Tasks 6, 7 and 8 replaces the branch below that constructs one of
 * these with `new <Provider>OAuthProvider(...)`. Nothing else in this file —
 * the presence rules, the two refusals, the exported signature — is theirs to
 * change; see `IOAuthProvider`'s own note that the factory is used by
 * reference, not by copy.
 */
class PlaceholderOAuthProvider implements IOAuthProvider {
  constructor(public readonly provider: AuthProvider) {}

  authorizationUrl(): string {
    return this.notImplemented();
  }

  fetchAccount(): Promise<FederatedAccount> {
    return this.notImplemented();
  }

  private notImplemented(): never {
    throw new Error(
      `${this.provider}: no adapter is registered yet. buildOAuthProviders only decides `
      + 'which providers this deployment has; Tasks 6–8 write the adapters this placeholder '
      + 'stands in for.',
    );
  }
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

  if (!googleConfigured && !githubConfigured && !devEnabled) {
    return [];
  }

  config.getOrThrow<string>('PUBLIC_API_URL');

  const providers: IOAuthProvider[] = [];
  if (googleConfigured) {
    providers.push(new PlaceholderOAuthProvider(AuthProvider.GOOGLE));
  }
  if (githubConfigured) {
    providers.push(new PlaceholderOAuthProvider(AuthProvider.GITHUB));
  }
  if (devEnabled) {
    providers.push(new PlaceholderOAuthProvider(AuthProvider.OIDC));
  }

  return providers;
}
