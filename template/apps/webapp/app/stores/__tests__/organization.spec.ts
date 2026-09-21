import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type {
  MembershipId,
  OrganizationId,
  OrganizationJSON,
} from '__FORGE_SCOPE__/core/organizations/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import type { ApiRequest } from '~/types';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import { useAuthStore } from '~/stores/auth';
import { useOrganizationStore } from '~/stores/organization';

/**
 * The organization store, driven against a model of the backend.
 *
 * What this store is *for* — see its own TSDoc — is being the one place
 * `useCan` reads a principal from, and the one place that principal is ever
 * written: `GET /users/me/principal`, hydrated whole, never assembled from
 * separate reads. Every test below is in service of that: that hydration
 * reads the real endpoint, that a full page load does not decide before it
 * answers, and that a caller who has not signed in gets a settled `false`
 * rather than an unresolved one.
 */

const PLAINTEXT = 'a correct horse battery staple';
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

const ACTOR_ID = 'stub-User-1' as UserId;
const ACTOR: UserJSON = {
  id: ACTOR_ID,
  email: 'ada@example.test',
  displayName: 'Ada',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

const ORG_ID = 'stub-Organization-1' as OrganizationId;
const ORG: OrganizationJSON = {
  id: ORG_ID,
  name: 'Acme',
  slug: 'acme',
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

function seedWorld(backend: StubBackend): void {
  backend.putUser(ACTOR, PLAINTEXT);
  backend.putOrganization(ORG);
  backend.putMembership({
    id: 'stub-Membership-1' as MembershipId,
    organizationId: ORG_ID,
    userId: ACTOR_ID,
    role: OrgRole.ADMIN,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });
}

describe('stores/organization', () => {
  let backend: StubBackend;

  beforeEach(() => {
    stubNuxtAutoImports();
    vi.stubGlobal('useRuntimeConfig', () => ({
      apiBaseServer: '',
      public: { apiBase: 'http://backend.test' },
    }));
    setActivePinia(createPinia());
    backend = stubBackend();
    seedWorld(backend);
    useAuthStore().adoptTransport(backend.client);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts unresolved, not refusing', () => {
    const store = useOrganizationStore();
    expect(store.ready).toBe(false);
    expect(store.principal).toBeNull();
  });

  it('settles to no principal for a visitor who never signs in', async () => {
    const store = useOrganizationStore();
    await store.initialize();
    expect(store.ready).toBe(true);
    expect(store.principal).toBeNull();
  });

  it('hydrates the actor\'s own memberships and grants from GET /users/me/principal', async () => {
    const auth = useAuthStore();
    await auth.login(ACTOR.email, PLAINTEXT);
    const store = useOrganizationStore();

    await store.initialize();

    expect(store.ready).toBe(true);
    expect(store.principal).not.toBeNull();
    expect(store.principal?.userId).toBe(ACTOR_ID);
    expect(store.principal?.platformRole).toBe(PlatformRole.PLATFORM_USER);
    expect(store.principal?.memberships).toEqual([
      { organizationId: ORG_ID, role: OrgRole.ADMIN },
    ]);
    expect(store.principal?.grants).toEqual([]);
  });

  // Same reasoning as `stores/auth.ts`'s own "asks the question once": one
  // hydration per page load, however many guards or components ask.
  it('hydrates once however many times initialize is asked', async () => {
    const auth = useAuthStore();
    await auth.login(ACTOR.email, PLAINTEXT);
    let principalRequests = 0;
    const world = backend;
    auth.adoptTransport(async <T>(request: ApiRequest): Promise<T> => {
      if (request.path === '/users/me/principal') principalRequests += 1;
      return world.client<T>(request);
    });
    const store = useOrganizationStore();

    await store.initialize();
    await store.initialize();
    await store.initialize();

    expect(principalRequests).toBe(1);
  });

  it('re-hydrates on demand, unlike initialize', async () => {
    const auth = useAuthStore();
    await auth.login(ACTOR.email, PLAINTEXT);
    const store = useOrganizationStore();
    await store.initialize();

    await store.hydrate();
    await store.hydrate();

    expect(store.principal?.userId).toBe(ACTOR_ID);
  });

  // The `unknown`-equivalent state `middleware/permission.ts`'s own TSDoc
  // explains: nothing may decide from a principal that has not been read yet.
  // Held open here, and the store observed **not having decided**, exactly as
  // `middleware/auth.spec.ts`'s "waits for the answer instead of deciding from
  // 'unknown'" does for the auth store.
  it('waits for the hydration instead of deciding from "not ready"', async () => {
    const auth = useAuthStore();
    await auth.login(ACTOR.email, PLAINTEXT);

    setActivePinia(createPinia());
    const freshAuth = useAuthStore();
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const world = backend;
    freshAuth.adoptTransport(async <T>(request: ApiRequest): Promise<T> => {
      await held;
      return world.client<T>(request);
    });
    // A store built after `freshAuth` is adopted, so `useOrganizationStore`
    // resolves the same instance `initialize` reads its actor from.
    const store = useOrganizationStore();

    let settled = false;
    const running = store.initialize().then(() => {
      settled = true;
    });
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();

    expect(settled).toBe(false);
    expect(store.ready).toBe(false);
    expect(store.principal).toBeNull();

    release();
    await running;
    expect(settled).toBe(true);
    expect(store.ready).toBe(true);
  });

  it('answers with no principal, rather than throwing, when the read fails', async () => {
    const auth = useAuthStore();
    await auth.login(ACTOR.email, PLAINTEXT);
    auth.adoptTransport(async () => {
      throw new Error('network is down');
    });
    const store = useOrganizationStore();

    await expect(store.initialize()).resolves.toBeUndefined();
    expect(store.ready).toBe(true);
    expect(store.principal).toBeNull();
  });

  it('holds the active organization, set independently of the principal', () => {
    const store = useOrganizationStore();
    expect(store.activeOrganizationId).toBeNull();

    store.setActiveOrganization(ORG_ID);
    expect(store.activeOrganizationId).toBe(ORG_ID);

    store.setActiveOrganization(null);
    expect(store.activeOrganizationId).toBeNull();
  });
});
