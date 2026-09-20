import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { IAuditService } from '__FORGE_SCOPE__/core/audit/contracts';
import { AuditEntry } from '__FORGE_SCOPE__/core/audit/entities';
import type { AuditQuery, RecordAuditEntryInput } from '__FORGE_SCOPE__/core/audit/types';
import type { AuditEntryId } from '__FORGE_SCOPE__/core/audit/types';
import { can } from '__FORGE_SCOPE__/core/authorization/policies';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { UserRecord } from '../users/user-record.entity';
import { AuditEntryRecord } from './audit-entry-record.entity';

/**
 * {@link IAuditService} over the `audit_entries` table.
 *
 * The append-only guarantee is not in this class and cannot be: it is a
 * privilege revoked from the role the application connects as
 * (`db/migrations/1758000002000-AuditAppendOnly.ts`). What this class
 * contributes is that it offers no way to ask for an update or a delete, which
 * is the weaker half — see `IAuditService`'s own comment.
 */
@Injectable()
export class AuditService implements IAuditService {
  public constructor(
    @InjectRepository(AuditEntryRecord)
    private readonly entries: Repository<AuditEntryRecord>,
    @InjectRepository(UserRecord)
    private readonly users: Repository<UserRecord>,
  ) {}

  /**
   * Writes one entry.
   *
   * A failure here is **not** swallowed, and that is a decision rather than an
   * oversight. `IAuditService.record` promises never to reject "for a business
   * reason", and an insert that the database refuses is not a business reason —
   * it is the audit log being unwritable, which is the one condition under
   * which none of the actions this system takes are reconstructable. A caller
   * that catches and continues turns an unwritable audit log into a silent one,
   * and the entry that goes missing is the one somebody needed. The cost is
   * stated plainly: a database that will not accept an audit row also refuses
   * the sign-in that provoked it.
   */
  public async record(input: RecordAuditEntryInput): Promise<void> {
    await this.entries.insert(AuditService.toRow(input));
  }

  /**
   * Writes one entry inside a transaction somebody else opened.
   *
   * It exists so that an entry and the thing it describes commit together. An
   * entry written outside its operation's transaction survives that operation
   * being rolled back, and the result is a permanent record of something that
   * did not happen — permanent because `audit_entries` refuses UPDATE and DELETE
   * to the role this process connects as, so nothing can correct it afterwards.
   * That exact defect shipped once, in `resetPassword`.
   *
   * @param manager - the caller's transaction
   * @param input - the entry to record, less the identifier the store assigns
   */
  public async recordIn(manager: EntityManager, input: RecordAuditEntryInput): Promise<void> {
    await manager.insert(AuditEntryRecord, AuditService.toRow(input));
  }

  /** Input to row, in one place rather than two. */
  private static toRow(input: RecordAuditEntryInput): QueryDeepPartialEntity<AuditEntryRecord> {
    const row: Partial<AuditEntryRecord> = {
      organizationId: input.organizationId,
      actorUserId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      // Copied rather than referenced, so a caller that goes on mutating the
      // object it passed cannot change what was recorded.
      metadata: { ...input.metadata },
      clientAddress: input.clientAddress,
      clientLabel: input.clientLabel,
      occurredAt: input.occurredAt,
    };
    // TypeORM's deep-partial type cannot express a `jsonb` column declared as an
    // open record: it wants every value to be a deep-partial of its own type,
    // and `unknown` is not one. The cast is confined to this line, which is the
    // only place in this backend where an audit row is built.
    return row as QueryDeepPartialEntity<AuditEntryRecord>;
  }

  /**
   * Reads one page of the history on an actor's behalf, newest first.
   *
   * Entitlement is decided by core's `can` (ADR-0006) and by nothing local. It
   * is checked **here** as well as at the transport boundary because this is the
   * only way in: a later caller that reaches the service directly — a scheduled
   * job, a console command — gets the same refusal a request would, and does not
   * depend on somebody having remembered a guard.
   *
   * `ForbiddenException` here, where `PlatformAdminGuard` answers 404 for the
   * same refusal, and the difference is deliberate in both directions. The
   * guard's 404 is aimed at a stranger on the wire, to whom "you may not" and
   * "there is nothing there" must be one answer. This is the answer a caller
   * that has already been identified gets, and it is also what makes the guard's
   * absence visible: delete `@UseGuards(PlatformAdminGuard)` from the audit
   * endpoint and the refusal a non-administrator receives changes from 404 to
   * 403, which `__tests__/audit.controller.spec.ts` asserts on.
   */
  public async query(actorId: UserId, query: AuditQuery): Promise<PaginatedResult<AuditEntry>> {
    const actor = await this.users.findOne({ where: { id: actorId } });
    if (actor === null) throw new ForbiddenException();
    // No memberships, no grants, and no resource either: this is the
    // deployment-wide history, which only layer one answers. With no `resource`
    // argument there is no path into layers two and three at all, so both lists
    // are empty because nothing here could read them — not because hydrating
    // them was skipped. An organization administrator reading their own
    // organization's entries is the same permission asked *with* an
    // organization, and it is a different call this endpoint does not make yet.
    const principal = {
      userId: actor.id as UserId,
      platformRole: actor.platformRole,
      memberships: [],
      grants: [],
    };
    if (!can(principal, 'audit:read')) {
      throw new ForbiddenException();
    }

    const page = Math.max(1, Math.trunc(query.page));
    const limit = Math.max(1, Math.trunc(query.limit));

    // Built as a typed value rather than spread inline, so an omitted filter is
    // an absent key and not a key whose value is `undefined` — TypeORM treats the
    // second as a comparison against NULL, which narrows to nothing.
    const where: FindOptionsWhere<AuditEntryRecord> = {};
    if (query.actorId !== undefined) where.actorUserId = query.actorId;
    if (query.action !== undefined) where.action = query.action;
    // Inclusive, so a bound taken from an entry's own instant includes that
    // entry — which is what lets a caller read the newest entry off page 1 and
    // use it as the bound for the rest of the traversal without losing it.
    if (query.asOf !== undefined) where.occurredAt = LessThanOrEqual(query.asOf);
    if (query.organizationId !== undefined) {
      // An explicit `null` narrows to the entries that belonged to no tenant.
      // This is a contract, not this implementation's private reading of one:
      // `runIAuditServiceContract`'s `describe('organizationId, the tenant
      // filter', ...)` pins all three cases — omitted, explicit `null`, and a
      // value — and this line is what makes this implementation satisfy it.
      where.organizationId = query.organizationId === null ? IsNull() : query.organizationId;
    }

    const [rows, total] = await this.entries.findAndCount({
      where,
      // Newest first, and `id` as the tie-break: `occurred_at` is supplied by the
      // caller (see `RecordAuditEntryInput`), so two entries can and do share an
      // instant, and an order that is not total returns a different page 2 every
      // time it is asked for.
      order: { occurredAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: rows.map((row) => AuditService.toEntity(row)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Row to entity. The branded ids are asserted here, in one visible line, which
   * is the convention every mapper in this backend follows (see `UserRecord`
   * and `toUserEntity`'s comment on why the mapper is the right and only place
   * for that claim). `AuditEntryRecord.organizationId` is a plain `string` —
   * deliberately no foreign key, see that class's own comment — so the brand is
   * asserted here rather than inherited from the column's type.
   */
  private static toEntity(row: AuditEntryRecord): AuditEntry {
    return new AuditEntry({
      id: row.id as AuditEntryId,
      organizationId: row.organizationId as OrganizationId | null,
      actorId: row.actorUserId === null ? null : (row.actorUserId as UserId),
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      metadata: row.metadata,
      clientAddress: row.clientAddress,
      clientLabel: row.clientLabel,
      occurredAt: row.occurredAt,
    });
  }
}
