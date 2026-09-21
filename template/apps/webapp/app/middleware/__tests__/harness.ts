import { vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import { useAuthStore } from '~/stores/auth';

/**
 * What the two middleware specs need, and nothing either of them defines twice.
 *
 * It sets up globals and a world. It deliberately does **not** define a
 * middleware, a store or a route guard of its own: the specs import the shipped
 * files by the exact path Nuxt registers them at, so a file that is renamed or
 * deleted is a failing import rather than a page that quietly stopped being
 * guarded.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
export const PLAINTEXT = 'a correct horse battery staple';

/** One instant for the world, which nothing compares. */
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

/** The one account these worlds hold: verified, active, usable. */
export const ACTOR: UserJSON = {
  id: 'stub-User-1' as UserId,
  email: 'ada@example.test',
  displayName: 'Ada',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

/** What `navigateTo` returns, so a spec can tell "it redirected" from "it let them through". */
export const NAVIGATED = Symbol('navigateTo');

/** The shape a route middleware reads off the route it is given. */
export interface RouteStub {
  fullPath: string;
  query: Record<string, unknown>;
  /** Route params, as `permission.spec.ts` needs to name an organization. */
  params: Record<string, unknown>;
  /** Route meta, as `permission.spec.ts` needs to name a permission. */
  meta: Record<string, unknown>;
}

/** A route middleware, as the specs call one. */
export type Middleware = (to: RouteStub) => Promise<unknown>;

/** The world, the globals and the store the specs drive. */
export interface Harness {
  backend: StubBackend;
  /** Every route middleware the loaded modules registered, in order. */
  registered: unknown[];
  /** `navigateTo`, spied. */
  navigateTo: ReturnType<typeof vi.fn>;
  /**
   * The store the middleware will find, already pointed at the world.
   *
   * Adopted here and not left to each test, because a store that has not adopted
   * one builds the browser transport from `useRuntimeConfig` and renews against
   * a real address — which is a DNS lookup per test, an unbounded wait when the
   * network is slow, and a test that depends on a hostname failing to resolve.
   * Observed: two specs passing while `getaddrinfo ENOTFOUND backend.test` was
   * printed underneath them.
   */
  store: ReturnType<typeof useAuthStore>;
}

/**
 * Installs the Nuxt globals a middleware module needs and builds an empty world.
 *
 * Call it **before** importing a middleware: the module calls
 * `defineNuxtRouteMiddleware` as it is evaluated, so the global has to exist by
 * then, and that is why the specs import dynamically rather than at the top.
 */
export function harness(): Harness {
  stubNuxtAutoImports();
  vi.stubGlobal('useRuntimeConfig', () => ({
    apiBaseServer: '',
    public: { apiBase: 'http://backend.test' },
  }));
  const registered: unknown[] = [];
  vi.stubGlobal('defineNuxtRouteMiddleware', (handler: unknown) => {
    registered.push(handler);
    return handler;
  });
  const navigateTo = vi.fn(() => NAVIGATED);
  vi.stubGlobal('navigateTo', navigateTo);
  setActivePinia(createPinia());

  const backend = stubBackend();
  backend.putUser(ACTOR, PLAINTEXT);
  const store = useAuthStore();
  store.adoptTransport(backend.client);
  return { backend, registered, navigateTo, store };
}

/**
 * Signs the actor in, then hands back a store that has never been asked.
 *
 * The two steps are the point. Signing in leaves a live session **and a renewal
 * cookie** in the world; replacing the pinia gives a store whose `status` is
 * `unknown`, which is exactly the state a hard page refresh produces. A spec
 * that just set `status` to `authenticated` by hand would be testing a store it
 * had written rather than the one the application runs.
 *
 * @param backend - the world to sign in to
 * @returns the fresh store, with the world's transport adopted
 */
export async function afterAFullPageLoad(
  backend: StubBackend,
): Promise<ReturnType<typeof useAuthStore>> {
  const first = useAuthStore();
  first.adoptTransport(backend.client);
  await first.login(ACTOR.email, PLAINTEXT);

  setActivePinia(createPinia());
  const fresh = useAuthStore();
  fresh.adoptTransport(backend.client);
  return fresh;
}

/** A route, as a middleware reads one. */
export function route(
  fullPath: string,
  query: Record<string, unknown> = {},
  extra: { params?: Record<string, unknown>; meta?: Record<string, unknown> } = {},
): RouteStub {
  return { fullPath, query, params: extra.params ?? {}, meta: extra.meta ?? {} };
}
