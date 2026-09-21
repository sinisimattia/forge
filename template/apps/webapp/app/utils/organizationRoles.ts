import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';

/**
 * One translation key per `OrgRole`, read by `MemberList`, `InvitationList`
 * and the invitations screen's own invite form — the one label a role needs
 * wherever it is shown or picked.
 *
 * A `Record` over core's enum, the same shape `IdentityList`'s own
 * `PROVIDER_LABEL_KEYS` follows: a role added to `OrgRole` is a compile
 * error here rather than a row labelled with a raw enum value. Kept in one
 * place rather than copied into each caller, because three copies is exactly
 * the number that stopped being "obviously the same" the day the third one
 * was about to be written.
 *
 * **Not the `Permission` list this project was told not to build.** `OrgRole`
 * is a four-member, ADR-endorsed axis a person is invited into or holds —
 * distinct from `Permission`, which nothing in this application enumerates
 * (`useGrants`' own TSDoc). Naming a role in a dropdown asks nothing about
 * what a role may do; that question stays `can()`'s alone.
 */
export const ORG_ROLE_LABEL_KEYS: Record<OrgRole, string> = {
  [OrgRole.OWNER]: 'organizations.roles.owner',
  [OrgRole.ADMIN]: 'organizations.roles.admin',
  [OrgRole.MEMBER]: 'organizations.roles.member',
  [OrgRole.VIEWER]: 'organizations.roles.viewer',
};
