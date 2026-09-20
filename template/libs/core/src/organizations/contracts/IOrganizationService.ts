import type { PaginatedResult } from '../../shared/types/PaginatedResult';
import type { UserId } from '../../users/types/UserId';
import type { Invitation } from '../entities/Invitation';
import type { Membership } from '../entities/Membership';
import type { Organization } from '../entities/Organization';
import type { OrgRole } from '../enums/OrgRole';
import type { CreateOrganizationInput } from '../types/CreateOrganizationInput';
import type { InvitationId } from '../types/InvitationId';
import type { InvitationQuery } from '../types/InvitationQuery';
import type { InviteMemberInput } from '../types/InviteMemberInput';
import type { MemberQuery } from '../types/MemberQuery';
import type { OrganizationId } from '../types/OrganizationId';
import type { OrganizationQuery } from '../types/OrganizationQuery';
import type { UpdateOrganizationInput } from '../types/UpdateOrganizationInput';

/**
 * Organizations, their members, and the invitations that create members.
 *
 * Every method takes `actorId` — the user on whose behalf the call is made —
 * as its first parameter, and every method that acts inside an organization
 * takes the `organizationId` explicitly. Nothing is resolved from ambient
 * state: an implementation that decided for itself who was calling, or which
 * tenant it was in, would be impossible to reason about and impossible to test
 * (ADR-0007).
 *
 * Two rules run through the whole of it, and both are asserted by
 * `runIOrganizationServiceContract`:
 *
 * - **An organization always has at least one OWNER.** The last one can
 *   neither be demoted nor removed — see {@link LastOwnerError}.
 * - **Nothing distinguishes "does not exist" from "not yours."** A caller who
 *   is not a member of an organization gets {@link OrganizationNotFoundError},
 *   the same answer as for an id nobody ever issued, so that trying ids in turn
 *   reveals nothing about which of them exist.
 */
export interface IOrganizationService {
  /**
   * Creates an organization and makes the creator its first and only OWNER.
   *
   * The membership is part of the same act, not a separate call a caller could
   * forget: an organization with no OWNER cannot be administered by anybody,
   * and there is no path back to one from inside the domain.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param input - the name and the slug the organization is to have
   * @returns the new organization
   * @throws OrganizationNameRequiredError when the name is blank
   * @throws InvalidOrganizationSlugError when the slug cannot be used in a path
   */
  createOrganization(actorId: UserId, input: CreateOrganizationInput): Promise<Organization>;

  /**
   * The organizations the actor is a member of. No other organization is
   * visible through it, whatever the actor's standing on the deployment.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param query - which page is wanted
   * @returns one page of the actor's organizations, with the totals a caller needs
   */
  listOrganizations(
    actorId: UserId,
    query: OrganizationQuery,
  ): Promise<PaginatedResult<Organization>>;

  /**
   * One organization the actor is a member of.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization wanted
   * @returns the organization
   * @throws OrganizationNotFoundError when no such organization exists, and
   * when the actor is not a member of it — the two are indistinguishable on
   * purpose.
   */
  getOrganization(actorId: UserId, organizationId: OrganizationId): Promise<Organization>;

  /**
   * Changes an organization's name, its slug, or both.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization to change
   * @param input - the fields to change; an omitted field is left alone
   * @returns the updated organization
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   * @throws OrganizationNameRequiredError when the new name is blank
   * @throws InvalidOrganizationSlugError when the new slug cannot be used in a path
   */
  updateOrganization(
    actorId: UserId,
    organizationId: OrganizationId,
    input: UpdateOrganizationInput,
  ): Promise<Organization>;

  /**
   * Soft-deletes an organization. The record is retained so that history
   * referencing it stays readable; the organization stops being listed and
   * stops being usable.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization to delete
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   */
  deleteOrganization(actorId: UserId, organizationId: OrganizationId): Promise<void>;

  /**
   * The memberships of one organization.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization whose members are wanted
   * @param query - which page is wanted, and an optional role filter
   * @returns one page of memberships, with the totals a caller needs
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   */
  listMembers(
    actorId: UserId,
    organizationId: OrganizationId,
    query: MemberQuery,
  ): Promise<PaginatedResult<Membership>>;

  /**
   * Gives a member a different role in one organization.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization the membership is in
   * @param targetUserId - the member whose role changes
   * @param role - the role the member is to hold
   * @returns the updated membership
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   * @throws MembershipNotFoundError when the target is not a member of it
   * @throws LastOwnerError when the change would leave the organization with no OWNER
   */
  changeMemberRole(
    actorId: UserId,
    organizationId: OrganizationId,
    targetUserId: UserId,
    role: OrgRole,
  ): Promise<Membership>;

  /**
   * Ends somebody's membership of one organization. The account itself is
   * untouched — this is about one tenant, not about the person.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization the membership is in
   * @param targetUserId - the member to remove
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   * @throws MembershipNotFoundError when the target is not a member of it
   * @throws LastOwnerError when the removal would leave the organization with no OWNER
   */
  removeMember(
    actorId: UserId,
    organizationId: OrganizationId,
    targetUserId: UserId,
  ): Promise<void>;

  /**
   * Offers somebody a role in an organization, addressed to an email.
   *
   * The invitation is issued PENDING and carries the role it was asked for.
   * The address need not belong to an existing account: accepting while signed
   * out routes through registration and then consumes the invitation.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization membership is offered in
   * @param input - the address to invite and the role offered
   * @returns the new invitation
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   * @throws AlreadyAMemberError when the address is that of an existing member
   */
  inviteMember(
    actorId: UserId,
    organizationId: OrganizationId,
    input: InviteMemberInput,
  ): Promise<Invitation>;

  /**
   * The invitations of one organization.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization whose invitations are wanted
   * @param query - which page is wanted, and an optional status filter
   * @returns one page of invitations, with the totals a caller needs
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   */
  listInvitations(
    actorId: UserId,
    organizationId: OrganizationId,
    query: InvitationQuery,
  ): Promise<PaginatedResult<Invitation>>;

  /**
   * Withdraws an invitation that has not been accepted.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization the invitation was issued in
   * @param invitationId - the invitation to withdraw
   * @returns the invitation in its REVOKED state
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   * @throws InvitationNotFoundError when no invitation in it answers to the id
   * @throws InvitationNoLongerOpenError when the invitation is already closed
   */
  revokeInvitation(
    actorId: UserId,
    organizationId: OrganizationId,
    invitationId: InvitationId,
  ): Promise<Invitation>;

  /**
   * Redeems an invitation, creating the membership it offered.
   *
   * The membership carries **the role the invitation carried**, not a default.
   *
   * It takes a token rather than an id because the token is the only thing the
   * recipient has. Core models it as an opaque `string` and says nothing about
   * how it is built, matched or delivered: that is an implementation's own
   * affair, and a domain that fixed the format would be deciding it for every
   * implementation (D14).
   *
   * Openness is judged before anything else about the caller, so that a second
   * presentation of a spent token is answered the same way whoever presents it.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param token - the opaque value the recipient was given
   * @returns the new membership
   * @throws InvitationNotFoundError when the token redeems nothing
   * @throws InvitationNoLongerOpenError when the invitation was revoked, has
   * already been accepted, or has expired — the three are indistinguishable on
   * purpose.
   * @throws InvitationAddressMismatchError when the account redeeming it does
   * not hold the address it was sent to
   */
  acceptInvitation(actorId: UserId, token: string): Promise<Membership>;
}
