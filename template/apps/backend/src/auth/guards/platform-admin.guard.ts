import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { can } from '__FORGE_SCOPE__/core/authorization/policies';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { UserRecord } from '../../users/user-record.entity';
import type { AuthenticatedActor } from '../strategies';
import { PLATFORM_ADMIN_PASS, type PlatformAdminPass } from './platform-admin-override.interceptor';

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
 * audit-logged. That is what `AuditAction.PLATFORM_ADMIN_OVERRIDE` means — a
 * pass the ordinary rules would have refused, whose justification is not visible
 * anywhere in the request itself. A refusal is not an override; it is already
 * the ordinary answer, and recording one would let anybody fill the audit log by
 * asking for a route they cannot reach.
 *
 * ## This guard marks the pass; it does not write it
 *
 * `PlatformAdminOverrideInterceptor` writes it, after the handler. The entry is
 * owed either way, and writing it from here put it inside the page `GET /audit`
 * was about to return. See that file, and `audit/audit.controller.ts` for the
 * half of the problem an interceptor cannot fix.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  public constructor(
    @InjectRepository(UserRecord)
    private readonly users: Repository<UserRecord>,
  ) {}

  /**
   * @param context - the request being served
   * @returns `true` when the actor may operate the deployment
   * @throws NotFoundException when they may not, or when nothing proved who
   *   they are — which is the same answer, on purpose
   */
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    type GuardedRequest = Request & {
      user?: AuthenticatedActor;
      [PLATFORM_ADMIN_PASS]?: PlatformAdminPass;
    };
    const request = context.switchToHttp().getRequest<GuardedRequest>();
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
      {
        userId: row.id as UserId,
        platformRole: row.platformRole,
        // No memberships and no grants: this guard asks only layer one, which
        // reads neither. Hydrating them here would be a database read for an
        // answer that cannot depend on it, and the call below passes no
        // `resource`, so layers two and three are not merely unused — there is
        // no path to them. `PermissionsGuard` is what hydrates a full
        // principal, and it is the only thing that needs one.
        memberships: [],
        // An empty list, never an omitted one. The field is required precisely so
        // that a caller which should have hydrated grants cannot forget to — see
        // `Principal.grants`, whose contract is that whatever is here was already
        // judged live. Nothing was judged here because nothing is read here.
        grants: [],
      },
      'platform:administer',
    );
    if (!permitted) throw new NotFoundException();

    // The pass is MARKED here and WRITTEN by
    // `PlatformAdminOverrideInterceptor` once the handler has finished. The
    // entry is owed either way — spec §9.5 — but writing it from a guard put it
    // in the page that `GET /audit` was about to return, so the newest row of
    // page 1 was always the request that had asked for it. See the
    // interceptor's own comment for what that fixes and what it does not.
    //
    // The instant is taken here, not there: the moment worth recording is the
    // moment the pass was decided, not the moment the row was inserted, which is
    // the distinction `RecordAuditEntryInput.occurredAt` exists for.
    request[PLATFORM_ADMIN_PASS] = {
      actorId: row.id,
      // What was reached, so the entry says which power was used rather than
      // only that one was.
      metadata: { method: request.method, path: request.originalUrl ?? request.url },
      clientAddress: request.ip ?? null,
      clientLabel: request.get('user-agent')?.slice(0, 200) ?? null,
      occurredAt: new Date(),
    };

    return true;
  }
}
