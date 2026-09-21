import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { IOrganizationService } from '__FORGE_SCOPE__/core/organizations/contracts';
import { Invitation, Membership, Organization } from '__FORGE_SCOPE__/core/organizations/entities';
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
  InvitationQuery,
  InviteMemberInput,
  MemberQuery,
  OrganizationId,
  OrganizationQuery,
  UpdateOrganizationInput,
} from '__FORGE_SCOPE__/core/organizations/types';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditService } from '../audit/audit.service';
import { generateOpaqueToken, hashOpaqueToken } from '../common/crypto';
import { MAILER, buildOrganizationInvitationMessage, type IMailer } from '../mail';
import { UserRecord } from '../users/user-record.entity';
import { InvitationRecord } from './invitation-record.entity';
import { MembershipRecord } from './membership-record.entity';
import { OrganizationRecord } from './organization-record.entity';
import { toInvitationEntity } from './to-invitation';
import { toMembershipEntity } from './to-membership';
import { toOrganizationEntity } from './to-organization';

/**
 * How long an invitation stands, in seconds, before it lapses whether or not
 * anybody acts on it. A week — long enough for somebody to notice a mail
 * that landed while they were away, short enough that an offer nobody has
 * touched in that time is more likely stale than merely unread.
 */
export const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * The placeholder identifier `acceptInvitation` reports when no invitation
 * answers to the presented token. See `RefreshTokenService`'s own `NO_SESSION`
 * for why: the real value is a live credential right up until this call
 * decided it was not, and this error's message is written to logs.
 */
const NO_INVITATION = '(none)';

/**
 * The organization half of {@link IOrganizationService}, over the
 * `organizations`, `memberships` and `organization_invitations` tables.
 *
 * Every entitlement question this service can ask so far is "is the actor a
 * member of this organization at all", answered by a row in `memberships` —
 * layer two of `can()` (role-scoped actions inside an organization the actor
 * already belongs to) is not reached by any method here; it is answered
 * outside this service, by `PermissionsGuard`.
 */
@Injectable()
export class OrganizationsService implements IOrganizationService {
  private readonly webappUrl: string;

  public constructor(
    @InjectRepository(OrganizationRecord)
    private readonly organizations: Repository<OrganizationRecord>,
    @InjectRepository(MembershipRecord)
    private readonly memberships: Repository<MembershipRecord>,
    @InjectRepository(InvitationRecord)
    private readonly invitations: Repository<InvitationRecord>,
    @InjectRepository(UserRecord)
    private readonly users: Repository<UserRecord>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @Inject(MAILER) private readonly mailer: IMailer,
    config: ConfigService,
  ) {
    // Read once, at construction, with no default — the same discipline
    // `AuthService` follows and for the same reason: a deployment that has not
    // configured this origin fails to boot, loudly, rather than mailing its
    // first invitation a link to nowhere.
    this.webappUrl = config.getOrThrow<string>('PUBLIC_WEBAPP_URL');
  }

  /**
   * Creates an organization and makes the creator its first and only OWNER.
   *
   * The organization row, the OWNER membership, and the audit entry are
   * written in ONE transaction. Two statements that can half-succeed — insert
   * the organization, then insert the membership — would leave an
   * organization with no OWNER reachable by nothing more than a crash between
   * them, and that is a state nothing else in this domain can repair: the
   * last-owner invariant makes it unreachable by every other path, which is
   * exactly why there must be no path to it here either. The audit entry rides
   * in the same transaction via `recordIn` rather than `record`, for the
   * reason `AuditService.recordIn` states on itself: an entry that survives a
   * rollback is a permanent record, in a table nothing can correct, of an
   * organization that turned out never to exist.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param input - the name and the slug the organization is to have
   * @returns the new organization
   * @throws OrganizationNameRequiredError when the name is blank
   * @throws InvalidOrganizationSlugError when the slug cannot be used in a path
   */
  public async createOrganization(
    actorId: UserId,
    input: CreateOrganizationInput,
  ): Promise<Organization> {
    const now = new Date();

    // Validated before anything is written: constructing the domain entity
    // runs every invariant `Organization` enforces, so a blank name or an
    // unusable slug touches no row. The id is a throwaway, discarded the
    // moment validation passes — the entity this method actually returns
    // carries the id the insert below assigns.
    const validated = new Organization({
      id: 'validation-only' as OrganizationId,
      name: input.name,
      slug: input.slug,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    const organizationId = await this.dataSource.transaction(async (manager) => {
      const inserted = await manager.insert(OrganizationRecord, {
        name: validated.name,
        slug: validated.slug,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      const id = inserted.identifiers[0].id as string;

      await manager.insert(MembershipRecord, {
        organizationId: id,
        userId: actorId,
        role: OrgRole.OWNER,
        createdAt: now,
        updatedAt: now,
      });

      await this.audit.recordIn(manager, {
        organizationId: id as OrganizationId,
        actorId,
        action: AuditAction.ORGANIZATION_CREATED,
        resourceType: 'organization',
        resourceId: id,
        metadata: { name: validated.name, slug: validated.slug },
        clientAddress: null,
        clientLabel: null,
        occurredAt: now,
      });

      return id;
    });

    return new Organization({
      id: organizationId as OrganizationId,
      name: validated.name,
      slug: validated.slug,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  /**
   * The organizations the actor is a member of. No other organization is
   * visible through it, whatever else is true of the actor.
   *
   * **Reads through `memberships`, scoped to `actorId`, and `organizations` is
   * only ever read narrowed to the ids that query names.** That is the whole
   * of tenant isolation on this endpoint: an implementation that dropped the
   * membership lookup and read `organizations` on its own — even with the
   * same paging and the same `ORDER BY` — would hand every caller every
   * tenant's organizations, and every test that only checks a member seeing
   * their own would still pass. D9's fault injection targets exactly this
   * shape of fault.
   *
   * This is two queries rather than one SQL `JOIN`, because the fake store
   * this backend's unit tests run against (`common/testing/fake-data-source.ts`,
   * a hand-rolled double with no query builder — see ADR-0002 on zero
   * dependencies) cannot execute one. The property that matters does
   * not depend on which shape the read takes: `organizations` is still gated
   * on a query that names the actor and nothing else, on every path through
   * this method.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param query - which page is wanted
   * @returns one page of the actor's organizations, with the totals a caller needs
   */
  public async listOrganizations(
    actorId: UserId,
    query: OrganizationQuery,
  ): Promise<PaginatedResult<Organization>> {
    const page = Math.max(1, Math.trunc(query.page));
    const limit = Math.max(1, Math.trunc(query.limit));

    const memberOf = await this.memberships.find({ where: { userId: actorId } });
    const organizationIds = memberOf.map((membership) => membership.organizationId);

    // `IN ()` is not a query the database accepts, and belonging to nothing
    // is not an error — it is the ordinary answer for somebody who has joined
    // no organization. Short-circuiting here also means `organizations` is
    // never read at all for such an actor, rather than read with a filter
    // that happens to match zero rows.
    if (organizationIds.length === 0) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }

    const [rows, total] = await this.organizations.findAndCount({
      where: { id: In(organizationIds), deletedAt: IsNull() },
      // A total order, for the reason `UsersService.listUsers` gives: two
      // organizations created in the same millisecond would otherwise return
      // a different page 2 every time.
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: rows.map((row) => toOrganizationEntity(row)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

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
  public async getOrganization(
    actorId: UserId,
    organizationId: OrganizationId,
  ): Promise<Organization> {
    return toOrganizationEntity(await this.requireMember(actorId, organizationId));
  }

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
  public async updateOrganization(
    actorId: UserId,
    organizationId: OrganizationId,
    input: UpdateOrganizationInput,
  ): Promise<Organization> {
    const row = await this.requireMember(actorId, organizationId);
    const now = new Date();

    // Validated as a whole, before anything is written — the same discipline
    // `createOrganization` follows. An update can make a previously-valid
    // organization invalid (a blank name, an unusable slug) exactly as easily
    // as a create can produce one, and this is what refuses it before the row
    // changes.
    const validated = new Organization({
      id: row.id as OrganizationId,
      name: input.name === undefined ? row.name : input.name,
      slug: input.slug === undefined ? row.slug : input.slug,
      createdAt: row.createdAt,
      updatedAt: now,
      deletedAt: row.deletedAt,
    });

    await this.organizations.update(
      { id: organizationId },
      { name: validated.name, slug: validated.slug, updatedAt: now },
    );

    // The fields that changed, never their values — the same convention
    // `UsersService.updateProfile` follows for `PROFILE_UPDATED`.
    const changed = Object.keys(input).filter(
      (field) => input[field as keyof UpdateOrganizationInput] !== undefined,
    );
    await this.audit.record({
      organizationId,
      actorId,
      action: AuditAction.ORGANIZATION_UPDATED,
      resourceType: 'organization',
      resourceId: organizationId,
      metadata: { fields: changed },
      clientAddress: null,
      clientLabel: null,
      occurredAt: now,
    });

    // The later read is the point: it is what catches an implementation that
    // builds an updated entity and returns it without ever having stored it.
    return toOrganizationEntity(await this.require(organizationId));
  }

  /**
   * Soft-deletes an organization. The record is retained so that history
   * referencing it stays readable; the organization stops being listed.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization to delete
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   */
  public async deleteOrganization(actorId: UserId, organizationId: OrganizationId): Promise<void> {
    await this.requireMember(actorId, organizationId);
    const now = new Date();

    await this.organizations.update({ id: organizationId }, { deletedAt: now, updatedAt: now });

    await this.audit.record({
      organizationId,
      actorId,
      action: AuditAction.ORGANIZATION_DELETED,
      resourceType: 'organization',
      resourceId: organizationId,
      metadata: {},
      clientAddress: null,
      clientLabel: null,
      occurredAt: now,
    });
  }

  /**
   * The memberships of one organization.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization whose members are wanted
   * @param query - which page is wanted, and an optional role filter
   * @returns one page of memberships, with the totals a caller needs
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   */
  public async listMembers(
    actorId: UserId,
    organizationId: OrganizationId,
    query: MemberQuery,
  ): Promise<PaginatedResult<Membership>> {
    await this.requireMember(actorId, organizationId);

    const page = Math.max(1, Math.trunc(query.page));
    const limit = Math.max(1, Math.trunc(query.limit));

    const where: FindOptionsWhere<MembershipRecord> = { organizationId };
    if (query.role !== undefined) where.role = query.role;

    const [rows, total] = await this.memberships.findAndCount({
      where,
      // The same total-order reason `listOrganizations` gives: two
      // memberships created in the same millisecond would otherwise return a
      // different page 2 every time.
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: rows.map((row) => toMembershipEntity(row)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Gives a member a different role in one organization.
   *
   * **The last-owner check is a COUNT of remaining owners, taken inside the
   * same transaction as the write — not an equality against the actor's own
   * id.** Those two differ in exactly the case that matters: an ADMIN
   * demoting the sole OWNER is not the owner demoting themselves, and
   * `if (targetUserId === actorId) throw new LastOwnerError()` would let it
   * through while passing every test where the owner acts on their own
   * membership (spec §9.4, D15).
   *
   * The transaction runs at **`SERIALIZABLE`**, not the default `READ
   * COMMITTED`. Under `READ COMMITTED`, two concurrent demotions of two
   * *different* owners can each read "2 owners remain" before either writes —
   * neither demotion touches the row the other just read, so no lock either
   * would take blocks the other — and both then commit, leaving zero owners.
   * `SERIALIZABLE` is what makes Postgres notice that the two transactions'
   * reads and writes cannot be explained by any serial order and abort one of
   * them with a `40001` serialization failure. That is the cost: a caller of
   * this method must be prepared to retry a request that failed for no reason
   * of its own. A weaker level bought back with an explicit
   * `SELECT ... FOR UPDATE` lock on every `OWNER` row would avoid that retry,
   * but it is not simpler — it is the same "read the set, then decide" shape
   * with a lock bolted on — and this method touches only `memberships`, never
   * a second table, so there is no multi-table anomaly here that
   * `SERIALIZABLE` would be overkill for. `SERIALIZABLE` is chosen because it
   * is the one level that makes the count-then-write itself the unit of
   * atomicity, without this method also having to reason about which rows to
   * lock and in what order.
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
  public async changeMemberRole(
    actorId: UserId,
    organizationId: OrganizationId,
    targetUserId: UserId,
    role: OrgRole,
  ): Promise<Membership> {
    await this.requireMember(actorId, organizationId);
    const now = new Date();

    const membershipId = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const membership = await manager.findOne(MembershipRecord, {
        where: { organizationId, userId: targetUserId },
      });
      if (membership === null) throw new MembershipNotFoundError(targetUserId);

      // The count is read only when it could matter: demoting anybody who is
      // not currently an OWNER, or promoting an OWNER to a role that is still
      // OWNER, never threatens the invariant.
      if (membership.role === OrgRole.OWNER && role !== OrgRole.OWNER) {
        const owners = await manager.find(MembershipRecord, {
          where: { organizationId, role: OrgRole.OWNER },
        });
        if (owners.length <= 1) throw new LastOwnerError();
      }

      await manager.update(MembershipRecord, { id: membership.id }, { role, updatedAt: now });
      return membership.id as string;
    });

    await this.audit.record({
      organizationId,
      actorId,
      action: AuditAction.MEMBER_ROLE_CHANGED,
      resourceType: 'membership',
      resourceId: membershipId,
      metadata: { userId: targetUserId, role },
      clientAddress: null,
      clientLabel: null,
      occurredAt: now,
    });

    // The later read is the point, the same reason `updateOrganization` gives:
    // it is what catches an implementation that decides the write happened
    // without ever having stored it.
    return toMembershipEntity(await this.requireMembership(organizationId, targetUserId));
  }

  /**
   * Ends somebody's membership of one organization. The account itself is
   * untouched — this is about one tenant, not about the person.
   *
   * The same last-owner guard as {@link changeMemberRole}, for the same
   * reason and at the same isolation level: removing the sole OWNER is
   * exactly as ownerless an outcome as demoting them, by a different route,
   * and whoever asks for it — the owner themselves or somebody else entirely
   * — the answer is the same (D15).
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization the membership is in
   * @param targetUserId - the member to remove
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   * @throws MembershipNotFoundError when the target is not a member of it
   * @throws LastOwnerError when the removal would leave the organization with no OWNER
   */
  public async removeMember(
    actorId: UserId,
    organizationId: OrganizationId,
    targetUserId: UserId,
  ): Promise<void> {
    await this.requireMember(actorId, organizationId);
    const now = new Date();

    const membershipId = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const membership = await manager.findOne(MembershipRecord, {
        where: { organizationId, userId: targetUserId },
      });
      if (membership === null) throw new MembershipNotFoundError(targetUserId);

      if (membership.role === OrgRole.OWNER) {
        const owners = await manager.find(MembershipRecord, {
          where: { organizationId, role: OrgRole.OWNER },
        });
        if (owners.length <= 1) throw new LastOwnerError();
      }

      await manager.delete(MembershipRecord, { id: membership.id });
      return membership.id as string;
    });

    await this.audit.record({
      organizationId,
      actorId,
      action: AuditAction.MEMBER_REMOVED,
      resourceType: 'membership',
      resourceId: membershipId,
      metadata: { userId: targetUserId },
      clientAddress: null,
      clientLabel: null,
      occurredAt: now,
    });
  }

  /**
   * Offers somebody a role in an organization, addressed to an email.
   *
   * The address is checked against the organization's *members*, not against
   * whether an account with it exists at all — core's own contract says the
   * address "need not belong to an existing account", and a check that
   * refused an unregistered address would make it impossible to invite
   * anybody who has not signed up yet, which is the ordinary case this whole
   * mechanism exists for.
   *
   * The row and its audit entry are written in ONE transaction, the same
   * atomicity `createOrganization` gives the organization and its owner
   * membership, and for the same reason: an invitation that survived a
   * rollback of its own audit entry would be a real, redeemable credential
   * with no record of who issued it.
   *
   * The mail is sent only once that transaction has committed. A message
   * that went out before the row existed could be delivered, then followed by
   * a rollback that leaves the link pointing at nothing — a worse failure
   * than a committed invitation whose mail never arrives, which a resend can
   * still repair.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization membership is offered in
   * @param input - the address to invite and the role offered
   * @returns the new invitation
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   * @throws AlreadyAMemberError when the address is that of an existing member
   */
  public async inviteMember(
    actorId: UserId,
    organizationId: OrganizationId,
    input: InviteMemberInput,
  ): Promise<Invitation> {
    const organizationRow = await this.requireMember(actorId, organizationId);
    const now = new Date();

    // Validated before anything is written, the same discipline
    // `createOrganization` follows: constructing the domain entity runs
    // every invariant `Invitation` enforces (a blank address), so a bad one
    // touches no row. The id and every other throwaway field are discarded
    // the moment validation passes.
    const validated = new Invitation({
      id: 'validation-only' as InvitationId,
      organizationId,
      email: input.email,
      role: input.role,
      status: InvitationStatus.PENDING,
      invitedByUserId: actorId,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_SECONDS * 1000),
      createdAt: now,
      acceptedAt: null,
      acceptedByUserId: null,
    });

    const existingUser = await this.users.findOne({ where: { email: validated.email } });
    if (existingUser !== null) {
      const membership = await this.memberships.findOne({
        where: { organizationId, userId: existingUser.id },
      });
      if (membership !== null) {
        throw new AlreadyAMemberError(organizationId, existingUser.id as UserId);
      }
    }

    const generated = generateOpaqueToken();
    const invitationId = await this.dataSource.transaction(async (manager) => {
      const inserted = await manager.insert(InvitationRecord, {
        organizationId,
        email: validated.email,
        role: validated.role,
        status: InvitationStatus.PENDING,
        tokenHash: generated.hash,
        invitedByUserId: actorId,
        expiresAt: validated.expiresAt,
        createdAt: now,
        acceptedAt: null,
        acceptedByUserId: null,
      });
      const id = inserted.identifiers[0].id as string;

      await this.audit.recordIn(manager, {
        organizationId,
        actorId,
        action: AuditAction.MEMBER_INVITED,
        resourceType: 'invitation',
        resourceId: id,
        metadata: { email: validated.email, role: validated.role },
        clientAddress: null,
        clientLabel: null,
        occurredAt: now,
      });

      return id;
    });

    await this.mailer.send(
      buildOrganizationInvitationMessage({
        to: validated.email,
        token: generated.token,
        organizationName: organizationRow.name,
        webappUrl: this.webappUrl,
      }),
    );

    // The later read is the point, the same reason `updateOrganization` gives:
    // it is what catches an implementation that builds an invitation and
    // returns it without ever having stored it.
    return toInvitationEntity(
      await this.requireInvitation(organizationId, invitationId as InvitationId),
    );
  }

  /**
   * The invitations of one organization.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization whose invitations are wanted
   * @param query - which page is wanted, and an optional status filter
   * @returns one page of invitations, with the totals a caller needs
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   */
  public async listInvitations(
    actorId: UserId,
    organizationId: OrganizationId,
    query: InvitationQuery,
  ): Promise<PaginatedResult<Invitation>> {
    await this.requireMember(actorId, organizationId);

    const page = Math.max(1, Math.trunc(query.page));
    const limit = Math.max(1, Math.trunc(query.limit));

    const where: FindOptionsWhere<InvitationRecord> = { organizationId };
    if (query.status !== undefined) where.status = query.status;

    const [rows, total] = await this.invitations.findAndCount({
      where,
      // The same total-order reason `listMembers` gives: two invitations
      // issued in the same millisecond would otherwise return a different
      // page 2 every time.
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: rows.map((row) => toInvitationEntity(row)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Withdraws an invitation that has not been accepted.
   *
   * The predicate on the closing `UPDATE` (`status: PENDING`) is the
   * discriminating half of this method, the same shape as `verifyEmail`'s own
   * spend in `AuthService`: reading the row as open and then writing
   * unconditionally would let a revoke racing an accept — or two revokes
   * racing each other — both believe they were the one that closed it. Only
   * one `UPDATE` can match a row still `PENDING`; the other reads `affected:
   * 0` and answers truthfully that there was nothing left to withdraw.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization the invitation was issued in
   * @param invitationId - the invitation to withdraw
   * @returns the invitation in its REVOKED state
   * @throws OrganizationNotFoundError when the actor cannot see the organization
   * @throws InvitationNotFoundError when no invitation in it answers to the id
   * @throws InvitationNoLongerOpenError when the invitation is already closed
   */
  public async revokeInvitation(
    actorId: UserId,
    organizationId: OrganizationId,
    invitationId: InvitationId,
  ): Promise<Invitation> {
    await this.requireMember(actorId, organizationId);
    const now = new Date();

    const row = await this.requireInvitation(organizationId, invitationId);
    const invitation = toInvitationEntity(row);
    if (!invitation.isOpenAt(now)) throw new InvitationNoLongerOpenError(invitationId);

    const revoked = await this.invitations.update(
      { id: invitationId, status: InvitationStatus.PENDING },
      { status: InvitationStatus.REVOKED },
    );
    if (revoked.affected !== 1) throw new InvitationNoLongerOpenError(invitationId);

    await this.audit.record({
      organizationId,
      actorId,
      action: AuditAction.INVITATION_REVOKED,
      resourceType: 'invitation',
      resourceId: invitationId,
      metadata: {},
      clientAddress: null,
      clientLabel: null,
      occurredAt: now,
    });

    // The later read is the point, the same reason every other mutation in
    // this class gives: it is what catches an implementation that flips the
    // status in memory and returns it without the write having landed.
    return toInvitationEntity(await this.requireInvitation(organizationId, invitationId));
  }

  /**
   * Redeems an invitation, creating the membership it offered.
   *
   * **Looked up by a hash of the token, never by scanning and comparing** —
   * the same discipline `RefreshTokenService.rotate` follows for the same
   * reason: a scan is both slow and a timing oracle over which prefixes of a
   * presented value matched something real.
   *
   * The row is read **with a write lock** (`SELECT ... FOR UPDATE`), inside
   * the transaction that also inserts the membership and closes the
   * invitation — the same shape `RefreshTokenService.rotate` and
   * `AuthService.verifyEmail` use for their own single-use credentials, over
   * `SERIALIZABLE`: this method touches one row that is only ever read and
   * written by the holder of *that* token, never a set two concurrent actors
   * could each read a stale count of, so there is no multi-row invariant here
   * that isolation level exists to protect. The closing `UPDATE`'s own
   * `status: PENDING` predicate is the backstop if that lock is ever removed,
   * exactly as `verifyEmail`'s `consumedAt: IsNull()` is for its token.
   *
   * **Openness is judged before the address is checked.** Core's own
   * contract requires it: a second presentation of a spent token must be
   * answered the same way whoever presents it, and checking the address
   * first would tell the wrong holder "wrong address" while the right holder
   * was told "already used" — the reverse order leaks the WORSE thing: the
   * right holder would get "no longer open" while a wrong holder — somebody
   * who merely forwarded the mail, or received it forwarded — got "not your
   * address", which tells them the token IS addressed to somebody, just not
   * them. That is exactly the discrimination the closed-state collapse
   * exists to shut.
   *
   * **Already being a member is checked too, inside this same transaction,
   * under the same lock.** `inviteMember` refuses to issue a SECOND
   * invitation to an address that already has a membership, but it cannot
   * stop a SECOND invitation issued before the FIRST is accepted — two
   * PENDING invitations to one address are not a fault `inviteMember` can
   * see. Both are then redeemable, and a defaulting implementation inserts
   * two membership rows for the same `(organizationId, userId)`: harmless
   * against the zero-constraint `FakeDataSource` this backend's fast tests
   * run against, and a bare, codeless `500` against the real schema, which
   * enforces `uq_memberships_org_user` and gives `insert` a `23505` this
   * method must expect. Two mechanisms close it, the same division
   * `AuthService.register` draws for its own duplicate-insert race:
   *
   * - The `SELECT` here closes the SEQUENTIAL case — one token accepted,
   *   then the other, with no overlap — the ordinary way this actually
   *   happens (an admin invites twice because they were not sure the first
   *   mail arrived, and the recipient clicks both links).
   * - The `23505` mapping on the `INSERT` below closes the CONCURRENT case —
   *   two DIFFERENT tokens for the same address, redeemed at the same time —
   *   where two transactions can each run the `SELECT` above and each see no
   *   existing membership, because neither has committed yet. No row this
   *   method touches is shared between the two tokens, so there is nothing
   *   for a lock taken on either one to serialize against; the unique index
   *   is the only thing that sees both at once.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param token - the opaque value the recipient was given
   * @returns the new membership
   * @throws InvitationNotFoundError when the token redeems nothing
   * @throws InvitationNoLongerOpenError when the invitation was revoked, has
   * already been accepted, or has expired — the three are indistinguishable on
   * purpose
   * @throws InvitationAddressMismatchError when the account redeeming it does
   * not hold the address it was sent to
   * @throws AlreadyAMemberError when the account redeeming it already holds a
   * membership in the invitation's organization — from an earlier invitation
   * to the same address, accepted first
   */
  public async acceptInvitation(actorId: UserId, token: string): Promise<Membership> {
    const presentedHash = hashOpaqueToken(token);
    const now = new Date();

    const created = await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(InvitationRecord, {
        where: { tokenHash: presentedHash },
        lock: { mode: 'pessimistic_write' },
      });
      if (row === null) throw new InvitationNotFoundError(NO_INVITATION);

      const invitation = toInvitationEntity(row);
      if (!invitation.isOpenAt(now)) throw new InvitationNoLongerOpenError(invitation.id);

      const user = await manager.findOne(UserRecord, { where: { id: actorId } });
      if (user === null || user.email !== invitation.email) {
        throw new InvitationAddressMismatchError(invitation.id);
      }

      // The sequential half of the already-a-member guard — see this
      // method's own TSDoc. Read under `manager`, inside this transaction,
      // not through `this.memberships`: the state that decides whether the
      // insert below may proceed has to be read under the same lock that
      // guards the write, or the read and the write are two separate facts
      // that can be overtaken by whatever else commits between them.
      const existingMembership = await manager.findOne(MembershipRecord, {
        where: { organizationId: invitation.organizationId, userId: actorId },
      });
      if (existingMembership !== null) {
        throw new AlreadyAMemberError(invitation.organizationId, actorId);
      }

      let membershipId: string;
      try {
        const inserted = await manager.insert(MembershipRecord, {
          organizationId: invitation.organizationId,
          userId: actorId,
          role: invitation.role,
          createdAt: now,
          updatedAt: now,
        });
        membershipId = inserted.identifiers[0].id as string;
      } catch (error) {
        // The concurrent half of the same guard: two different tokens for
        // the same address, redeemed at the same time, each having just run
        // the `SELECT` above and each having seen no membership yet. Only
        // `uq_memberships_org_user` sees both inserts at once, and the loser
        // gets a `23505` — mapped here rather than left to fall through to
        // `HttpExceptionFilter`'s generic 500 branch, the same duck-typed
        // check `AuthService.isUniqueViolation` uses and for the same reason:
        // the message is a driver string that a Postgres upgrade can reword,
        // the SQLSTATE is not.
        if (!OrganizationsService.isUniqueViolation(error)) throw error;
        throw new AlreadyAMemberError(invitation.organizationId, actorId);
      }

      // The same discriminating predicate `revokeInvitation` uses, and the
      // backstop the lock above is primary defense against: only one writer
      // can close a row still `PENDING`.
      const closed = await manager.update(
        InvitationRecord,
        { id: row.id, status: InvitationStatus.PENDING },
        { status: InvitationStatus.ACCEPTED, acceptedAt: now, acceptedByUserId: actorId },
      );
      if (closed.affected !== 1) throw new InvitationNoLongerOpenError(invitation.id);

      await this.audit.recordIn(manager, {
        organizationId: invitation.organizationId,
        actorId,
        action: AuditAction.INVITATION_ACCEPTED,
        resourceType: 'invitation',
        resourceId: invitation.id,
        metadata: { userId: actorId },
        clientAddress: null,
        clientLabel: null,
        occurredAt: now,
      });

      return { membershipId, organizationId: invitation.organizationId };
    });

    // The later read is the point, the same reason every other mutation in
    // this class gives.
    return toMembershipEntity(await this.requireMembership(created.organizationId, actorId));
  }

  // -------------------------------------------------------------------- private

  /**
   * The organization `organizationId` names, guarded by membership: the
   * actor must hold a membership in it, or this throws the same error it
   * throws for an id nobody ever issued — the two are indistinguishable on
   * purpose (`IOrganizationService`'s own contract).
   *
   * A row is guaranteed to exist whenever a membership names it —
   * `memberships.organization_id` carries a foreign key to `organizations`
   * with no `ON DELETE` path that removes the row on a soft delete — so a
   * membership found here with no organization behind it would be a
   * corrupted database, not a case this method is written to expect.
   */
  private async requireMember(
    actorId: UserId,
    organizationId: OrganizationId,
  ): Promise<OrganizationRecord> {
    const membership = await this.memberships.findOne({
      where: { organizationId, userId: actorId },
    });
    if (membership === null) throw new OrganizationNotFoundError(organizationId);
    return this.require(organizationId);
  }

  /** The row behind an id, or the domain's own not-found refusal. */
  private async require(organizationId: OrganizationId): Promise<OrganizationRecord> {
    const row = await this.organizations.findOne({ where: { id: organizationId } });
    if (row === null) throw new OrganizationNotFoundError(organizationId);
    return row;
  }

  /**
   * The membership binding `userId` to `organizationId`, or the domain's own
   * not-found refusal — `MembershipNotFoundError`, not
   * `OrganizationNotFoundError`: by the time this is called, `requireMember`
   * has already established that the actor may see the organization, so a
   * miss here is about the *target*, not about what the actor is allowed to
   * know exists.
   */
  private async requireMembership(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<MembershipRecord> {
    const row = await this.memberships.findOne({ where: { organizationId, userId } });
    if (row === null) throw new MembershipNotFoundError(userId);
    return row;
  }

  /**
   * The invitation `invitationId` names, scoped to `organizationId` — an
   * invitation issued by a different organization answers exactly as one
   * that does not exist, the same collapse `requireMembership` draws one
   * level down from `requireMember`.
   */
  private async requireInvitation(
    organizationId: OrganizationId,
    invitationId: InvitationId,
  ): Promise<InvitationRecord> {
    const row = await this.invitations.findOne({ where: { organizationId, id: invitationId } });
    if (row === null) throw new InvitationNotFoundError(invitationId);
    return row;
  }

  /**
   * Whether a caught error is a Postgres unique-violation (`23505`).
   *
   * The same duck-typed check `AuthService.isUniqueViolation` uses, kept
   * duck-typed here for the same reason: matched on SQLSTATE rather than the
   * driver's message text, because the message is localized by the server's
   * own settings and a match on it stops matching after a Postgres upgrade.
   */
  private static isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object'
      && error !== null
      && (error as { code?: unknown }).code === '23505'
    );
  }
}
