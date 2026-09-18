import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    globals: false,
    include: ['app/**/*.spec.ts'],
  },
  resolve: {
    // The array form, not the object form: only an array entry can carry a
    // RegExp `find` with a `$1` capture, and core is addressed by subpath.
    alias: [
      // Must come first. Vite requires the character after a bare alias to be `/`,
      // so `@` does not swallow `__FORGE_SCOPE__/...` — but order it defensively anyway.
      {
        find: /^__FORGE_SCOPE__\/core\/(.*)$/,
        replacement: fileURLToPath(new URL('../../libs/core/src/$1/index.ts', import.meta.url)),
      },
      { find: '~', replacement: fileURLToPath(new URL('./app', import.meta.url)) },
      { find: '@', replacement: fileURLToPath(new URL('./app', import.meta.url)) },
    ],
  },
});
