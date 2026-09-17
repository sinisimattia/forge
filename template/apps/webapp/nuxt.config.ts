// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  devtools: {
    enabled: true,
  },

  modules: [
    '@nuxtjs/tailwindcss',
    '@nuxt/eslint',
    '@nuxtjs/i18n',
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
  },

  // Atomic Design layers register without a path prefix (AppButton, not
  // AtomsAppButton). Only `atoms` exists in this skeleton; Phase 2 adds the
  // `molecules` / `organisms` / `templates` entries alongside those directories.
  components: [
    { path: '~/components/atoms', pathPrefix: false },
  ],

  tailwindcss: {
    cssPath: '~/assets/css/main.css',
  },

  devServer: {
    port: 3001,
  },
});
