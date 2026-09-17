// @ts-check
import stylistic from '@stylistic/eslint-plugin';

/**
 * Shared house style — the single source of truth for code formatting
 * across every package (apps/backend, apps/webapp, libs/core).
 *
 * Prettier was retired in favour of ESLint owning formatting end to end:
 * `@stylistic/eslint-plugin` is the maintained successor to the formatting
 * rules that ESLint core and `@typescript-eslint` both deprecated. Whitespace
 * concerns (indent width, EOL, final newline, trailing whitespace) are shared
 * with editors via the root `.editorconfig`.
 *
 * House style: semicolons, single quotes, trailing commas on multiline,
 * 2-space indent, one-true-brace.
 *
 * CAVEAT: ESLint cannot reflow code to a print width the way Prettier did.
 * `max-len` below only *warns* (it never blocks CI and is not auto-fixable)
 * at 100 columns — treat it as a nudge, wrap by hand when it helps.
 */
export const stylisticRules = stylistic.configs.customize({
  semi: true,
  quotes: 'single',
  indent: 2,
  commaDangle: 'always-multiline',
  arrowParens: true,
  braceStyle: '1tbs',
  blockSpacing: true,
  quoteProps: 'as-needed',
});

/** Non-blocking line-width nudge — see the CAVEAT above. */
export const lineWidth = {
  rules: {
    '@stylistic/max-len': ['warn', {
      code: 100,
      tabWidth: 2,
      ignoreUrls: true,
      ignoreStrings: true,
      ignoreTemplateLiterals: true,
      ignoreRegExpLiterals: true,
      ignoreComments: true,
    }],
  },
};

/** Spread into any flat config array to apply the shared house style. */
export default [stylisticRules, lineWidth];
