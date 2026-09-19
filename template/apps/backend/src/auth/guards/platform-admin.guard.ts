import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { can } from '__FORGE_SCOPE__/core/authorization/policies';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditService } from '../../audit/audit.service';
import { UserRecord } from '../../users/user-record.entity';
import type { AuthenticatedActor } from '../strategies';

/**
 * Closes a route to everybody but a platform administrator, and records every
 * administrator who goes through it.
 *
 * It layers **under** the global `JwtAuthGuard`: by the time this runs the
 * request has already proven who it is, so the only question left is whether
 * that person may operate the deployment. It answers it by calling core's
 * `can` (ADR-0006) and nowhere else — the rule lives in one pure function that
 * the webapp evaluates too, so a button is hidden by exactly the rule that
 * would have refused the request.
 *
 * ## Why it answers 404 and not 403
 *
 * A deliberate trade, and the worse choice for debugging: somebody who really
 * should be an administrator gets "not found" for a route that plainly exists,
 * and nothing in the answer says "you are not an administrator". What it buys
 * is that the answer carries no information at all. A 403 confirms two things
 * to whoever asked: that this route exists, and — on `GET /users/:id` — that
 * the id in it names a real account. Both are free reconnaissance, and the
 * second is an enumeration oracle over every account on the deployment, reached
 * from a different direction than the one the sign-in endpoints close.
 *
 * The status and the body are the same ones `UserNotFoundError` produces
 * (`errors.http.not_found`), so "you may not" and "there is no such thing" are
 * genuinely indistinguishable rather than merely similar.
 *
 * ## Why the pass is recorded and the refusal is not
 *
 * Spec §9.5: `PLATFORM_ADMIN` passes everything, and every such pass is
 * audit-logged. That is what {@link AuditAction.PLATFORM_ADMIN_OVERRIDE} means —
 * a pass the ordinary rules would have refused, whose justification is not
 * visible anywhere in the request itself. A refusal is not an override; it is
 * already the ordinary answer, and recording one would let anybody fill the
 * audit log by asking for a route they cannot reach.
 *
 * ## What the record costs on a route that only reads
 *
 * `GET /audit` is guarded by this class, so every read of the history appends to
 * the history. That is correct — reading every account's events across the
 * deployment is exactly a platform-administrative pass — but it has a
 * consequence worth knowing before it surprises somebody: see
 * `audit/audit.controller.ts`, which documents what it does to an administrator
 * paging through results and what the fix would be.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  public constructor(
    @InjectRepository(UserRecord)
    private readonly users: Repository<UserRecord>,
    private readonly audit: AuditService,
  ) {}

  /**
   * @param context - the request being served
   * @returns `true` when the actor may operate the deployment
   * @throws NotFoundException when they may not, or when nothing proved who
   *   they are — which is the same answer, on purpose
   */
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedActor }>();
    const actor = request.user;

    // No actor means this guard is protecting a route the global guard let
    // through unauthenticated — a `@Public()` on an administrative endpoint.
    // Refused rather than trusted: a guard that treated "nobody" as "carry on"
    // would make that mistake invisible.
    if (actor === undefined) throw new NotFoundException();

    // The standing is read from the row, never from the presented credential.
    // The access credential carries two claims and is not re-issued when
    // somebody's role changes, so a role copied into it would keep whatever it
    // was minted with — an administrator demoted at noon would keep operating
    // the deployment until their credential lapsed.
    const row = await this.users.findOne({ where: { id: actor.userId } });
    if (row === null) throw new NotFoundException();

    const permitted = can(
      { userId: row.id as UserId, platformRole: row.platformRole },
      'platform:administer',
    );
    if (!permitted) throw new NotFoundException();

    await this.audit.record({
      organizationId: null,
      actorId: row.id as UserId,
      action: AuditAction.PLATFORM_ADMIN_OVERRIDE,
      resourceType: 'platform',
      resourceId: null,
      // What was reached, so the entry says which power was used rather than
      // only that one was. The path is the route template where the framework
      // knows it, so an entry names `the accounts list` rather than one id.
      metadata: { method: request.method, path: request.originalUrl ?? request.url },
      clientAddress: request.ip ?? null,
      clientLabel: request.get('user-agent')?.slice(0, 200) ?? null,
      occurredAt: new Date(),
    });

    return true;
  }
}
