# Formatting & Linting

Shared rules for how source code is formatted and linted across every package
(`apps/backend`, `apps/webapp`, `libs/core`).

## Rules

- **ESLint owns formatting — Prettier is not used.** Prettier was retired; there is no
  `.prettierrc`, no `prettier` dependency, and no `format` script. `@stylistic/eslint-plugin`
  (the maintained successor to the formatting rules ESLint core and `@typescript-eslint`
  deprecated) applies the house style through the same `eslint --fix` that lints. **Do not
  reintroduce Prettier** or `eslint-config-prettier`.
- **One shared house style.** The single source of truth is the root
  [`eslint.config.base.mjs`](../../eslint.config.base.mjs); every package's `eslint.config.mjs`
  imports and spreads it. The style is: **semicolons**, **single quotes**, **trailing commas on
  multiline**, **2-space indent**, one-true-brace. Do not override these per package.
- **Line width is a warning, not a rule.** ESLint cannot reflow lines to a print width the way
  Prettier did. `@stylistic/max-len` only **warns** at 100 columns — it never blocks CI and is
  not auto-fixable. Wrap long lines by hand when it aids readability; a warning is a nudge, not
  a failure.
- **Whitespace is shared via EditorConfig.** The root [`.editorconfig`](../../.editorconfig)
  owns indent width, end-of-line, charset, final newline, and trailing-whitespace across all
  editors. Keep it in sync with the ESLint indent setting (both are 2-space).
- **Flat config on ESLint 9.** All packages use flat config (`eslint.config.mjs`); the legacy
  `.eslintrc.*` format is not used. Each package exposes `lint` (`eslint .`) and `lint:fix`
  (`eslint . --fix`); CI gates on `nx affected -t lint`.
