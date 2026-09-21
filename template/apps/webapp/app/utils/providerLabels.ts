import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';

/**
 * One translation key per provider, named once for every screen that shows one.
 *
 * A `Record` over core's enum, so a provider added there is a compile error
 * here rather than a row or a button labelled with a raw enum value — the
 * same forcing function `IdentityList` already relied on before this module
 * existed. `OAuthButtons` imports this directly; `IdentityList` still holds
 * its own copy of the same four entries because a second, unrelated task owns
 * that file and two tasks editing it is how a merge conflict or a lost edit
 * happens. That duplication is temporary and intentional, not drift: the
 * values below are identical to `IdentityList`'s own, so swapping its local
 * map for this import later changes nothing about what renders.
 *
 * `PASSWORD` has an entry because the enum has a member for it and
 * `IdentityList` names it in the identities table — but nothing sources it as
 * a federated option. `OAuthButtons` only ever iterates the providers a login
 * page was actually handed, and the backend's `OAuthProviderRegistry` never
 * lists `PASSWORD` among them.
 */
export const PROVIDER_LABEL_KEYS: Record<AuthProvider, string> = {
  [AuthProvider.PASSWORD]: 'account.identities.providerPassword',
  [AuthProvider.GOOGLE]: 'account.identities.providerGoogle',
  [AuthProvider.GITHUB]: 'account.identities.providerGithub',
  [AuthProvider.OIDC]: 'account.identities.providerOidc',
};
