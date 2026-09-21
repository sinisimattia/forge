import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type {
  MembershipId,
  OrganizationId,
  OrganizationJSON,
} from '__FORGE_SCOPE__/core/organizations/types';
import type { ApiRequest } from '~/types';
import type { Harness, Middleware } from './harness';
import { ACTOR, afterAFullPageLoad, harness, NAVIGATED, route } from './harness';

/**
 * The `permission` route middleware, as Nuxt registers it.
 *
 * **The import path is half of the test**, for the identical reason
 * `middleware/auth.spec.ts` gives: Nuxt finds a route middleware by the name
 * of its file and nothing in the application imports it, so a rename or a
 * delete changes which pages are protected and is invisible to a spec that
 * got the handler some other way. Importing `~/middleware/permission` means
 * the file moving is a failing import.
 *
 * This spec does not mock `can` — `useCan.spec.ts` is where the delegation
 * itself is pinned. What this file asserts is the plumbing around it: that
 * the file is found where pages name it, that it waits for the principal
 * before deciding, and that its decision follows a real hydrated principal
 * through to a real (if advisory) redirect.
 */
describe('middleware/permission', () => {
  const SEEDED_AT = '2026-01-01T00:00:00.000Z';
  const ORG_ID = 'stub-Organization-1' as OrganizationId;
  const ORG: OrganizationJSON = {
    id: ORG_ID,
    name: 'Acme',
    slug: 'acme',
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    deletedAt: null,
  };

  let world: Harness;
  let middleware: Middleware;

  beforeEach(async () => {
    world = harness();
    world.backend.putOrganization(ORG);
    world.backend.putMembership({
      id: 'stub-Membership-1' as MembershipId,
      organizationId: ORG_ID,
      userId: ACTOR.id,
      role: OrgRole.MEMBER,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
    vi.resetModules();
    const module = await import('~/middleware/permission');
    middleware = module.default as unknown as Middleware;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is registered as a route middleware', () => {
    expect(world.registered).toHaveLength(1);
    expect(world.registered[0]).toBe(middleware);
  });

  // A page that declares `middleware: 'permission'` but names no `permission`
  // in its route meta is not a page this middleware has an opinion about —
  // see its own TSDoc. Asserted without signing anybody in, so this passing
  // is not "the actor happened to be allowed".
  it('lets a page through that names no permission', async () => {
    const answer = await middleware(route('/organizations'));

    expect(world.navigateTo).not.toHaveBeenCalled();
    expect(answer).toBeUndefined();
  });

  it('lets an actor with the permission through', async () => {
    await afterAFullPageLoad(world.backend);

    const answer = await middleware(route('/organizations/abc', {}, {
      params: { organizationId: ORG_ID },
      meta: { permission: 'organization:read' },
    }));

    expect(world.navigateTo).not.toHaveBeenCalled();
    expect(answer).toBeUndefined();
  });

  // `MEMBER` holds `organization:read` but not `member:invite`
  // (`ROLE_PERMISSIONS`) — the real rule, reached through the real hydrated
  // principal, no mock in this file.
  it('sends an actor without the permission to where they can go, not where they were headed', async () => {
    await afterAFullPageLoad(world.backend);

    const answer = await middleware(route('/organizations/abc', {}, {
      params: { organizationId: ORG_ID },
      meta: { permission: 'member:invite' },
    }));

    // The literal `'/'`, not the `SIGNED_IN_HOME` binding this middleware
    // imports — comparing its answer against the binding it computed the
    // answer from would agree with itself whatever either one said.
    expect(world.navigateTo).toHaveBeenCalledWith('/');
    expect(answer).toBe(NAVIGATED);
  });

  // The `permission` middleware's own reason for existing at all applied to
  // itself: `middleware/auth.spec.ts`'s "waits for the answer instead of
  // deciding from 'unknown'", one layer up. Held open here, and the
  // middleware observed **not having decided** — not resolved, `navigateTo`
  // not called — then released.
  it('waits for the principal instead of deciding from "not ready"', async () => {
    const store = await afterAFullPageLoad(world.backend);
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const world_ = world;
    store.adoptTransport(async <T>(request: ApiRequest): Promise<T> => {
      await held;
      return world_.backend.client<T>(request);
    });

    let settled = false;
    const running = middleware(route('/organizations/abc', {}, {
      params: { organizationId: ORG_ID },
      meta: { permission: 'organization:read' },
    })).then((answer) => {
      settled = true;
      return answer;
    });
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();

    expect(settled).toBe(false);
    expect(world.navigateTo).not.toHaveBeenCalled();

    release();
    await expect(running).resolves.toBeUndefined();
    expect(settled).toBe(true);
    expect(world.navigateTo).not.toHaveBeenCalled();
  });
});
