import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type {
  InvitationId,
  InvitationJSON,
  InvitationQuery,
  InviteMemberInput,
  MemberQuery,
  MembershipJSON,
  OrganizationId,
  OrganizationJSON,
  OrganizationQuery,
} from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { ApiClient } from '~/types';

/**
 * The `/organizations` endpoints — organizations, their members and their
 * invitations — one function apiece.
 *
 * Each issues a request and returns the parsed body. No mapping and no error
 * handling: both belong to `OrganizationHttpService`, which is the only thing
 * that knows a `409` on `POST .../invitations` means `AlreadyAMemberError`
 * and a `404` on any of these means `OrganizationNotFoundError`.
 *
 * Two fetchers are named with a suffix the interface's own method names do
 * not need — `getOrganizationById`, `deleteOrganizationById` — because
 * `IOrganizationService` already has a `getOrganization` and a
 * `deleteOrganization`. Nothing here would actually collide with those (a
 * class method's own name is not a binding inside its body), but a fetcher
 * and the service method calling it sharing one identifier is confusing to
 * read for no benefit, so the two that would are spelled differently.
 */

/** Creates an organization. The caller becomes its OWNER. */
export async function postOrganization(
  client: ApiClient,
  actor: UserId,
  input: { name: string; slug: string },
): Promise<OrganizationJSON> {
  return client<OrganizationJSON>({
    method: 'POST',
    path: '/organizations',
    body: { name: input.name, slug: input.slug },
    actor,
  });
}

/** One page of the organizations the caller belongs to. */
export async function getOrganizations(
  client: ApiClient,
  actor: UserId,
  query: OrganizationQuery,
): Promise<PaginatedResult<OrganizationJSON>> {
  return client<PaginatedResult<OrganizationJSON>>({
    method: 'GET',
    path: '/organizations',
    actor,
    query: { page: query.page, limit: query.limit },
  });
}

/** One organization the caller belongs to. */
export async function getOrganizationById(
  client: ApiClient,
  actor: UserId,
  organizationId: OrganizationId,
): Promise<OrganizationJSON> {
  return client<OrganizationJSON>({
    method: 'GET',
    path: `/organizations/${String(organizationId)}`,
    actor,
  });
}

/** Changes an organization's name, its slug, or both. */
export async function patchOrganization(
  client: ApiClient,
  actor: UserId,
  organizationId: OrganizationId,
  changes: { name?: string; slug?: string },
): Promise<OrganizationJSON> {
  return client<OrganizationJSON>({
    method: 'PATCH',
    path: `/organizations/${String(organizationId)}`,
    body: changes,
    actor,
  });
}

/** Soft-deletes an organization. */
export async function deleteOrganizationById(
  client: ApiClient,
  actor: UserId,
  organizationId: OrganizationId,
): Promise<void> {
  await client<undefined>({
    method: 'DELETE',
    path: `/organizations/${String(organizationId)}`,
    actor,
  });
}

/** One page of an organization's memberships. */
export async function getMembers(
  client: ApiClient,
  actor: UserId,
  organizationId: OrganizationId,
  query: MemberQuery,
): Promise<PaginatedResult<MembershipJSON>> {
  return client<PaginatedResult<MembershipJSON>>({
    method: 'GET',
    path: `/organizations/${String(organizationId)}/members`,
    actor,
    query: {
      page: query.page,
      limit: query.limit,
      ...(query.role === undefined ? {} : { role: query.role }),
    },
  });
}

/** Gives a member a different role in one organization. */
export async function patchMemberRole(
  client: ApiClient,
  actor: UserId,
  organizationId: OrganizationId,
  targetUserId: UserId,
  role: OrgRole,
): Promise<MembershipJSON> {
  return client<MembershipJSON>({
    method: 'PATCH',
    path: `/organizations/${String(organizationId)}/members/${String(targetUserId)}`,
    body: { role },
    actor,
  });
}

/** Ends somebody's membership of one organization. */
export async function deleteMember(
  client: ApiClient,
  actor: UserId,
  organizationId: OrganizationId,
  targetUserId: UserId,
): Promise<void> {
  await client<undefined>({
    method: 'DELETE',
    path: `/organizations/${String(organizationId)}/members/${String(targetUserId)}`,
    actor,
  });
}

/** Offers somebody a role in an organization, addressed to an email. */
export async function postInvitation(
  client: ApiClient,
  actor: UserId,
  organizationId: OrganizationId,
  input: InviteMemberInput,
): Promise<InvitationJSON> {
  return client<InvitationJSON>({
    method: 'POST',
    path: `/organizations/${String(organizationId)}/invitations`,
    body: { email: input.email, role: input.role },
    actor,
  });
}

/** One page of an organization's invitations. */
export async function getInvitations(
  client: ApiClient,
  actor: UserId,
  organizationId: OrganizationId,
  query: InvitationQuery,
): Promise<PaginatedResult<InvitationJSON>> {
  return client<PaginatedResult<InvitationJSON>>({
    method: 'GET',
    path: `/organizations/${String(organizationId)}/invitations`,
    actor,
    query: {
      page: query.page,
      limit: query.limit,
      ...(query.status === undefined ? {} : { status: query.status }),
    },
  });
}

/**
 * Withdraws an invitation that has not been accepted.
 *
 * Answers with the invitation in its REVOKED state, not `204` — see
 * `InvitationsController.revoke`'s own TSDoc for why the backend does the
 * same: core's own contract returns it.
 */
export async function deleteInvitation(
  client: ApiClient,
  actor: UserId,
  organizationId: OrganizationId,
  invitationId: InvitationId,
): Promise<InvitationJSON> {
  return client<InvitationJSON>({
    method: 'DELETE',
    path: `/organizations/${String(organizationId)}/invitations/${String(invitationId)}`,
    actor,
  });
}

/**
 * Redeems an invitation, creating the membership it offered.
 *
 * Not organization-scoped: the caller presents a token, not an id, and the
 * backend does not need to know — and must not be told — which organization
 * issued it before it has checked whether the token still redeems anything.
 */
export async function postAcceptInvitation(
  client: ApiClient,
  actor: UserId,
  token: string,
): Promise<MembershipJSON> {
  return client<MembershipJSON>({
    method: 'POST',
    path: `/invitations/${token}/accept`,
    actor,
  });
}
