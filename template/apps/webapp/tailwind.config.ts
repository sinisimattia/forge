import type { Config } from 'tailwindcss';

export default {
  content: [
    './app/components/**/*.{vue,ts}',
    './app/layouts/**/*.vue',
    './app/pages/**/*.vue',
    './app/app.vue',
    './stories/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // Minimum touch-target size (WCAG 2.5.5), reused across interactive controls.
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
    },
  },
  plugins: [],
} satisfies Config;
