import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { InvitationId, OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { CurrentUser } from '../auth/decorators';
import { PermissionsGuard, RequirePermission } from '../authorization';
import type { AuthenticatedActor } from '../auth/strategies';
import { ParseUuidParamPipe } from '../common/pipes';
import type { PaginatedResponse } from '../common/types';
import {
  InviteMemberDto,
  ListInvitationsQueryDto,
  type InvitationResponseDto,
  type MemberResponseDto,
} from './dto';
import { OrganizationsService } from './organizations.service';

/**
 * Invitations: issuing, listing, revoking, and redeeming.
 *
 * A separate controller from `OrganizationsController` and `MembersController`
 * for the same reason those two are separate from each other, but this one
 * cannot take either's shape: `@Controller(<one prefix>)` assumes every route
 * on the class shares a root, and three of these four do not share one with
 * the fourth. `POST /organizations/:id/invitations`, `GET
 * /organizations/:id/invitations` and `DELETE
 * /organizations/:id/invitations/:invitationId` all live under one
 * organization; `POST /invitations/:token/accept` does not, because the
 * caller presenting a token does not know — and must not need to know — which
 * organization issued it, only the address it was sent to. So this class
 * carries `@Controller()` with no prefix and gives each method its own full
 * path, rather than forcing a shared root onto a route that has none.
 *
 * **`POST /invitations/:token/accept` is not `@Public()`.** Spec §9.4:
 * accepting while signed out routes through registration first and returns
 * the visitor here with a session, so this endpoint always has an actor —
 * which is what makes `Invitation.acceptedByUserId` a fact this backend
 * established rather than a value some other layer had to guess at.
 *
 * **The three organization-scoped routes carry `@UseGuards(PermissionsGuard)`;
 * `POST /invitations/:token/accept` does not, and must not.** It is authorized
 * by holding the token — a 32-byte CSPRNG credential from
 * `generateOpaqueToken` — and by the address it was sent to matching the
 * caller's own, which `OrganizationsService.acceptInvitation` checks. It could
 * not be guarded here in any case: the caller is by definition not yet a member
 * of the organization, so `can` would refuse every redemption, and the route
 * names no `:id` for the guard to resolve one from. That is the shape of a
 * route the guard is right to leave alone, not a gap in it.
 */
@Controller()
export class InvitationsController {
  public constructor(private readonly organizations: OrganizationsService) {}

  /** Offers somebody a role in an organization, addressed to an email. */
  @Post('organizations/:id/invitations')
  @UseGuards(PermissionsGuard)
  @RequirePermission('member:invite')
  public async invite(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) organizationId: string,
    @Body() body: InviteMemberDto,
  ): Promise<InvitationResponseDto> {
    const invitation = await this.organizations.inviteMember(
      actor.userId,
      organizationId as OrganizationId,
      { email: body.email, role: body.role },
    );
    return invitation.toJSON();
  }

  /** One page of an organization's invitations. */
  @Get('organizations/:id/invitations')
  @UseGuards(PermissionsGuard)
  @RequirePermission('invitation:read')
  public async list(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) organizationId: string,
    @Query() query: ListInvitationsQueryDto,
  ): Promise<PaginatedResponse<InvitationResponseDto>> {
    const page = await this.organizations.listInvitations(
      actor.userId,
      organizationId as OrganizationId,
      { page: query.page, limit: query.limit, status: query.status },
    );
    return { data: page.data.map((invitation) => invitation.toJSON()), meta: page.meta };
  }

  /**
   * Withdraws an invitation that has not been accepted.
   *
   * Answers with the invitation in its REVOKED state — not `204` — because
   * core's own contract (`IOrganizationService.revokeInvitation`) returns it,
   * and an organization managing its invitations wants to see the state it
   * just put the invitation into without a second request.
   */
  @Delete('organizations/:id/invitations/:invitationId')
  @UseGuards(PermissionsGuard)
  @RequirePermission('invitation:revoke')
  public async revoke(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) organizationId: string,
    @Param('invitationId', ParseUuidParamPipe) invitationId: string,
  ): Promise<InvitationResponseDto> {
    const invitation = await this.organizations.revokeInvitation(
      actor.userId,
      organizationId as OrganizationId,
      invitationId as InvitationId,
    );
    return invitation.toJSON();
  }

  /**
   * Redeems an invitation, creating the membership it offered.
   *
   * `token` is read as a plain path parameter, never through
   * `ParseUuidParamPipe`: it is a base64url credential from
   * `generateOpaqueToken`, not a UUID, and a pipe that rejected a
   * well-formed token for not looking like an id would be refusing the one
   * shape this parameter actually takes.
   *
   * `actor.userId` — never a value taken from a request body — is the
   * account whose address `OrganizationsService.acceptInvitation` checks
   * against the one the invitation was sent to.
   */
  @Post('invitations/:token/accept')
  public async accept(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('token') token: string,
  ): Promise<MemberResponseDto> {
    const membership = await this.organizations.acceptInvitation(actor.userId, token);
    return membership.toJSON();
  }
}
