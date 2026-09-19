import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Harness, Middleware } from './harness';
import { afterAFullPageLoad, harness, NAVIGATED, route } from './harness';

/**
 * The `guest` route middleware, and the open redirect it is the last thing in
 * front of.
 *
 * Imported by the exact path Nuxt registers it at, for the reason
 * `middleware/auth.spec.ts` gives.
 *
 * ## Why the redirect table is here and not on the helper
 *
 * `localRedirect` has its own obvious unit test and it would be a weaker one:
 * what has to be true is that **the shipped middleware** refuses these values,
 * which is a claim about the middleware calling the helper at all. A guard that
 * stopped calling it would leave a helper test green.
 */
describe('middleware/guest', () => {
  let world: Harness;
  let middleware: Middleware;

  beforeEach(async () => {
    world = harness();
    vi.resetModules();
    const module = await import('~/middleware/guest');
    middleware = module.default as unknown as Middleware;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is registered as a route middleware', () => {
    expect(world.registered).toHaveLength(1);
    expect(world.registered[0]).toBe(middleware);
  });

  it('lets an anonymous visitor onto the sign-in page', async () => {
    const answer = await middleware(route('/login'));

    expect(world.navigateTo).not.toHaveBeenCalled();
    expect(answer).toBeUndefined();
  });

  it('sends a signed-in visitor away from it', async () => {
    await afterAFullPageLoad(world.backend);

    const answer = await middleware(route('/login'));

    expect(world.navigateTo).toHaveBeenCalledWith('/');
    expect(answer).toBe(NAVIGATED);
  });

  it('waits for the answer instead of deciding from "unknown"', async () => {
    const store = await afterAFullPageLoad(world.backend);

    await middleware(route('/login'));

    // It did not read `isAuthenticated` while the answer was still `unknown`;
    // had it, a signed-in visitor would have been let onto the sign-in page.
    expect(store.status).toBe('authenticated');
    expect(world.navigateTo).toHaveBeenCalledWith('/');
  });

  it('goes back to where the visitor was interrupted', async () => {
    await afterAFullPageLoad(world.backend);

    await middleware(route('/login', { redirect: '/account' }));

    expect(world.navigateTo).toHaveBeenCalledWith('/account');
  });

  /**
   * Every form of "somewhere that is not this site", refused.
   *
   * The second row is the one the brief names and the one people forget.
   * `//elsewhere.example/x` starts with a slash, so it passes any check written
   * as "must be a path", and a browser reads it as `https://elsewhere.example/x`
   * — a working open redirect on a sign-in page, which is the highest-value
   * place in an application to have one.
   *
   * The third is the same attack spelled with a backslash, which browsers
   * normalise in the authority position. The fourth is how a value is smuggled
   * past a parser that strips control characters. The fifth is what a repeated
   * query parameter arrives as.
   */
  it.each([
    ['an absolute URL', 'https://elsewhere.example/x'],
    ['a protocol-relative URL', '//elsewhere.example/x'],
    ['a backslash-authority URL', '/\\elsewhere.example/x'],
    ['a path carrying a control character', `/${String.fromCharCode(9)}/elsewhere.example`],
    ['a value that is not a path at all', 'elsewhere.example'],
  ])('refuses %s and falls back to the default', async (_name, redirect) => {
    await afterAFullPageLoad(world.backend);

    await middleware(route('/login', { redirect }));

    expect(world.navigateTo).toHaveBeenCalledWith('/');
    expect(world.navigateTo).not.toHaveBeenCalledWith(redirect);
  });

  it('refuses a repeated redirect parameter', async () => {
    await afterAFullPageLoad(world.backend);

    await middleware(route('/login', { redirect: ['/account', '//elsewhere.example'] }));

    expect(world.navigateTo).toHaveBeenCalledWith('/');
  });
});
