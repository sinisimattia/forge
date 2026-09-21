import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook-vue/nuxt';

/**
 * Where core resolves from, for Storybook only.
 *
 * `__FORGE_SCOPE__/core`'s package `exports` point at `dist/` — CommonJS emitted by `tsc`,
 * in which every `export *` becomes an `__exportStar(require(...))` call that Rollup cannot
 * read statically. Storybook builds with Rollup (see below), so bundling a story against
 * `dist/` fails with `"ConsumedTokenError" is not exported by libs/core/dist/auth/errors/
 * index.js` — and it fails that way *after* `core:build` has run, so building core first
 * does not help. `nuxt build` is unaffected because Nuxt 4.5 bundles with Rolldown, which
 * does read those re-exports.
 *
 * So Storybook resolves core to its TypeScript sources, exactly as `vitest.config.ts` does
 * and for the same reason. A consequence worth knowing: `build-storybook` needs no
 * `dependsOn: ['^build']`, because it never reads `libs/core/dist` at all.
 */
const CORE_SRC = fileURLToPath(new URL('../../../libs/core/src', import.meta.url));

/**
 * The Nuxt plugin that has to come out of Storybook's Vite config.
 *
 * ## The failure it caused, because the error named nothing involved
 *
 * `build-storybook` failed from the day it was added until 2026-09-21 with:
 *
 *     ✓ 0 modules transformed.
 *     [vite:build-html] Missing field `moduleType`
 *
 * Nothing in that names Nuxt, and `vite:build-html` is a red herring — it is simply the
 * plugin that owned the transform chain for `iframe.html`, the first module in the graph.
 *
 * The mechanism: Nuxt 4.5's `@nuxt/vite-builder` ships a `nuxt:replace` plugin whose
 * `applyToEnvironment` returns `replacePlugin()` from the `rolldown` package — a *native*
 * Rust plugin, valid because Nuxt 4.5 builds on Vite 8 (Rolldown). Storybook does not use
 * Nuxt's builder: `@storybook/builder-vite@9` runs Vite 7, which is Rollup. Rollup calls
 * the native plugin's `transform` with Rollup's argument shape, and the NAPI binding
 * rejects it for a field Rollup has no concept of: `moduleType`. It throws on the entry
 * HTML, so no module is ever transformed and the count is zero.
 *
 * ## Why removing it is safe rather than merely expedient
 *
 * `nuxt:replace` exists to apply the `import.meta.*` entries of `config.define`. Vite's own
 * `vite:define` plugin applies exactly those same entries from exactly that same object, so
 * in a Rollup build the Nuxt plugin is redundant as well as fatal. This was measured, not
 * assumed: with it removed, a story exporting `[import.meta.client, import.meta.server,
 * import.meta.dev]` compiles to `[!0,!1,!1]`, and no `import.meta.*` other than the
 * legitimately-preserved `import.meta.url` survives anywhere in the built output.
 *
 * ## When to delete this
 *
 * When `@storybook-vue/nuxt` ships a stable release that builds with Vite 8, the whole
 * mismatch goes away. Until then the removal is asserted rather than attempted: if the
 * plugin is ever renamed, a silent no-op here would resurrect the `moduleType` error with
 * its original uselessness, so this throws instead and says what changed.
 */
const ROLLDOWN_PLUGIN_FROM_NUXT = 'nuxt:replace';

const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  framework: '@storybook-vue/nuxt',

  core: {
    disableWhatsNewNotifications: true,
  },

  viteFinal(viteConfig) {
    // The array form is required: only an array entry can carry a RegExp `find` with a `$1`
    // capture, and core is addressed by subpath. Nuxt hands `resolve.alias` over as an
    // object, so it is converted rather than replaced — dropping those entries would
    // unresolve `~`, `#app`, `#build` and every other alias the components rely on.
    const existingAlias = viteConfig.resolve?.alias ?? {};
    const aliasArray = Array.isArray(existingAlias)
      ? existingAlias
      : Object.entries(existingAlias).map(([find, replacement]) => ({ find, replacement }));

    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: [
        { find: /^__FORGE_SCOPE__\/core\/(.*)$/, replacement: `${CORE_SRC}/$1/index.ts` },
        ...aliasArray,
      ],
    };

    let removed = 0;
    const withoutRolldownPlugin = (plugin: unknown): unknown => {
      if (Array.isArray(plugin)) {
        return plugin.map(withoutRolldownPlugin).filter((entry) => entry !== null);
      }
      if (
        plugin !== null
        && typeof plugin === 'object'
        && (plugin as { name?: unknown }).name === ROLLDOWN_PLUGIN_FROM_NUXT
      ) {
        removed += 1;
        return null;
      }
      return plugin;
    };

    viteConfig.plugins = withoutRolldownPlugin(viteConfig.plugins) as typeof viteConfig.plugins;

    if (removed === 0) {
      throw new Error(
        `Storybook's Vite config no longer contains a '${ROLLDOWN_PLUGIN_FROM_NUXT}' plugin. `
        + 'That plugin is Nuxt\'s Rolldown-native `replace`, which a Rollup-based Storybook '
        + 'build cannot call — removing it is the only reason `build-storybook` works. If Nuxt '
        + 'renamed it, rename it here. If Storybook now builds with Vite 8, delete this whole '
        + 'block instead of leaving a no-op that would let the `moduleType` failure back in.',
      );
    }

    return viteConfig;
  },
};

export default config;
