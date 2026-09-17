// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import houseStyle from '../../eslint.config.base.mjs';

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
  { ignores: ['eslint.config.mjs', 'dist/**', 'node_modules/**', 'coverage/**'] },
);
