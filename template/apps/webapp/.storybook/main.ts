import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook-vue/nuxt';

/**
 * Where core resolves from, for Storybook only.
 *
 * `__FORGE_SCOPE__/core`'s package `exports` point at `dist/` — CommonJS emitted by `tsc`,
 * in which every `export *` becomes an `__exportStar(require(...))` call that a bundler
 * cannot read statically. Storybook bundled against that `dist/` failed with
 * `"ConsumedTokenError" is not exported by libs/core/dist/auth/errors/index.js`, and it
 * failed that way *after* `core:build` had run, so building core first did not help.
 *
 * So Storybook resolves core to its TypeScript sources, exactly as `vitest.config.ts` does
 * and for the same reason. A consequence worth knowing: `build-storybook` needs no
 * `dependsOn: ['^build']`, because it never reads `libs/core/dist` at all.
 */
const CORE_SRC = fileURLToPath(new URL('../../../libs/core/src', import.meta.url));

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

    return viteConfig;
  },
};

export default config;
