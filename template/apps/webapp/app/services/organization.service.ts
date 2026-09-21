import type { IOrganizationService } from '__FORGE_SCOPE__/core/organizations/contracts';
import { Invitation, Membership, Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import type { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import {
  AlreadyAMemberError,
  InvalidOrganizationSlugError,
  InvitationAddressMismatchError,
  InvitationNoLongerOpenError,
  InvitationNotFoundError,
  LastOwnerError,
  MembershipNotFoundError,
  OrganizationNameRequiredError,
  OrganizationNotFoundError,
} from '__FORGE_SCOPE__/core/organizations/errors';
import type {
  CreateOrganizationInput,
  InvitationId,
  InvitationQuery,
  InviteMemberInput,
  MemberQuery,
  OrganizationId,
  OrganizationQuery,
  UpdateOrganizationInput,
} from '__FORGE_SCOPE__/core/organizations/types';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import {
  ApiError,
  deleteInvitation,
  deleteMember,
  deleteOrganizationById,
  getInvitations,
  getMembers,
  getOrganizationById,
  getOrganizations,
  patchMemberRole,
  patchOrganization,
  postAcceptInvitation,
  postInvitation,
  postOrganization,
} from '~/fetchers';
import type { ApiClient } from '~/types';

/**
 * What a call site knows about the thing it asked about, for the error's own
 * message when the wire's `code` says which core error this refusal is.
 *
 * A single `subject: string` — `UserHttpService`'s own shape — does not fit
 * here: `AlreadyAMemberError` names two things (the organization and the
 * user), and different calls on this service know different subsets of
 * `organizationId` / `userId` / `invitationId` / `slug`. A field absent from
 * a particular refusal is simply never read; every constructor below is given
 * exactly the ones its error names.
 */
interface ErrorContext {
  organizationId?: string;
  userId?: string;
  invitationId?: string;
  slug?: string;
}

/**
 * The error the contract names for a refusal that arrived as an envelope.
 *
 * It reads the backend's `code` **first**, for the reason `user.service.ts`'s
 * own `domainErrorFor` gives at length: a status alone is ambiguous, and here
 * `404` is reached by three different core errors (`OrganizationNotFoundError`,
 * `MembershipNotFoundError`, `InvitationNotFoundError`).
 *
 * It falls back to the status for `404` alone, and for the same reason that
 * file's fallback exists: `PermissionsGuard` answers a non-member — or a
 * route it cannot resolve an organization from at all — with a bare `404`
 * carrying no domain code, in the same status and the same body
 * `OrganizationNotFoundError` produces, precisely so that "you may not" and
 * "there is no such thing" cannot be told apart. Every route this service
 * calls through except `createOrganization`, `listOrganizations` and
 * `acceptInvitation` sits behind that guard, so the fallback is given the
 * `organizationId` every one of those calls names.
 *
 * @param error - whatever the fetcher threw
 * @param context - what this call site knows about its own subject
 * @returns the error to throw
 */
function domainErrorFor(error: unknown, context: ErrorContext = {}): unknown {
  if (!(error instanceof ApiError)) return error;
  const organizationId = context.organizationId ?? '';
  const userId = context.userId ?? '';
  const invitationId = context.invitationId ?? '';
  const slug = context.slug ?? '';

  switch (error.body.code) {
    case 'ORGANIZATION_NOT_FOUND':
      return new OrganizationNotFoundError(organizationId);
    case 'MEMBERSHIP_NOT_FOUND':
      return new MembershipNotFoundError(userId);
    case 'INVITATION_NOT_FOUND':
      return new InvitationNotFoundError(invitationId);
    case 'INVITATION_NO_LONGER_OPEN':
      return new InvitationNoLongerOpenError(invitationId);
    case 'INVITATION_ADDRESS_MISMATCH':
      return new InvitationAddressMismatchError(invitationId);
    case 'ORGANIZATION_NAME_REQUIRED':
      return new OrganizationNameRequiredError();
    case 'INVALID_ORGANIZATION_SLUG':
      return new InvalidOrganizationSlugError(slug);
    case 'LAST_OWNER':
      return new LastOwnerError();
    case 'ALREADY_A_MEMBER':
      // `userId` here is whatever the call site could name at the point of
      // asking — `inviteMember` only ever knows the address it invited, never
      // the existing member's id a `409` confirms belongs to somebody. That is
      // less than `AlreadyAMemberError`'s constructor documents, and reported
      // as such rather than invented.
      return new AlreadyAMemberError(organizationId, userId);
    default:
      return error.status === 404 ? new OrganizationNotFoundError(organizationId) : error;
  }
}

/**
 * Implements the core contract over the wire.
 *
 * Two responsibilities, and no others: turn a response into the entity the
 * contract promises, and turn a failure into the error the contract names —
 * `UserHttpService`'s own shape, restated here for this contract.
 *
 * **`Organization.fromJSON`, `Membership.fromJSON` and `Invitation.fromJSON`
 * on every path, never a cast.** Each reviver re-runs its entity's
 * invariants — `Organization` re-validates the slug, `Invitation`
 * re-normalizes the address — so a payload the domain would not accept fails
 * here rather than travelling onward as an object that merely has the right
 * keys. A service that handed back `json as unknown as Organization` would
 * satisfy every type in this file and fail the conformance suite's
 * `instanceof` checks, which is precisely why those checks are in it.
 */
export class OrganizationHttpService implements IOrganizationService {
  private readonly client: ApiClient;

  /** @param client - the transport the fetchers issue through */
  public constructor(client: ApiClient) {
    this.client = client;
  }

  /** @inheritdoc */
  public async createOrganization(
    actorId: UserId,
    input: CreateOrganizationInput,
  ): Promise<Organization> {
    try {
      return Organization.fromJSON(await postOrganization(this.client, actorId, input));
    } catch (error) {
      throw domainErrorFor(error, { slug: input.slug });
    }
  }

  /** @inheritdoc */
  public async listOrganizations(
    actorId: UserId,
    query: OrganizationQuery,
  ): Promise<PaginatedResult<Organization>> {
    try {
      const page = await getOrganizations(this.client, actorId, query);
      return { data: page.data.map((json) => Organization.fromJSON(json)), meta: page.meta };
    } catch (error) {
      throw domainErrorFor(error);
    }
  }

  /** @inheritdoc */
  public async getOrganization(
    actorId: UserId,
    organizationId: OrganizationId,
  ): Promise<Organization> {
    try {
      return Organization.fromJSON(await getOrganizationById(this.client, actorId, organizationId));
    } catch (error) {
      throw domainErrorFor(error, { organizationId: String(organizationId) });
    }
  }

  /** @inheritdoc */
  public async updateOrganization(
    actorId: UserId,
    organizationId: OrganizationId,
    input: UpdateOrganizationInput,
  ): Promise<Organization> {
    try {
      return Organization.fromJSON(await patchOrganization(this.client, actorId, organizationId, {
        // Field by field, as `UserHttpService.updateProfile` does: the wire's
        // shape and core's are separate things, and the day they differ the
        // compiler must say so here.
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.slug === undefined ? {} : { slug: input.slug }),
      }));
    } catch (error) {
      throw domainErrorFor(error, { organizationId: String(organizationId), slug: input.slug });
    }
  }

  /** @inheritdoc */
  public async deleteOrganization(actorId: UserId, organizationId: OrganizationId): Promise<void> {
    try {
      await deleteOrganizationById(this.client, actorId, organizationId);
    } catch (error) {
      throw domainErrorFor(error, { organizationId: String(organizationId) });
    }
  }

  /** @inheritdoc */
  public async listMembers(
    actorId: UserId,
    organizationId: OrganizationId,
    query: MemberQuery,
  ): Promise<PaginatedResult<Membership>> {
    try {
      const page = await getMembers(this.client, actorId, organizationId, query);
      return { data: page.data.map((json) => Membership.fromJSON(json)), meta: page.meta };
    } catch (error) {
      throw domainErrorFor(error, { organizationId: String(organizationId) });
    }
  }

  /** @inheritdoc */
  public async changeMemberRole(
    actorId: UserId,
    organizationId: OrganizationId,
    targetUserId: UserId,
    role: OrgRole,
  ): Promise<Membership> {
    try {
      return Membership.fromJSON(
        await patchMemberRole(this.client, actorId, organizationId, targetUserId, role),
      );
    } catch (error) {
      throw domainErrorFor(error, {
        organizationId: String(organizationId),
        userId: String(targetUserId),
      });
    }
  }

  /** @inheritdoc */
  public async removeMember(
    actorId: UserId,
    organizationId: OrganizationId,
    targetUserId: UserId,
  ): Promise<void> {
    try {
      await deleteMember(this.client, actorId, organizationId, targetUserId);
    } catch (error) {
      throw domainErrorFor(error, {
        organizationId: String(organizationId),
        userId: String(targetUserId),
      });
    }
  }

  /** @inheritdoc */
  public async inviteMember(
    actorId: UserId,
    organizationId: OrganizationId,
    input: InviteMemberInput,
  ): Promise<Invitation> {
    try {
      return Invitation.fromJSON(await postInvitation(this.client, actorId, organizationId, input));
    } catch (error) {
      throw domainErrorFor(error, { organizationId: String(organizationId), userId: input.email });
    }
  }

  /** @inheritdoc */
  public async listInvitations(
    actorId: UserId,
    organizationId: OrganizationId,
    query: InvitationQuery,
  ): Promise<PaginatedResult<Invitation>> {
    try {
      const page = await getInvitations(this.client, actorId, organizationId, query);
      return { data: page.data.map((json) => Invitation.fromJSON(json)), meta: page.meta };
    } catch (error) {
      throw domainErrorFor(error, { organizationId: String(organizationId) });
    }
  }

  /** @inheritdoc */
  public async revokeInvitation(
    actorId: UserId,
    organizationId: OrganizationId,
    invitationId: InvitationId,
  ): Promise<Invitation> {
    try {
      return Invitation.fromJSON(
        await deleteInvitation(this.client, actorId, organizationId, invitationId),
      );
    } catch (error) {
      throw domainErrorFor(error, {
        organizationId: String(organizationId),
        invitationId: String(invitationId),
      });
    }
  }

  /** @inheritdoc */
  public async acceptInvitation(actorId: UserId, token: string): Promise<Membership> {
    try {
      return Membership.fromJSON(await postAcceptInvitation(this.client, actorId, token));
    } catch (error) {
      throw domainErrorFor(error);
    }
  }
}
