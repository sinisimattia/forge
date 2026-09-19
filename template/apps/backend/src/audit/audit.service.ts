import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import type { IAuditService } from '__FORGE_SCOPE__/core/audit/contracts';
import { AuditEntry } from '__FORGE_SCOPE__/core/audit/entities';
import type { AuditQuery, RecordAuditEntryInput } from '__FORGE_SCOPE__/core/audit/types';
import type { AuditEntryId } from '__FORGE_SCOPE__/core/audit/types';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import { PlatformRole } from '__FORGE_SCOPE__/core/users/enums';
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
    await this.entries.save(
      this.entries.create({
        organizationId: input.organizationId,
        actorUserId: input.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: { ...input.metadata },
        clientAddress: input.clientAddress,
        clientLabel: input.clientLabel,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Reads one page of the history on an actor's behalf, newest first.
   *
   * Entitlement in this phase is platform administration and nothing else, and
   * it is checked here rather than at the transport boundary because this is the
   * only way in: a later caller that reaches the service directly — a scheduled
   * job, a console command — gets the same refusal a request would.
   *
   * ## CARRY-FORWARD: this check is in the wrong place, and knows it
   *
   * ADR-0006 puts authorization in `__FORGE_SCOPE__/core` as a pure function.
   * Nothing in core implements one yet — `shared/policies/` holds `assertNever`
   * and `normalizeEmail` and nothing else — so when this method was written there
   * was no policy to call and the alternatives were to invent this check or to
   * leave the whole audit history readable by anybody. It is here because an
   * unguarded audit query is worse, not because this is where it belongs.
   *
   * **Whoever builds platform administration replaces this with the core policy
   * and deletes these paragraphs.** Two things make that easy to miss: nothing
   * reaches this method over HTTP today — there is no audit controller — so the
   * check is currently unreachable code, and an unmarked local check reads as
   * intentional and survives for ever. The first audit endpoint added on top of
   * it is the moment it becomes permanent.
   */
  public async query(actorId: UserId, query: AuditQuery): Promise<PaginatedResult<AuditEntry>> {
    const actor = await this.users.findOne({ where: { id: actorId } });
    if (actor === null || actor.platformRole !== PlatformRole.PLATFORM_ADMIN) {
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
    if (query.organizationId !== undefined) {
      // An explicit `null` narrows to the entries that belonged to no tenant.
      // `AuditQuery` says outright that this filter's semantics are not pinned by
      // the conformance suite, so this is this implementation's reading and not a
      // contract: anything that comes to rely on it must make it an assertion
      // there first.
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
   * is the convention every mapper in this backend follows (see `UserRecord`).
   */
  private static toEntity(row: AuditEntryRecord): AuditEntry {
    return new AuditEntry({
      id: row.id as AuditEntryId,
      organizationId: row.organizationId,
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
