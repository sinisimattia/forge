// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import houseStyle from '../../eslint.config.base.mjs';
import migrationSql from './eslint-rules/migration-sql.mjs';

// Flat config on ESLint 9. Formatting is owned by the shared house style
// (`houseStyle`) — Prettier is not used.
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...houseStyle,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      sourceType: 'module',
    },
    rules: {
      // Nest relies on decorators and DI where explicit return/boundary types
      // and occasional `any` are idiomatic; keep these relaxed.
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Migration SQL has to stay where a text guard can read it. Both rules are
    // errors, both are scoped to this directory alone, and the reasoning for
    // each — including why neither substitutes for the canonical form in
    // `src/db/__tests__/migration-sql.spec.ts` — is on the plugin itself.
    //
    // `src/db/__tests__/migration-sql.spec.ts` asserts that this block exists
    // and that both rules are `error`, because a lint rule nobody has wired up
    // is indistinguishable from one that passes.
    files: ['src/db/migrations/**/*.ts'],
    plugins: { 'migration-sql': migrationSql },
    rules: {
      'migration-sql/sql-is-a-string-literal': 'error',
      'migration-sql/no-query-runner-schema-api': 'error',
    },
  },
  {
    ignores: [
      'eslint.config.mjs', 'eslint-rules/**', 'dist/**', 'node_modules/**', 'coverage/**',
    ],
  },
);
