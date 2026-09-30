import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The module list `nuxt.config.ts` declares.
 *
 * ## Why a config assertion, when behaviour is always the better thing to pin
 *
 * Because there is no behaviour to pin. `@pinia/nuxt` is registration **by
 * list**: nothing in `app/` imports pinia's Nuxt plugin, so removing that entry
 * leaves every file typechecking, every unit test green — they install pinia
 * themselves — and `nuxt build` succeeding. It fails only in a running
 * application, with "no active Pinia", on every page that reads the auth store,
 * which is every guarded page there is.
 *
 * Given that, the choice is between this assertion and none. It is deliberately
 * the narrow kind: it imports the shipped config and reads the array the
 * application really ships, rather than re-stating a config object in a fixture
 * and comparing that to itself.
 *
 * ## What it does not claim
 *
 * That the module works, that pinia is installed, or that the store is
 * auto-imported. Those are the generated-project gate's and the running app's.
 * This says one thing: the entry has not been removed.
 */

/** The shape this spec reads off the config. Nuxt's own type is much larger. */
interface ConfigShape {
  modules?: string[];
  components?: { path: string }[];
  routeRules?: Record<string, { ssr?: boolean; headers?: Record<string, string> }>;
}

/**
 * `defineNuxtConfig`, declared for the benefit of this program only.
 *
 * Importing `nuxt.config.ts` from a spec pulls it into the app's TypeScript
 * program, where `defineNuxtConfig` is not a name: Nuxt puts that global in the
 * separate tsconfig it generates *for* the config file. Importing it from
 * `nuxt/config` instead was tried and is worse — that signature is the base
 * `NuxtConfig` without the augmentations modules add, so `tailwindcss: { … }`
 * stops being a known property and the config stops typechecking for real.
 *
 * Declaring it generic and pass-through here keeps the config file checked the
 * way it was before this spec existed — which is to say, by Nuxt's own program,
 * with the real types — and lets this one read it.
 */
declare global {
  var defineNuxtConfig: <T>(config: T) => T;
}

describe('nuxt.config.ts', () => {
  let config: ConfigShape;

  beforeEach(async () => {
    // The shipped file, evaluated the way Nuxt evaluates it: `defineNuxtConfig`
    // is the identity function, so what comes back is the object the application
    // really ships.
    vi.stubGlobal('defineNuxtConfig', (given: ConfigShape) => given);
    vi.resetModules();
    const module = await import('../../nuxt.config');
    config = module.default as unknown as ConfigShape;
  });

  it('registers the store module the auth store needs', () => {
    expect(config.modules).toContain('@pinia/nuxt');
  });

  // The four Atomic Design layers, which the layering gate and this list have to
  // agree about. Asserted here because the same "registration by list" argument
  // applies: a layer dropped from this array stops auto-importing and nothing
  // else notices until a component renders as an unknown tag.
  it('still registers all four component layers', () => {
    expect(config.components?.map((entry) => entry.path)).toEqual([
      '~/components/atoms',
      '~/components/molecules',
      '~/components/organisms',
      '~/components/templates',
    ]);
  });

  // Nuxt puts the request URL — query string included — into the payload of any
  // page it renders on the server (`payload.path`), whether or not the page
  // reads it. The challenge page can be reached with a single-use token in its
  // query, so it is rendered by the browser alone; this entry is the only thing
  // that says so, and it has no behaviour under the runner to assert instead.
  // Confirmed against a real build: with the rule, a request carrying a
  // sentinel token comes back with no trace of it; without, the sentinel is in
  // `__NUXT_DATA__`.
  it('renders the challenge page on the client only', () => {
    expect(config.routeRules?.['/mfa/challenge']?.ssr).toBe(false);
  });

  // The referrer policy is a response header on the route, not a tag the page
  // adds: the page's own `<meta>` would arrive after the requests it is meant to
  // cover. Only the header is there for the first of them.
  it('serves the challenge page with a no-referrer policy as a header', () => {
    expect(config.routeRules?.['/mfa/challenge']?.headers?.['referrer-policy']).toBe('no-referrer');
  });
});
