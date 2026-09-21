import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { Membership, Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import {
  LastOwnerError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
} from '__FORGE_SCOPE__/core/organizations/errors';
import type {
  CreateOrganizationInput,
  MemberQuery,
  OrganizationId,
  OrganizationQuery,
  UpdateOrganizationInput,
} from '__FORGE_SCOPE__/core/organizations/types';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditService } from '../audit/audit.service';
import { MembershipRecord } from './membership-record.entity';
import { OrganizationRecord } from './organization-record.entity';
import { toMembershipEntity } from './to-membership';
import { toOrganizationEntity } from './to-organization';

/**
 * The organization half of {@link IOrganizationService}, over the
 * `organizations` and `memberships` tables. Tasks 11 and 12 add members and
 * invitations to this same class.
 *
 * Every entitlement question this phase can ask so far is "is the actor a
 * member of this organization at all", answered by a row in `memberships` —
 * layer two of `can()` (role-scoped actions inside an organization the actor
 * already belongs to) is not reached by any method here yet, and lands with
 * `PermissionsGuard` in Task 13.
 */
@Injectable()
export class OrganizationsService {
  public constructor(
    @InjectRepository(OrganizationRecord)
    private readonly organizations: Repository<OrganizationRecord>,
    @InjectRepository(MembershipRecord)
    private readonly memberships: Repository<MembershipRecord>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

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
   * their own would still pass. Task 20's D9 injection targets exactly this
   * shape of fault.
   *
   * This is two queries rather than one SQL `JOIN`, because the fake store
   * this backend's unit tests run against (`common/testing/fake-data-source.ts`,
   * a hand-rolled double with no query builder — see ADR-0002 on zero
   * dependencies) cannot execute one. The property the brief cares about does
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
}
