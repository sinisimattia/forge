import type { IOrganizationService } from '__FORGE_SCOPE__/core/organizations/contracts';
import {
  Invitation,
  Membership,
  Organization,
} from '__FORGE_SCOPE__/core/organizations/entities';
import { InvitationStatus, OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import {
  AlreadyAMemberError,
  InvitationAddressMismatchError,
  InvitationNoLongerOpenError,
  InvitationNotFoundError,
  LastOwnerError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
} from '__FORGE_SCOPE__/core/organizations/errors';
import type {
  CreateOrganizationInput,
  InvitationId,
  InvitationJSON,
  InvitationQuery,
  InviteMemberInput,
  MemberQuery,
  MembershipId,
  MembershipJSON,
  OrganizationId,
  OrganizationJSON,
  OrganizationQuery,
  UpdateOrganizationInput,
} from '__FORGE_SCOPE__/core/organizations/types';
import { normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';

const A_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * A reference implementation over Maps of wire rows.
 *
 * It stores rows rather than entities on purpose: that is the shape a real
 * implementation has to map back into an entity on every read, so the suite is
 * driven through the same rehydration a real one performs.
 *
 * Writing it is also the cheapest possible proof that the contract is
 * implementable at all, which is the reason it exists rather than a stub that
 * resolves everything — and it is what lets the four assertions that could most
 * easily have been written unfailable be watched failing, by breaking this in
 * the one way each of them exists to catch.
 *
 * It enforces no authorization whatever: any member may do anything inside an
 * organization they belong to. That is not an omission the suite papers over —
 * the suite asserts behavior only, and who is permitted to invoke what is held
 * to its own suite beside each real implementation.
 */
export class InMemoryOrganizationService implements IOrganizationService {
  private readonly users = new Map<string, UserJSON>();
  private readonly organizations = new Map<string, OrganizationJSON>();
  private readonly memberships = new Map<string, MembershipJSON>();
  private readonly invitations = new Map<string, InvitationJSON>();
  /** The opaque value a recipient presents, against the invitation it redeems. */
  private readonly tokens = new Map<string, InvitationId>();
  private issued = 0;

  /** Puts an account into the world. */
  seedUser(row: UserJSON): void {
    this.users.set(row.id, row);
  }

  /** Puts an organization row into the world exactly as given. */
  seedOrganization(row: OrganizationJSON): void {
    this.organizations.set(row.id, row);
  }

  /** Puts a membership row into the world exactly as given. */
  seedMembership(row: MembershipJSON): void {
    this.memberships.set(row.id, row);
  }

  /** The value a recipient would present for an invitation this service issued. */
  tokenFor(invitationId: InvitationId): string {
    const found = [...this.tokens.entries()].filter(([, id]) => id === invitationId)[0];
    if (found === undefined) throw new Error(`no token for invitation ${invitationId}`);
    return found[0];
  }

  async createOrganization(
    actorId: UserId,
    input: CreateOrganizationInput,
  ): Promise<Organization> {
    const now = new Date().toISOString();
    const organization = Organization.fromJSON({
      id: this.nextId('org') as OrganizationId,
      name: input.name,
      slug: input.slug,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    this.seedOrganization(organization.toJSON());
    // The membership is part of the same act: an organization with no OWNER can
    // be administered by nobody.
    this.addMembership(organization.id, actorId, OrgRole.OWNER);
    return organization;
  }

  async listOrganizations(
    actorId: UserId,
    query: OrganizationQuery,
  ): Promise<PaginatedResult<Organization>> {
    const mine = this.membershipRowsOf(actorId)
      .map((row) => this.organizations.get(row.organizationId))
      .filter((row): row is OrganizationJSON => row !== undefined && row.deletedAt === null)
      .map((row) => Organization.fromJSON(row));
    return page(mine, query.page, query.limit);
  }

  async getOrganization(
    actorId: UserId,
    organizationId: OrganizationId,
  ): Promise<Organization> {
    return Organization.fromJSON(this.visibleRow(actorId, organizationId));
  }

  async updateOrganization(
    actorId: UserId,
    organizationId: OrganizationId,
    input: UpdateOrganizationInput,
  ): Promise<Organization> {
    const row = this.visibleRow(actorId, organizationId);
    // Rebuilt through the entity, which re-runs every invariant, before it is
    // stored back — an omitted field is left alone.
    const updated = Organization.fromJSON({
      ...row,
      name: input.name ?? row.name,
      slug: input.slug ?? row.slug,
      updatedAt: new Date().toISOString(),
    });
    this.seedOrganization(updated.toJSON());
    return updated;
  }

  async deleteOrganization(actorId: UserId, organizationId: OrganizationId): Promise<void> {
    const row = this.visibleRow(actorId, organizationId);
    this.seedOrganization({ ...row, deletedAt: new Date().toISOString() });
  }

  async listMembers(
    actorId: UserId,
    organizationId: OrganizationId,
    query: MemberQuery,
  ): Promise<PaginatedResult<Membership>> {
    this.visibleRow(actorId, organizationId);
    const matching = this.membershipRowsIn(organizationId)
      .filter((row) => query.role === undefined || row.role === query.role)
      .map((row) => Membership.fromJSON(row));
    return page(matching, query.page, query.limit);
  }

  async changeMemberRole(
    actorId: UserId,
    organizationId: OrganizationId,
    targetUserId: UserId,
    role: OrgRole,
  ): Promise<Membership> {
    this.visibleRow(actorId, organizationId);
    const row = this.membershipRow(organizationId, targetUserId);
    if (role !== OrgRole.OWNER) this.refuseIfLastOwner(row);

    const updated = Membership.fromJSON({ ...row, role, updatedAt: new Date().toISOString() });
    this.seedMembership(updated.toJSON());
    return updated;
  }

  async removeMember(
    actorId: UserId,
    organizationId: OrganizationId,
    targetUserId: UserId,
  ): Promise<void> {
    this.visibleRow(actorId, organizationId);
    const row = this.membershipRow(organizationId, targetUserId);
    this.refuseIfLastOwner(row);
    this.memberships.delete(row.id);
  }

  async inviteMember(
    actorId: UserId,
    organizationId: OrganizationId,
    input: InviteMemberInput,
  ): Promise<Invitation> {
    // `invitedByUserId` is `UserId | null` on the type, but `actorId` here is
    // always a real, present id: `null` is what a later read may answer once
    // the inviter's account has been deleted, which this reference store has
    // no operation that models — nothing here ever nulls out an existing
    // invitation's inviter.
    this.visibleRow(actorId, organizationId);
    const email = normalizeEmail(input.email);
    const existing = this.memberHolding(organizationId, email);
    if (existing !== undefined) throw new AlreadyAMemberError(organizationId, existing);

    const now = Date.now();
    const invitation = Invitation.fromJSON({
      id: this.nextId('invitation') as InvitationId,
      organizationId,
      email: input.email,
      role: input.role,
      status: InvitationStatus.PENDING,
      invitedByUserId: actorId,
      expiresAt: new Date(now + A_WEEK).toISOString(),
      createdAt: new Date(now).toISOString(),
      acceptedAt: null,
      acceptedByUserId: null,
    });
    this.invitations.set(invitation.id, invitation.toJSON());
    this.tokens.set(this.nextId('token'), invitation.id);
    return invitation;
  }

  async listInvitations(
    actorId: UserId,
    organizationId: OrganizationId,
    query: InvitationQuery,
  ): Promise<PaginatedResult<Invitation>> {
    this.visibleRow(actorId, organizationId);
    const matching = [...this.invitations.values()]
      .filter((row) => row.organizationId === organizationId)
      .filter((row) => query.status === undefined || row.status === query.status)
      .map((row) => Invitation.fromJSON(row));
    return page(matching, query.page, query.limit);
  }

  async revokeInvitation(
    actorId: UserId,
    organizationId: OrganizationId,
    invitationId: InvitationId,
  ): Promise<Invitation> {
    this.visibleRow(actorId, organizationId);
    const row = this.invitations.get(invitationId);
    if (row === undefined || row.organizationId !== organizationId) {
      throw new InvitationNotFoundError(invitationId);
    }
    if (!Invitation.fromJSON(row).isOpenAt(new Date())) {
      throw new InvitationNoLongerOpenError(invitationId);
    }

    const revoked = Invitation.fromJSON({ ...row, status: InvitationStatus.REVOKED });
    this.invitations.set(revoked.id, revoked.toJSON());
    return revoked;
  }

  async acceptInvitation(actorId: UserId, token: string): Promise<Membership> {
    const invitationId = this.tokens.get(token);
    const row = invitationId === undefined ? undefined : this.invitations.get(invitationId);
    // The presented value is deliberately not echoed back: it is the one secret
    // the recipient holds, and an error message is the easiest place to leak it.
    if (row === undefined) throw new InvitationNotFoundError('unknown');

    // Openness before anything about the caller, so that a second presentation
    // of a spent token is answered the same way whoever presents it.
    const invitation = Invitation.fromJSON(row);
    if (!invitation.isOpenAt(new Date())) throw new InvitationNoLongerOpenError(invitation.id);
    if (normalizeEmail(this.userRow(actorId).email) !== invitation.email) {
      throw new InvitationAddressMismatchError(invitation.id);
    }

    const membership = this.addMembership(
      invitation.organizationId,
      actorId,
      // From the invitation, never a default.
      invitation.role,
    );
    this.invitations.set(invitation.id, {
      ...row,
      status: InvitationStatus.ACCEPTED,
      acceptedAt: new Date().toISOString(),
      acceptedByUserId: actorId,
    });
    return membership;
  }

  private addMembership(
    organizationId: OrganizationId,
    userId: UserId,
    role: OrgRole,
  ): Membership {
    const now = new Date().toISOString();
    const membership = Membership.fromJSON({
      id: this.nextId('membership') as MembershipId,
      organizationId,
      userId,
      role,
      createdAt: now,
      updatedAt: now,
    });
    this.seedMembership(membership.toJSON());
    return membership;
  }

  /** The organization as this actor may see it — a non-member is told nothing. */
  private visibleRow(actorId: UserId, organizationId: OrganizationId): OrganizationJSON {
    const row = this.organizations.get(organizationId);
    const belongs = this.membershipRowsIn(organizationId)
      .filter((membership) => membership.userId === actorId).length > 0;
    if (row === undefined || row.deletedAt !== null || !belongs) {
      throw new OrganizationNotFoundError(organizationId);
    }
    return row;
  }

  private membershipRow(organizationId: OrganizationId, userId: UserId): MembershipJSON {
    const row = this.membershipRowsIn(organizationId)
      .filter((membership) => membership.userId === userId)[0];
    if (row === undefined) throw new MembershipNotFoundError(userId);
    return row;
  }

  private membershipRowsIn(organizationId: OrganizationId): MembershipJSON[] {
    return [...this.memberships.values()]
      .filter((row) => row.organizationId === organizationId);
  }

  private membershipRowsOf(userId: UserId): MembershipJSON[] {
    return [...this.memberships.values()].filter((row) => row.userId === userId);
  }

  /** The member of this organization whose account holds `email`, if there is one. */
  private memberHolding(organizationId: OrganizationId, email: string): UserId | undefined {
    return this.membershipRowsIn(organizationId)
      .filter((row) => normalizeEmail(this.userRow(row.userId).email) === email)
      .map((row) => row.userId)[0];
  }

  private refuseIfLastOwner(row: MembershipJSON): void {
    if (row.role !== OrgRole.OWNER) return;
    const owners = this.membershipRowsIn(row.organizationId)
      .filter((other) => other.role === OrgRole.OWNER);
    if (owners.length === 1) throw new LastOwnerError();
  }

  private userRow(id: UserId): UserJSON {
    const row = this.users.get(id);
    if (row === undefined) throw new Error(`no user ${id}`);
    return row;
  }

  private nextId(prefix: string): string {
    this.issued += 1;
    return `${prefix}-${this.issued}`;
  }
}

/** One page of an already-filtered list, with the totals a caller needs. */
function page<T>(all: T[], pageNumber: number, limit: number): PaginatedResult<T> {
  const start = (pageNumber - 1) * limit;
  return {
    data: all.slice(start, start + limit),
    meta: {
      total: all.length,
      page: pageNumber,
      limit,
      totalPages: Math.ceil(all.length / limit),
    },
  };
}
