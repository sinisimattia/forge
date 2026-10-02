import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { can } from '__FORGE_SCOPE__/core/authorization/policies';
import type { Permission } from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { AuthenticatedActor } from '../auth/strategies';
import { OrganizationRecord } from '../organizations/organization-record.entity';
import { PrincipalService } from './principal.service';
import { REQUIRED_PERMISSION } from './require-permission.decorator';

/**
 * The path parameter every organization-scoped route names its tenant with.
 *
 * One constant rather than the literal at both the read below and in each
 * controller's `@Param`, because the two have to agree and nothing but this
 * would make them. A route that spelled it differently would reach
 * {@link PermissionsGuard} with nothing resolvable and be refused — noisily and
 * immediately, which is the direction this failure must fall in.
 */
export const ORGANIZATION_PARAM = 'id';

/**
 * Turns `@RequirePermission` into an answer, by calling `can` and nothing else.
 *
 * It layers **under** the global `JwtAuthGuard`, exactly as `PlatformAdminGuard`
 * does: by the time this runs the request has proven who it is, so the only
 * question left is whether that person may do this to this organization.
 *
 * ## The fault this guard is written to make impossible
 *
 * **The principal is hydrated from the credential's subject. The resource is
 * resolved from the stored record. The route parameter builds neither.**
 *
 * The organization id in a path is what the request *claims* to be about. It is
 * used to look a row up and for nothing else. Hydrate the principal from it
 * instead and `can` compares the request's organization against itself: the
 * membership it consults is the one the parameter just invented, it always
 * agrees, and tenant isolation passes without testing anything. That is this
 * codebase's signature defect one level up — *a claim whose subject has no test
 * is a claim about nothing* — and it was injected into this file and watched
 * turning `permissions.guard.spec.ts`'s own "whose request is it" case red before
 * this shipped.
 *
 * ## Why the organization is read back rather than trusted
 *
 * The id judged comes off the row, not off the path, so `can` is asked about a
 * tenant the store vouched for. The lookup also collapses two answers into one:
 * an organization that does not exist and one the actor may not touch both leave
 * this guard by the same `throw`, so the refusal cannot be used to find out
 * which it was.
 *
 * ## Why it answers 404 and not 403
 *
 * The same trade `PlatformAdminGuard` sets out at length, and it binds harder
 * here. A 403 confirms that the id in the path names a real organization, which
 * on a tenant-scoped route is an enumeration oracle over other tenants' ids —
 * reachable by anybody with an account, against every organization on the
 * deployment. The status and the body are the ones `OrganizationNotFoundError`
 * produces (`errors.http.not_found`), which is what makes "you may not" and
 * "there is no such thing" genuinely indistinguishable rather than merely
 * similar, and `organizations.controller.spec.ts` compares the two bodies rather
 * than only their statuses.
 *
 * Nothing is recorded on a refusal. A refusal is the ordinary answer, not an
 * override, and recording one would let anybody fill the audit log by asking for
 * an organization they cannot reach — `PlatformAdminGuard`'s reasoning, unchanged.
 *
 * ## Why no `resourceType`/`resourceId` is passed to `can`
 *
 * Layer three is therefore not consulted on any route this guard protects, and
 * that is deliberate rather than unfinished. A grant is an exception about one
 * *record inside* a tenant. Naming the organization itself as the record would
 * make `grant:create` — which an ADMIN holds — a route to `organization:delete`,
 * which `Permission`'s own documentation calls "the one action no administrator
 * can be delegated, because it ends the tenant the delegation was scoped to". An
 * ADMIN could issue themselves the grant and then use it. A route about one of
 * the deployment's own records supplies its own type and id; a route about the
 * organization as a whole must not.
 *
 * ## Nothing is cached
 *
 * The principal is hydrated per request, every request. A cache outliving one
 * request would mean a membership or grant revoked mid-session kept authorizing
 * until it expired, which is D12 — "a `ResourceGrant` revoked mid-session → next
 * request denied, no stale cache" — made unsatisfiable by construction.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly principals: PrincipalService,
    @InjectRepository(OrganizationRecord)
    private readonly organizations: Repository<OrganizationRecord>,
  ) {}

  /**
   * @param context - the request being served
   * @returns `true` when the rules permit it, and `true` unconditionally for a
   *   route that declares no permission — which is not this guard's business and
   *   is still closed by the global `JwtAuthGuard`
   * @throws NotFoundException when they do not, when nothing proved who is
   *   asking, or when the route declares a permission and names no organization
   *   this guard can resolve — one answer for all four, on purpose
   */
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    // Handler then class, the order `JwtAuthGuard` reads `IS_PUBLIC` in, so a
    // method may state its own ask on a controller that states one too.
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      [context.getHandler(), context.getClass()],
    );

    // No annotation, nothing to decide. Asserted, so that registering this guard
    // globally one day cannot silently deny every route nobody has annotated
    // yet — the failure would be total and instant, but a guard is exactly the
    // place where "it refused everything" gets mistaken for "it is working".
    if (permission === undefined) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedActor }>();
    const actor = request.user;

    // No actor on a route that declares a permission means the global guard let
    // it through unauthenticated — a `@Public()` on an authorized endpoint.
    // Refused rather than trusted, `PlatformAdminGuard`'s judgement: a guard
    // that read "nobody" as "carry on" would make that mistake invisible.
    if (actor === undefined) throw new NotFoundException();

    // What the request CLAIMS to be about. Read here, used to look the row up,
    // and used for nothing else.
    //
    // Narrowed to `string` rather than merely checked for `undefined`: express
    // types a path parameter as possibly repeated, and a value that arrived more
    // than once is not an id — it is a caller probing what this guard does with
    // a shape it did not expect, and the answer is the same refusal as any other.
    const claimed: unknown = request.params[ORGANIZATION_PARAM];

    // A route carrying `@RequirePermission` that names no organization is
    // refused, not allowed. "I could not work out what this is about" read as
    // "carry on" is a guard that opens every route whose parameter somebody
    // later renames — the one change that would otherwise turn authorization off
    // and break no type, no lint rule and no test.
    if (typeof claimed !== 'string') throw new NotFoundException();

    // THE RESOURCE, RESOLVED FROM THE STORED RECORD. Not the path parameter: the
    // id judged below comes off a row the store returned, so a tenant that does
    // not exist is refused before `can` is asked about it, and by the same
    // `throw` as a tenant the actor may not touch. Soft-deleted rows are found
    // here exactly as `OrganizationsService.require` finds them — whether a
    // closed organization may still be read is the service's question, and
    // answering it in two places would be two rules.
    const organization = await this.organizations.findOne({ where: { id: claimed } });
    if (organization === null) throw new NotFoundException();

    // THE PRINCIPAL, RESOLVED FROM THE CREDENTIAL'S SUBJECT. `actor.userId` and
    // never `claimed` — the single most important line in
    // this file. Hydrating from the parameter makes `can` compare the request's
    // organization against itself — it always agrees, and tenant isolation
    // passes without testing anything. Per request and never cached.
    const principal = await this.principals.hydrate(actor.userId, new Date());

    const permitted = can(principal, permission, {
      organizationId: organization.id as OrganizationId,
      // No `resourceType` or `resourceId`, so layer three is not reached. See
      // this class's own comment: naming the organization as the record would
      // make an ADMIN's `grant:create` a route to `organization:delete`.
    });
    if (!permitted) throw new NotFoundException();

    return true;
  }
}
