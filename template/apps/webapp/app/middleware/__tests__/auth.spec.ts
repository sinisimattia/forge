import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest } from '~/types';
import type { Harness, Middleware } from './harness';
import { afterAFullPageLoad, harness, NAVIGATED, route } from './harness';

/**
 * The `auth` route middleware, as Nuxt registers it.
 *
 * **The import path is half of the test.** Nuxt finds a route middleware by the
 * name of its file and nothing in the application imports it, so a rename or a
 * delete changes which pages are protected and is invisible to a spec that got
 * the handler some other way. Importing `~/middleware/auth` means the file
 * moving is a failing import.
 *
 * It is a dynamic import because the module calls `defineNuxtRouteMiddleware`
 * while it is evaluated, and that global has to exist by then.
 */
describe('middleware/auth', () => {
  let world: Harness;
  let middleware: Middleware;

  beforeEach(async () => {
    world = harness();
    vi.resetModules();
    const module = await import('~/middleware/auth');
    middleware = module.default as unknown as Middleware;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Not decoration: a module that exported a bare function would run, and would
  // be one refactor away from being called something Nuxt does not look for.
  it('is registered as a route middleware', () => {
    expect(world.registered).toHaveLength(1);
    expect(world.registered[0]).toBe(middleware);
  });

  // The literal `'/login'`, not the `SIGN_IN_PATH` the middleware imports.
  // Comparing its answer against the binding it computed the answer from would
  // agree with itself whatever either one said.
  it('sends an anonymous visitor to sign in, with where they were going', async () => {
    const answer = await middleware(route('/account/settings?tab=security'));

    expect(world.navigateTo).toHaveBeenCalledWith({
      path: '/login',
      query: { redirect: '/account/settings?tab=security' },
    });
    expect(answer).toBe(NAVIGATED);
  });

  it('lets a signed-in visitor through', async () => {
    await afterAFullPageLoad(world.backend);

    const answer = await middleware(route('/account'));

    expect(world.navigateTo).not.toHaveBeenCalled();
    expect(answer).toBeUndefined();
  });

  /**
   * The `unknown` state, which is the reason `status` has three values.
   *
   * A full page load starts with no credential in memory, so for as long as the
   * renewal is in flight there is no answer. A guard that read `isAuthenticated`
   * at that moment would find `false` — for a signed-in person — and bounce them
   * to the sign-in page on every hard refresh.
   *
   * The renewal is held open here and the middleware is observed **not having
   * decided**: not resolved, and `navigateTo` not called. Then it is released,
   * and the visitor is let through. Asserting only the end state would pass for
   * a middleware that redirected first and corrected itself afterwards.
   */
  it('waits for the answer instead of deciding from "unknown"', async () => {
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
    const running = middleware(route('/account')).then((answer) => {
      settled = true;
      return answer;
    });
    // Several turns of the microtask queue: enough for anything that was going
    // to decide without waiting to have decided.
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();

    expect(settled).toBe(false);
    expect(world.navigateTo).not.toHaveBeenCalled();
    expect(store.status).toBe('unknown');

    release();
    await expect(running).resolves.toBeUndefined();
    expect(world.navigateTo).not.toHaveBeenCalled();
    expect(store.status).toBe('authenticated');
  });

  // One renewal for the whole page, not one per guard. Two guards run on a
  // navigation through a layout that declares one and a page that declares
  // another, and the second and third renewals are the concurrent-rotation
  // failure by another route.
  it('asks the question once however many pages declare it', async () => {
    await afterAFullPageLoad(world.backend);
    const before = world.backend.refreshRequests();

    await middleware(route('/account'));
    await middleware(route('/account/settings'));

    expect(world.backend.refreshRequests() - before).toBe(1);
  });
});
