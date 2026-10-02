import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { IAuthorizationService } from '__FORGE_SCOPE__/core/authorization/contracts';
import { CrossTenantGrantError, GrantNotFoundError } from '__FORGE_SCOPE__/core/authorization/errors';
import type {
  CreateGrantInput,
  GrantId,
  GrantQuery,
  ResourceGrant,
} from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditService } from '../audit/audit.service';
import { MembershipRecord } from '../organizations/membership-record.entity';
import { ResourceGrantRecord } from './resource-grant-record.entity';
import { toGrantEntity } from './to-grant';

/**
 * {@link IAuthorizationService} over the `resource_grants` table: layer
 * three's own store, administered rather than decided (that class's own
 * TSDoc). Every write here is audited — `GRANT_CREATED`, `GRANT_REVOKED` —
 * because a grant is the one exception a role cannot express, and the log is
 * the only place that says who issued it and why, once withdrawn.
 *
 * `AuditService` is a provider of `AuthorizationModule` itself rather than
 * imported via `AuditModule`, for the reason `AuthorizationModule`'s own
 * TSDoc gives: `AuditModule` now has to import `AuthorizationModule` in turn,
 * for `OrganizationAuditController`'s guard, and importing `AuditModule` back
 * from here would close exactly the cycle that comment warns about.
 */
@Injectable()
export class AuthorizationService implements IAuthorizationService {
  public constructor(
    @InjectRepository(ResourceGrantRecord)
    private readonly grants: Repository<ResourceGrantRecord>,
    @InjectRepository(MembershipRecord)
    private readonly memberships: Repository<MembershipRecord>,
    private readonly audit: AuditService,
  ) {}

  /**
   * The grants issued inside one organization.
   *
   * @param _actorId - the user on whose behalf the call is made. Unused
   * today: who may administer grants is `PermissionsGuard`'s question,
   * decided before this method is ever called, and this store draws no
   * finer line than that — present on the signature (and underscored rather
   * than dropped) because `IAuthorizationService` states it for every method
   * uniformly, and a later rule that needs it will not have to change the
   * shape of the call.
   * @param organizationId - the organization whose grants are wanted
   * @param query - which page is wanted
   */
  public async listGrants(
    _actorId: UserId,
    organizationId: OrganizationId,
    query: GrantQuery,
  ): Promise<PaginatedResult<ResourceGrant>> {
    const page = Math.max(1, Math.trunc(query.page));
    const limit = Math.max(1, Math.trunc(query.limit));

    const [rows, total] = await this.grants.findAndCount({
      where: { organizationId },
      // A total order, for the reason every other paged read in this backend
      // gives: two grants issued in the same millisecond would otherwise
      // return a different page 2 every time.
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: rows.map((row) => toGrantEntity(row)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Issues one exception: this subject, this record, this permission.
   *
   * @throws BadRequestException when `input.permission` is
   * `'platform:administer'`. **This is the write-side half of a refusal
   * `can()` already states on the read side** — it excludes this one
   * permission from layer three by name, because a grant is issued under
   * `grant:create`, an organization-scoped permission an ADMIN holds, and
   * without a matching refusal here that ADMIN could persist a grant naming
   * the deployment's one unbounded permission. Nothing consults it today —
   * layer three fires on no route in this application (`PermissionsGuard`'s
   * own TSDoc) — which is exactly why the refusal belongs here rather than
   * nowhere: the alternative is a stored escalation waiting for a future
   * caller of `can()` that does not know to distrust it. Not a `DomainError`:
   * there is no id, no tenant and no membership to consult — this literal
   * value may never reach `createGrant` at all, regardless of who is asking or
   * what organization is named, which is what a plain `400` states and a
   * dedicated `DOMAIN_ERRORS` row would add nothing to.
   * @throws CrossTenantGrantError when the subject is not a member of the
   * organization
   */
  public async createGrant(
    actorId: UserId,
    organizationId: OrganizationId,
    input: CreateGrantInput,
  ): Promise<ResourceGrant> {
    if (input.permission === 'platform:administer') {
      throw new BadRequestException();
    }

    const membership = await this.memberships.findOne({
      where: { organizationId, userId: input.subjectUserId },
    });
    if (membership === null) {
      throw new CrossTenantGrantError(organizationId, input.subjectUserId);
    }

    const now = new Date();
    const inserted = await this.grants.insert({
      organizationId,
      subjectUserId: input.subjectUserId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      permission: input.permission,
      // The actor, never the input — `CreateGrantInput` carries no field for
      // this, on purpose (that type's own TSDoc), so an exception always
      // names somebody accountable for it.
      grantedBy: actorId,
      createdAt: now,
      expiresAt: input.expiresAt ?? null,
    });
    const id = inserted.identifiers[0].id;

    await this.audit.record({
      organizationId,
      actorId,
      action: AuditAction.GRANT_CREATED,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: { grantId: id, subjectUserId: input.subjectUserId, permission: input.permission },
      clientAddress: null,
      clientLabel: null,
      occurredAt: now,
    });

    return {
      id: id as GrantId,
      subjectUserId: input.subjectUserId,
      organizationId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      permission: input.permission,
      grantedBy: actorId,
      createdAt: now,
      expiresAt: input.expiresAt ?? null,
    };
  }

  /**
   * Withdraws a grant.
   *
   * @throws GrantNotFoundError when no such grant exists, and when it
   * belongs to another organization — the two are indistinguishable on
   * purpose, the same collapse `requireInvitation` draws for invitations.
   */
  public async revokeGrant(
    actorId: UserId,
    organizationId: OrganizationId,
    grantId: GrantId,
  ): Promise<void> {
    const row = await this.require(organizationId, grantId);
    const now = new Date();

    await this.grants.delete({ id: grantId, organizationId });

    await this.audit.record({
      organizationId,
      actorId,
      action: AuditAction.GRANT_REVOKED,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      metadata: { grantId, subjectUserId: row.subjectUserId, permission: row.permission },
      clientAddress: null,
      clientLabel: null,
      occurredAt: now,
    });
  }

  /**
   * The row behind a grant, scoped to the organization it must belong to —
   * a grant of another organization answers exactly as one that was never
   * issued.
   */
  private async require(
    organizationId: OrganizationId,
    grantId: GrantId,
  ): Promise<ResourceGrantRecord> {
    const row = await this.grants.findOne({ where: { id: grantId, organizationId } });
    if (row === null) throw new GrantNotFoundError(grantId);
    return row;
  }
}
