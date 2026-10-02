import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, catchError, concatMap, from, map, throwError } from 'rxjs';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { AuditService } from '../../audit/audit.service';

/**
 * What a platform-administrative pass looks like, left on the request by
 * {@link PlatformAdminGuard} for {@link PlatformAdminOverrideInterceptor} to
 * write once the handler has finished.
 *
 * It is a property of the request rather than a value returned from the guard,
 * because a guard has no way to hand anything to an interceptor except through
 * the request — and because its presence is exactly the condition the
 * interceptor needs: an entry is owed if and only if the guard let this request
 * through.
 */
export interface PlatformAdminPass {
  /** The administrator who passed. */
  actorId: string;
  /** What they reached, so the entry says which power was used. */
  metadata: Record<string, unknown>;
  /** Where the request came from, recorded and never trusted for a decision. */
  clientAddress: string | null;
  /** A short, opaque description of the client, or `null`. */
  clientLabel: string | null;
  /** When the pass happened — the guard's instant, not the interceptor's. */
  occurredAt: Date;
}

/** The request property {@link PlatformAdminGuard} sets and this interceptor reads. */
export const PLATFORM_ADMIN_PASS = 'auth:platformAdminPass';

/**
 * Writes the `PLATFORM_ADMIN_OVERRIDE` entry a platform-administrative pass
 * owes — **after the handler has run, not before it**.
 *
 * ADR-0006 requires every such pass to be recorded, and the guard is where the
 * pass is decided. Recording it *there* had one consequence nobody wants and
 * one nobody had noticed: `GET /audit` is itself guarded, so a read of the
 * history wrote a row before the handler queried, and **the newest row of page 1
 * was always the request that had asked for it**. Measured, not deduced: a test
 * expecting three entries received four.
 *
 * Moving the write here fixes that completely and costs nothing — the entry is
 * still written for the same passes, with the guard's own instant, so nothing
 * about *what* is recorded changes.
 *
 * ## What this does NOT fix
 *
 * The next page. A traversal still spans several requests, and each one appends,
 * so page 2 is taken from a list one row longer than page 1's was — the same
 * drift any other concurrent writer would cause, now merely not self-inflicted
 * within a single request. That one is fixed by `AuditQuery.asOf`, which fixes
 * the *window* rather than the *writer*, and `audit.controller.ts` echoes it
 * back so a caller can hold every page of one traversal to the same world. The
 * two remedies are for two different problems and neither replaces the other.
 *
 * ## Written on both outcomes, and awaited before the response goes out
 *
 * The event recorded is the **pass**, which already happened by the time any
 * handler runs. A handler that then throws does not un-pass it, and an
 * administrator whose request failed is exactly as interesting to whoever reads
 * the history later — recording only on success would make a failing
 * administrative route the one kind of pass that leaves no trace.
 *
 * The write is **awaited** rather than started and forgotten. A `tap` that
 * launched it would be simpler and would be wrong twice: the entry would race
 * the response, so a caller could read the history back and not find the read
 * that produced it, and a failure would be unobservable by construction. Awaited
 * here, the ordering is exact — handler, then entry, then response — which is
 * what makes "a read's own entry is not in the page it returned" a fact rather
 * than a race that usually goes the right way.
 *
 * A failure therefore reaches the caller as a 500, and that is the deliberate
 * choice `AuditService.record` argues for: an audit write that a caller can
 * quietly lose creates pressure to make it optional, and an optional audit log
 * is not one. The asymmetry is stated rather than hidden — unlike every other
 * entry in this backend, this one is written *after* the operation it describes
 * has committed, so the 500 says "this action happened and could not be
 * recorded" and not "this action did not happen".
 *
 * Retrying is safe for every route this guard protects today, because each is
 * either a read or an idempotent write — setting a status or a platform role to
 * a value it may already hold. That is a property of the current routes and not
 * a rule the code enforces: whoever adds a non-idempotent administrative route
 * is the person who has to decide what a failed audit write should do to it.
 * Stated as a condition rather than a count, because a count of them was wrong
 * here within one round of being written.
 */
@Injectable()
export class PlatformAdminOverrideInterceptor implements NestInterceptor {
  public constructor(private readonly audit: AuditService) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { [PLATFORM_ADMIN_PASS]?: PlatformAdminPass }>();

    return next.handle().pipe(
      // Success: write, then emit what the handler produced.
      concatMap((value) => from(this.write(request)).pipe(map(() => value))),
      // Failure — the handler's, or this interceptor's own write — record the
      // pass if it is still owed, then re-raise the original error. `write`
      // clears the marker before it does anything, so the second call through
      // this path is a no-op and no entry is ever written twice.
      catchError((error: unknown) =>
        from(this.write(request)).pipe(concatMap(() => throwError(() => error)))),
    );
  }

  /**
   * Writes the entry, once, if the guard left one to write.
   *
   * The marker is cleared before anything else, so the success path and the
   * error path cannot both write for one request.
   *
   * A failure propagates. See the class comment for why that is the right end of
   * the trade even though the operation has already committed.
   */
  private async write(
    request: Request & { [PLATFORM_ADMIN_PASS]?: PlatformAdminPass },
  ): Promise<void> {
    const pass = request[PLATFORM_ADMIN_PASS];
    if (pass === undefined) return;
    delete request[PLATFORM_ADMIN_PASS];

    await this.audit.record({
      organizationId: null,
      actorId: pass.actorId as never,
      action: AuditAction.PLATFORM_ADMIN_OVERRIDE,
      resourceType: 'platform',
      resourceId: null,
      metadata: pass.metadata,
      clientAddress: pass.clientAddress,
      clientLabel: pass.clientLabel,
      occurredAt: pass.occurredAt,
    });
  }
}
