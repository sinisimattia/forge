import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { IOAuthProvider } from './IOAuthProvider';

/**
 * Which providers this deployment has, and the only way to name one.
 *
 * Built once, from whatever `buildOAuthProviders` returned, and handed the
 * adapters directly — it does not read configuration itself and does not know
 * how a provider came to be registered, only that it was.
 */
export class OAuthProviderRegistry {
  /** The providers this deployment registered, in the order it registered them. */
  public readonly available: readonly AuthProvider[];

  constructor(private readonly providers: readonly IOAuthProvider[]) {
    this.available = providers.map((candidate) => candidate.provider);
  }

  /**
   * `find` takes the raw route parameter and answers `null` for anything that is
   * not a provider this deployment actually registered. **A whitelist over the
   * registered adapters, not a cast into `AuthProvider` and not a check against
   * the enum's members**: the enum contains every provider that could ever exist,
   * so validating against it accepts `GITHUB` on a deployment that configured only
   * Google, and the flow then fails somewhere further in with something less
   * legible. Refusing what is not modelled, rather than enumerating what is
   * rejected, is the rule this repository settled on after five rounds of the
   * other approach in `migration-sql.spec.ts`.
   */
  find(name: string): IOAuthProvider | null {
    return this.providers.find((candidate) => candidate.provider === name) ?? null;
  }
}
