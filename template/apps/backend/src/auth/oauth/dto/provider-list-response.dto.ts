import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';

/**
 * What `GET /auth/oauth/providers` answers.
 *
 * Just the list this deployment actually configured — never a placeholder for
 * one that is not, and never an error when the list is empty. ADR-0008: an
 * unconfigured provider is *absent* from the login page, never a crash and
 * never a button that fails when someone presses it. `{ providers: [] }` is a
 * normal, successful answer, not a degraded one.
 */
export class ProviderListResponseDto {
  providers!: AuthProvider[];
}
