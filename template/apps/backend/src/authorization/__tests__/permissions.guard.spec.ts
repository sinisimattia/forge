import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ObjectLiteral, Repository } from 'typeorm';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { FakeDataSource } from '../../common/testing';
import { MembershipRecord } from '../../organizations/membership-record.entity';
import { OrganizationRecord } from '../../organizations/organization-record.entity';
import { UserRecord } from '../../users/user-record.entity';
import { PermissionsGuard } from '../permissions.guard';
import { PrincipalService } from '../principal.service';
import { RequirePermission } from '../require-permission.decorator';
import { ResourceGrantRecord } from '../resource-grant-record.entity';

/**
 * The guard, and above all **whose request it is**: the principal comes from the
 * credential's subject and the resource comes from the stored record, and the
 * route parameter builds neither.
 *
 * Hydrate the principal from `:id` and `can` compares the request's
 * organization against itself — the membership it consults is the one the
 * parameter just invented, so it always agrees and tenant isolation passes
 * without testing anything. *A claim whose subject has no test is a claim about
 * nothing.* That fault was injected into `permissions.guard.ts` and this file's
 * `hydrates the principal from the credential's subject, not from the route`
 * was watched turning red before any of this shipped.
 *
 * ## The controller under test is defined here
 *
 * `ProbeController` carries the annotations rather than any shipped controller,
 * for the reason `global-guard.spec.ts` gives about its own: an assertion
 * satisfied by a real endpoint's decorators is an assertion about that endpoint,
 * not about the mechanism. Whether the shipped routes carry
 * `@RequirePermission` is `organizations.controller.spec.ts`'s question.
 */

const MEMBER_OF_A = '11111111-1111-4111-8111-111111111111' as UserId;
const VIEWER_OF_A = '22222222-2222-4222-8222-222222222222' as UserId;
const ADMINISTRATOR = '33333333-3333-4333-8333-333333333333' as UserId;
const OUTSIDER = '44444444-4444-4444-8444-444444444444' as UserId;

const ORG_A = '55555555-5555-4555-8555-555555555555';
const ORG_B = '66666666-6666-4666-8666-666666666666';
const ORG_ABSENT = '77777777-7777-4777-8777-777777777777';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

/** The route the assertions below are about, and one that declares nothing. */
class ProbeController {
  @RequirePermission('organization:update')
  public guarded(): void {}

  public unguarded(): void {}
}

describe('PermissionsGuard', () => {
  let source: FakeDataSource;
  let principals: PrincipalService;
  let guard: PermissionsGuard;

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  const seedUser = (id: string, platformRole = PlatformRole.PLATFORM_USER): void => {
    source.seed(UserRecord, [
      {
        id,
        email: `${id}@example.test`,
        displayName: 'Somebody',
        status: UserStatus.ACTIVE,
        platformRole,
        emailVerifiedAt: EPOCH,
        createdAt: EPOCH,
        updatedAt: EPOCH,
        deletedAt: null,
      },
    ]);
  };

  const seedOrganization = (id: string): void => {
    source.seed(OrganizationRecord, [
      {
        id,
        name: 'Acme Works',
        slug: `acme-${id}`,
        createdAt: EPOCH,
        updatedAt: EPOCH,
        deletedAt: null,
      },
    ]);
  };

  const seedMembership = (organizationId: string, userId: string, role: OrgRole): void => {
    source.seed(MembershipRecord, [
      {
        id: `membership-${organizationId}-${userId}`,
        organizationId,
        userId,
        role,
        createdAt: EPOCH,
        updatedAt: EPOCH,
      },
    ]);
  };

  /** A request as express would present it to a guard: the actor, and the params. */
  const requestFor = (parts: {
    user?: { userId: UserId };
    params?: Record<string, string>;
  }): Record<string, unknown> => ({ ...parts, params: parts.params ?? {} });

  /** An execution context over `request`, for one of `ProbeController`'s methods. */
  const contextFor = (
    request: Record<string, unknown>,
    handler: () => void = ProbeController.prototype.guarded,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => ProbeController,
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    source = new FakeDataSource();
    principals = new PrincipalService(
      repo<UserRecord>(UserRecord),
      repo<MembershipRecord>(MembershipRecord),
      repo<ResourceGrantRecord>(ResourceGrantRecord),
    );
    guard = new PermissionsGuard(
      new Reflector(),
      principals,
      repo<OrganizationRecord>(OrganizationRecord),
    );

    seedOrganization(ORG_A);
    seedOrganization(ORG_B);
    seedUser(MEMBER_OF_A);
    seedUser(VIEWER_OF_A);
    seedUser(OUTSIDER);
    seedUser(ADMINISTRATOR, PlatformRole.PLATFORM_ADMIN);
    seedMembership(ORG_A, MEMBER_OF_A, OrgRole.ADMIN);
    seedMembership(ORG_A, VIEWER_OF_A, OrgRole.VIEWER);
  });

  describe('whose request is it', () => {
    /**
     * The seed that makes the fault observable.
     *
     * It gives `ORG_B` a *user* row of the same id, holding an OWNER membership
     * in `ORG_B`. Real identifiers never collide like that, and that is exactly
     * why it is here: a guard that hydrates from `request.params.id` looks the
     * parameter up in `users`, and without a row to find it would refuse for the
     * accidental reason that no account has that id — 404, the same answer the
     * correct guard gives, and the assertion below would pass while testing
     * nothing. With the collision the faulty guard finds a principal, finds the
     * membership the parameter invented, and ALLOWS the request.
     */
    const seedTheCollision = (): void => {
      seedUser(ORG_B);
      seedMembership(ORG_B, ORG_B, OrgRole.OWNER);
    };

    it('hydrates the principal from the credential\'s subject, not from the route', async () => {
      seedTheCollision();
      const request = requestFor({ user: { userId: MEMBER_OF_A }, params: { id: ORG_B } });

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(NotFoundException);
    });

    it('asks the hydrator about the subject of the credential and no other id', async () => {
      const hydrate = jest.spyOn(principals, 'hydrate');
      const request = requestFor({ user: { userId: MEMBER_OF_A }, params: { id: ORG_A } });

      await guard.canActivate(contextFor(request));

      expect(hydrate).toHaveBeenCalledTimes(1);
      expect(hydrate.mock.calls[0]?.[0]).toBe(MEMBER_OF_A);
    });

    it('does not let a membership in one organization answer for another', async () => {
      // The other direction of the same property: a real, current membership,
      // against a real organization it is not a membership in.
      const request = requestFor({ user: { userId: MEMBER_OF_A }, params: { id: ORG_B } });

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(NotFoundException);
    });
  });

  describe('the refusal carries no information', () => {
    it('refuses with the same answer as a missing organization', async () => {
      // `PlatformAdminGuard`'s trade, and it binds harder here: a 403 would
      // confirm that the id in the path names a real organization, which on a
      // tenant-scoped route is an enumeration oracle over other tenants' ids,
      // reachable by anybody with an account. Status AND body, because a status
      // that matches while the body says "you are not a member" leaks the same
      // fact through the one channel the status cannot close.
      const mayNot = await guard
        .canActivate(contextFor(requestFor({ user: { userId: OUTSIDER }, params: { id: ORG_A } })))
        .catch((error: NotFoundException) => error);
      const neverIssued = await guard
        .canActivate(
          contextFor(requestFor({ user: { userId: OUTSIDER }, params: { id: ORG_ABSENT } })),
        )
        .catch((error: NotFoundException) => error);

      expect(mayNot).toBeInstanceOf(NotFoundException);
      expect(neverIssued).toBeInstanceOf(NotFoundException);
      expect((mayNot as NotFoundException).getStatus()).toBe(
        (neverIssued as NotFoundException).getStatus(),
      );
      expect((mayNot as NotFoundException).getResponse()).toStrictEqual(
        (neverIssued as NotFoundException).getResponse(),
      );
    });

    it('refuses a member whose role does not carry the permission', async () => {
      // A VIEWER belongs to the organization and may read it. This is the layer
      // the service cannot see: `requireMember` asks only whether there is a
      // membership, so without this guard a VIEWER renames the organization.
      const request = requestFor({ user: { userId: VIEWER_OF_A }, params: { id: ORG_A } });

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(NotFoundException);
    });
  });

  describe('what it will not treat as permission', () => {
    it('refuses when it cannot determine what the request is about', async () => {
      // A route carrying `@RequirePermission` and naming no organization is
      // refused, never allowed. A guard that read "I could not work out what
      // this is about" as "carry on" would open every route whose parameter
      // somebody later renames — a change that breaks no type, no lint rule and
      // nothing else in this suite.
      const request = requestFor({ user: { userId: MEMBER_OF_A }, params: {} });

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(NotFoundException);
    });

    it('refuses when nothing proved who is asking', async () => {
      // `@Public()` on an authorized route. Refused rather than trusted, so the
      // mistake is loud instead of invisible.
      const request = requestFor({ params: { id: ORG_A } });

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(NotFoundException);
    });
  });

  describe('what it permits', () => {
    it('allows a member whose role carries the permission', async () => {
      const request = requestFor({ user: { userId: MEMBER_OF_A }, params: { id: ORG_A } });

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    });

    it('allows a platform administrator, which is layer one', async () => {
      // No membership anywhere, and `ADMINISTRATOR`'s standing comes off the
      // row rather than out of the credential — the guard is handed only a
      // `userId`, so there is nowhere else it could come from.
      const request = requestFor({ user: { userId: ADMINISTRATOR }, params: { id: ORG_A } });

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    });

    it('allows a route that declares no permission', async () => {
      // Not this guard's business — the route is still closed by the global
      // `JwtAuthGuard`. Asserted so that registering this guard globally one day
      // cannot silently deny every route nobody has annotated yet.
      const request = requestFor({ user: { userId: OUTSIDER }, params: { id: ORG_B } });

      await expect(
        guard.canActivate(contextFor(request, ProbeController.prototype.unguarded)),
      ).resolves.toBe(true);
    });
  });

  describe('nothing is cached', () => {
    it('denies on the next request once the membership is withdrawn', async () => {
      // D12's shape, one layer up from a grant. The access credential is not
      // re-minted when a membership ends, so anything cached for longer than a
      // request keeps authorizing for the rest of `ACCESS_TOKEN_TTL_SECONDS` —
      // which would make "revoked mid-session, denied on the next request"
      // unsatisfiable by construction rather than merely untested.
      const request = requestFor({ user: { userId: MEMBER_OF_A }, params: { id: ORG_A } });
      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

      await repo<MembershipRecord>(MembershipRecord).delete({
        organizationId: ORG_A,
        userId: MEMBER_OF_A,
      });

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(NotFoundException);
    });

    it('follows a demotion on the next request', async () => {
      const request = requestFor({ user: { userId: MEMBER_OF_A }, params: { id: ORG_A } });
      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

      await repo<MembershipRecord>(MembershipRecord).update(
        { organizationId: ORG_A, userId: MEMBER_OF_A },
        { role: OrgRole.VIEWER },
      );

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(NotFoundException);
    });
  });

  describe('the resource it judges', () => {
    it('refuses an organization no row answers to, before asking `can` at all', async () => {
      // The id is resolved from the store, so a tenant that does not exist is
      // refused rather than judged. A platform administrator passes everything
      // `can` is asked, so using one here is what shows the refusal happens
      // BEFORE the decision rather than inside it.
      const request = requestFor({ user: { userId: ADMINISTRATOR }, params: { id: ORG_ABSENT } });

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(NotFoundException);
    });
  });
});
