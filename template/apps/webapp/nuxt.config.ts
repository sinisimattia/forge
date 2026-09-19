// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  devtools: {
    enabled: true,
  },

  // `@pinia/nuxt` is the auth store's registration, and it is registration by
  // list rather than by import: nothing in `app/` imports pinia's Nuxt plugin,
  // so removing this line leaves every file typechecking and building and only
  // fails at runtime, with "no active Pinia". `app/test/nuxt-config.spec.ts` imports this
  // config and asserts the entry is here, which is the only assertion available
  // for a wiring that has no behaviour outside a running Nuxt.
  //
  // It also registers `app/stores/` for auto-import — the module's default
  // `storesDirs` is `<srcDir>/stores`, and Nuxt 4's srcDir is `app/`.
  modules: [
    '@nuxtjs/tailwindcss',
    '@nuxt/eslint',
    '@nuxtjs/i18n',
    '@pinia/nuxt',
  ],

  runtimeConfig: {
    // Server-only base URL for backend calls made during SSR. In the Dockerized dev
    // env (compose.yaml) the browser reaches the backend at `localhost:3000`, but the
    // SSR process runs *inside* the webapp container, where that host is unreachable —
    // compose overrides this with `NUXT_API_BASE_SERVER=http://backend:3000`. Falls
    // back to the public `apiBase` below when unset (e.g. local non-container dev).
    apiBaseServer: '',
    public: {
      // Overridden via `NUXT_PUBLIC_API_BASE` (see .env.example / compose.yaml).
      apiBase: 'http://localhost:3000',
      // The product name rendered as the wordmark by `AppLogo`. It lives in runtimeConfig
      // rather than in the component so a deployment can override it (`NUXT_PUBLIC_APP_NAME`)
      // without a rebuild.
      appName: '__FORGE_TITLE__',
    },
  },

  i18n: {
    restructureDir: 'app',
    langDir: 'locales',
    defaultLocale: 'en',
    strategy: 'no_prefix',
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
    ],
  },

  typescript: {
    strict: true,
    // Nuxt generates its own tsconfigs (.nuxt/tsconfig.*.json) and does not extend
    // ../../tsconfig.base.json, so these three are re-stated here to keep the webapp at
    // the same strictness as apps/backend and libs/core, which do extend it. Without
    // this, an unused local/parameter or an inconsistent return type passes
    // `nx typecheck webapp` while identical code fails in the other two packages.
    tsConfig: {
      compilerOptions: {
        noUnusedLocals: true,
        noUnusedParameters: true,
        noImplicitReturns: true,
      },
    },
  },

  // Atomic Design layers register without a path prefix (AppButton, not
  // AtomsAppButton). All four are registered even though `organisms` currently holds
  // nothing: Nuxt tolerates an empty directory here, and registering it now means an
  // organism can be added without also remembering to edit this list.
  components: [
    { path: '~/components/atoms', pathPrefix: false },
    { path: '~/components/molecules', pathPrefix: false },
    { path: '~/components/organisms', pathPrefix: false },
    { path: '~/components/templates', pathPrefix: false },
  ],

  // `app.scss` holds the @tailwind base/components/utilities directives, so it *is* the
  // Tailwind entry. Declaring it via `cssPath` (rather than `css`) stops the module falling
  // back to its bundled default — which otherwise processes the @tailwind directives a
  // second time and logs "Using default Tailwind CSS file".
  tailwindcss: {
    cssPath: '~/assets/scss/app.scss',
  },

  // Every `<style lang="scss">` block gets the variables and mixins prepended, so a
  // component can use `$font-family-logo` or `@include truncate` without importing them.
  // `@use` is not additive the way the old `@import` was: without this, each block would
  // need its own `@use` line and forgetting one is a build error, not a silent miss.
  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          additionalData:
            '@use "~/assets/scss/variables" as *; @use "~/assets/scss/mixins" as *;',
        },
      },
    },
  },

  devServer: {
    port: 3001,
  },
});
