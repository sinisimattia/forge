import request from 'supertest';
import type { Response } from 'supertest';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import {
  buildWorld, guardedRoutes, snapshotTenantB,
  GRANT_ABSENT, GRANT_B, INVITATION_ABSENT, INVITATION_B,
  MEMBER_A, MEMBER_B, ORG_A, ORG_ABSENT, ORG_B, OWNER_A, RESOURCE_TYPE, USER_ABSENT,
  type DiscriminatingWorld, type GuardedRoute,
} from './world';

/**
 * D9 — "a member of organization A requests an organization B resource →
 * 404/403, never data".
 *
 * ## What this file adds, and what it deliberately does not restate
 *
 * `tenant-isolation.spec.ts` already drives a hand-written list of routes and
 * compares the refusal a cross-tenant request gets against the one a missing
 * organization gets, body and all. That is the substance of D9 and it is not
 * repeated here. This file adds the two things that suite cannot do for itself:
 *
 * 1. **The route list is derived from the decorators**, not written down. Every
 *    `@RequirePermission` route this backend mounts must appear in the table
 *    below, so a tenth guarded route added next year is a red test here until
 *    somebody states its cross-tenant answer. A hand-written list goes on
 *    passing — a new route arrives with no isolation case and the suite that
 *    was supposed to notice is exactly the thing that cannot.
 * 2. **B is asserted not to have moved**, over every row B holds, taken before
 *    and after each refused request. A status is what the caller was *told*. A
 *    service that reached into B and then happened to answer 404 satisfies every
 *    status and body comparison in the suite next door.
 *
 * ## The fault this was watched going red under — and the one design ruling R3 names
 *
 * Design ruling R3 names one candidate fault: hydrating the principal from
 * the route parameter rather than the credential's subject. **That fault is
 * fail-closed, and this file says so rather than pretending otherwise.**
 * `PrincipalService.hydrate` looks a *user* up by id; handed an *organization*
 * id it finds no row and throws, so every guarded request is refused. It is a
 * real rule and a real defect — an unreachable application is a defect — but it
 * leaks nothing, and a D9 whose only injection was that one would be asserting
 * against a failure mode that cannot leak.
 *
 * The fault that can actually leak is the other one, and it is the one this file
 * was injected with: **`PermissionsGuard` passes correctly** — OWNER_A really
 * owns ORG_A and really holds the permission — **and then a service resolves its
 * target row by that row's own id with no `organization_id` in the predicate.**
 * Nothing fails closed. The caller reaches straight into the other tenant while
 * every guard in the request did its job. Dropping `organizationId` from
 * `OrganizationsService.requireInvitation` is the one-word version of it, and
 * the `DELETE …/invitations/:invitationId` row below goes red under it — on the
 * B-did-not-move assertion, which is the one that distinguishes a leak from a
 * mere wrong status.
 *
 * Both were watched going red under fault injection before this file's
 * assertions were written.
 *
 * ## What this file cannot see
 *
 * `FakeDataSource` enforces no unique constraints and no foreign keys, so
 * nothing here is evidence about `uq_memberships_org_user` or about what a real
 * database does on a cascade.
 */

/**
 * The two shapes a cross-tenant request can take, and why both are needed.
 *
 * - `foreign-organization`: the path names ORG_B. `PermissionsGuard` refuses,
 *   because the actor holds no membership there. Every guarded route has this
 *   shape, because every guarded route names an organization.
 * - `foreign-target`: the path names ORG_A — the guard **passes** — and the
 *   second id names a row of B. Only the service carrying ORG_A into its
 *   predicate refuses this. Routes that take no second id cannot have this
 *   shape, and say so rather than being quietly left out.
 */
type Shape = 'foreign-organization' | 'foreign-target';

interface Case {
  /** The request that must be refused, built from a base path and a target id. */
  readonly foreign: string;
  /**
   * The control it must be indistinguishable from: the same request naming
   * something that was never issued rather than something belonging to B.
   */
  readonly absent: string;
  /** A request by somebody entitled to it, which must succeed. */
  readonly permitted: string;
  /** The actor for `permitted`; every refusal is driven as OWNER_A. */
  readonly permittedActor: UserId;
  /** JSON body for the verbs that need one. */
  readonly body?: Record<string, unknown>;
  /** The status `permitted` answers with. */
  readonly ok: number;
  readonly shape: Shape;
}

const ORGANIZATION_UPDATE = { name: 'Acme Works Renamed' };
const INVITE = { email: 'someone-new@example.test', role: OrgRole.MEMBER };
const GRANT = {
  subjectUserId: MEMBER_A,
  resourceType: RESOURCE_TYPE,
  resourceId: 'record-a-2',
  permission: 'organization:update',
};

/**
 * One row per `@RequirePermission` route, keyed exactly as {@link guardedRoutes}
 * spells it. The key is what pins this table to the decorators: a route whose
 * path or verb changes stops matching and is reported as both missing and
 * unexpected, which is louder and more useful than a silent skip.
 */
const CASES: Record<string, Case> = {
  'GET /organizations/:id': {
    shape: 'foreign-organization',
    foreign: `/organizations/${ORG_B}`,
    absent: `/organizations/${ORG_ABSENT}`,
    permitted: `/organizations/${ORG_A}`,
    permittedActor: OWNER_A,
    ok: 200,
  },
  'PATCH /organizations/:id': {
    shape: 'foreign-organization',
    foreign: `/organizations/${ORG_B}`,
    absent: `/organizations/${ORG_ABSENT}`,
    permitted: `/organizations/${ORG_A}`,
    permittedActor: OWNER_A,
    body: ORGANIZATION_UPDATE,
    ok: 200,
  },
  'DELETE /organizations/:id': {
    shape: 'foreign-organization',
    foreign: `/organizations/${ORG_B}`,
    absent: `/organizations/${ORG_ABSENT}`,
    permitted: `/organizations/${ORG_A}`,
    permittedActor: OWNER_A,
    ok: 204,
  },
  'GET /organizations/:id/members': {
    shape: 'foreign-organization',
    foreign: `/organizations/${ORG_B}/members`,
    absent: `/organizations/${ORG_ABSENT}/members`,
    permitted: `/organizations/${ORG_A}/members`,
    permittedActor: OWNER_A,
    ok: 200,
  },
  'PATCH /organizations/:id/members/:userId': {
    shape: 'foreign-target',
    foreign: `/organizations/${ORG_A}/members/${MEMBER_B}`,
    absent: `/organizations/${ORG_A}/members/${USER_ABSENT}`,
    permitted: `/organizations/${ORG_A}/members/${MEMBER_A}`,
    permittedActor: OWNER_A,
    body: { role: OrgRole.ADMIN },
    ok: 200,
  },
  'DELETE /organizations/:id/members/:userId': {
    shape: 'foreign-target',
    foreign: `/organizations/${ORG_A}/members/${MEMBER_B}`,
    absent: `/organizations/${ORG_A}/members/${USER_ABSENT}`,
    permitted: `/organizations/${ORG_A}/members/${MEMBER_A}`,
    permittedActor: OWNER_A,
    ok: 204,
  },
  'GET /organizations/:id/invitations': {
    shape: 'foreign-organization',
    foreign: `/organizations/${ORG_B}/invitations`,
    absent: `/organizations/${ORG_ABSENT}/invitations`,
    permitted: `/organizations/${ORG_A}/invitations`,
    permittedActor: OWNER_A,
    ok: 200,
  },
  'POST /organizations/:id/invitations': {
    shape: 'foreign-organization',
    foreign: `/organizations/${ORG_B}/invitations`,
    absent: `/organizations/${ORG_ABSENT}/invitations`,
    permitted: `/organizations/${ORG_A}/invitations`,
    permittedActor: OWNER_A,
    body: INVITE,
    ok: 201,
  },
  'DELETE /organizations/:id/invitations/:invitationId': {
    shape: 'foreign-target',
    foreign: `/organizations/${ORG_A}/invitations/${INVITATION_B}`,
    absent: `/organizations/${ORG_A}/invitations/${INVITATION_ABSENT}`,
    permitted: `/organizations/${ORG_A}/invitations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    permittedActor: OWNER_A,
    ok: 200,
  },
  'GET /organizations/:id/grants': {
    shape: 'foreign-organization',
    foreign: `/organizations/${ORG_B}/grants`,
    absent: `/organizations/${ORG_ABSENT}/grants`,
    permitted: `/organizations/${ORG_A}/grants`,
    permittedActor: OWNER_A,
    ok: 200,
  },
  'POST /organizations/:id/grants': {
    shape: 'foreign-organization',
    foreign: `/organizations/${ORG_B}/grants`,
    absent: `/organizations/${ORG_ABSENT}/grants`,
    permitted: `/organizations/${ORG_A}/grants`,
    permittedActor: OWNER_A,
    body: GRANT,
    ok: 201,
  },
  'DELETE /organizations/:id/grants/:grantId': {
    shape: 'foreign-target',
    foreign: `/organizations/${ORG_A}/grants/${GRANT_B}`,
    absent: `/organizations/${ORG_A}/grants/${GRANT_ABSENT}`,
    permitted: `/organizations/${ORG_A}/grants/cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
    permittedActor: OWNER_A,
    ok: 204,
  },
  'GET /organizations/:id/audit': {
    shape: 'foreign-organization',
    foreign: `/organizations/${ORG_B}/audit`,
    absent: `/organizations/${ORG_ABSENT}/audit`,
    permitted: `/organizations/${ORG_A}/audit`,
    permittedActor: OWNER_A,
    ok: 200,
  },
};

const key = (route: GuardedRoute): string => `${route.method} ${route.path}`;

describe('D9 — tenant isolation, over every guarded route the decorators declare', () => {
  let world: DiscriminatingWorld;

  beforeEach(async () => {
    world = await buildWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  const send = (
    method: string, path: string, actor: UserId, body?: Record<string, unknown>,
  ): Promise<Response> => {
    const agent = request(world.app.getHttpServer());
    const verb = method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete';
    const call = agent[verb](path).set('Authorization', world.bearer(actor));
    return body === undefined ? call : call.send(body);
  };

  /**
   * The assertion that keeps the rest honest. Everything below iterates
   * {@link CASES}; without this, deleting a row from `CASES` deletes the
   * coverage and the suite reports green for what is left.
   */
  it('has a cross-tenant case for every @RequirePermission route, and no case for a route that is gone', () => {
    const mounted = guardedRoutes().map(key).sort();
    const tabled = Object.keys(CASES).sort();

    expect(mounted.length).toBeGreaterThan(1);
    expect(tabled).toEqual(mounted);
  });

  it.each(Object.entries(CASES))(
    '%s answers somebody entitled to it',
    async (route, testCase) => {
      const [method] = route.split(' ');
      const response = await send(
        method, testCase.permitted, testCase.permittedActor, testCase.body,
      );

      // The control column. Every route answering 404 to everybody satisfies
      // every refusal below, and this whole file would be a green proof that
      // the server does nothing.
      expect(response.status).toBe(testCase.ok);
    },
  );

  it.each(Object.entries(CASES))(
    '%s hides the other tenant behind the never-issued answer',
    async (route, testCase) => {
      const [method] = route.split(' ');

      const foreign = await send(method, testCase.foreign, OWNER_A, testCase.body);
      const missing = await send(method, testCase.absent, OWNER_A, testCase.body);

      expect(foreign.status).toBe(404);
      expect(foreign.status).toBe(missing.status);
      // Byte for byte. Two bodies that differ only in a `code` one of them
      // carries are two bodies, and the difference is the whole leak the shared
      // status was chosen to close.
      expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(missing.body));
    },
  );

  it.each(Object.entries(CASES))(
    '%s leaves tenant B exactly as it found it',
    async (route, testCase) => {
      const [method] = route.split(' ');

      const before = snapshotTenantB(world.source);
      await send(method, testCase.foreign, OWNER_A, testCase.body);
      const after = snapshotTenantB(world.source);

      // THE ASSERTION THAT CATCHES A LEAK RATHER THAN A WRONG STATUS. A service
      // that resolves its target row with no organization in the predicate
      // mutates B's row and may still answer 404 on the way out; the status
      // comparison above passes and this one does not.
      expect(after).toBe(before);
    },
  );

  /**
   * The `foreign-target` rows are the ones the guard cannot save. They are
   * called out separately so that a future edit which turns them all into
   * `foreign-organization` — by, say, dropping the `:userId` segment — is
   * visible rather than a quietly weaker suite.
   */
  it('exercises the shape the guard cannot catch on every route that has one', () => {
    const targets = Object.entries(CASES)
      .filter(([, testCase]) => testCase.shape === 'foreign-target')
      .map(([route]) => route)
      .sort();

    expect(targets).toEqual([
      'DELETE /organizations/:id/grants/:grantId',
      'DELETE /organizations/:id/invitations/:invitationId',
      'DELETE /organizations/:id/members/:userId',
      'PATCH /organizations/:id/members/:userId',
    ]);
  });

  /**
   * Design ruling R3, asserted directly rather than through its consequences.
   *
   * This is the fail-closed one, and it is still worth asserting: the
   * consequence of getting it wrong is an application nobody can use, and an
   * assertion that names the rule tells whoever broke it *which* rule they
   * broke. It is not what makes this file discriminate — the B-did-not-move
   * assertions above are — and the preamble says so.
   */
  it('hydrates the principal from the credential subject and never from the route parameter', async () => {
    const asked: string[] = [];
    const real = world.principals.hydrate.bind(world.principals);
    jest.spyOn(world.principals, 'hydrate').mockImplementation(async (userId, now) => {
      asked.push(userId);
      return real(userId, now);
    });

    await send('GET', `/organizations/${ORG_A}`, MEMBER_A).then((response) => {
      expect(response.status).toBe(200);
    });

    expect(asked).toEqual([MEMBER_A]);
    expect(asked).not.toContain(ORG_A);
  });
});
