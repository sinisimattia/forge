import type { Config } from 'tailwindcss';

export default {
  content: [
    './app/components/**/*.{vue,ts}',
    './app/composables/**/*.ts',
    './app/layouts/**/*.vue',
    './app/pages/**/*.vue',
    './app/plugins/**/*.ts',
    './app/app.vue',
    './stories/**/*.{ts,tsx}',
  ],
  // Classes assembled at runtime rather than written out in a template — a lookup keyed by
  // a prop value (`AppText`'s `color`, `AppHeading`'s tone) produces the string after
  // Tailwind's content scan has already run, so the utility would otherwise be absent from
  // the emitted CSS and the element would render unstyled. Anything built by concatenation
  // belongs here.
  safelist: [
    'text-neutral-900',
    'text-success-600',
    'text-warning-600',
    'text-error-600',
  ],
  theme: {
    // `colors` REPLACES Tailwind's default palette rather than extending it: the component
    // library speaks only in these semantic names (`bg-surface`, `text-primary-600`,
    // `border-error-200`), and leaving the stock palette in place invites a mix of the two
    // vocabularies. A generated project re-points these hex values at its own brand and
    // every component follows, which is the whole reason the indirection exists.
    //
    // Replacing the map also means `bg-slate-900` and friends no longer exist — Tailwind
    // emits nothing at all for a class it does not know, so a stray stock colour renders as
    // no style rather than as an error. If something looks unstyled, check it is spelled in
    // this vocabulary first.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      surface: '#ffffff',
      backdrop: '#000000',

      primary: {
        50: '#eef2ff',
        100: '#e0e7ff',
        200: '#c7d2fe',
        300: '#a5b4fc',
        400: '#818cf8',
        500: '#6366f1',
        600: '#4f46e5',
        700: '#4338ca',
        800: '#3730a3',
        900: '#312e81',
        DEFAULT: '#4f46e5',
      },

      neutral: {
        50: '#f9fafb',
        100: '#f3f4f6',
        200: '#e5e7eb',
        300: '#d1d5db',
        400: '#9ca3af',
        500: '#6b7280',
        600: '#4b5563',
        700: '#374151',
        800: '#1f2937',
        900: '#111827',
      },

      error: {
        50: '#fef2f2',
        100: '#fee2e2',
        200: '#fecaca',
        300: '#fca5a5',
        500: '#ef4444',
        600: '#dc2626',
        700: '#b91c1c',
        900: '#7f1d1d',
        DEFAULT: '#dc2626',
      },

      success: {
        50: '#f0fdf4',
        100: '#dcfce7',
        200: '#bbf7d0',
        300: '#86efac',
        600: '#16a34a',
        700: '#15803d',
        DEFAULT: '#16a34a',
      },

      warning: {
        50: '#fefce8',
        100: '#fef9c3',
        200: '#fef08a',
        500: '#eab308',
        600: '#ca8a04',
        700: '#a16207',
        DEFAULT: '#eab308',
      },

      info: {
        50: '#eff6ff',
        100: '#dbeafe',
        200: '#bfdbfe',
        600: '#2563eb',
        700: '#1d4ed8',
        800: '#1e40af',
        DEFAULT: '#1d4ed8',
      },
    },
    extend: {
      // Minimum touch-target size (WCAG 2.5.5), reused across interactive controls.
      minHeight: {
        touch: '44px',
        // Centering region for a full-page form: viewport minus header/footer chrome
        // (AuthTemplate).
        'screen-offset': 'calc(100vh - 10rem)',
      },
      minWidth: {
        touch: '44px',
      },
    },
  },
  plugins: [],
} satisfies Config;
