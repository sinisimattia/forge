import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import houseStyle from '../../eslint.config.base.mjs';

/**
 * libs/core is the framework-agnostic domain. These packages are structurally
 * unreachable from it — the rule makes purity a guarantee rather than a review
 * item that can be skipped.
 */
const FRAMEWORK_PACKAGES = [
  'typeorm', 'typeorm/**',
  '@nestjs/**',
  'nuxt', 'nuxt/**', 'vue', 'vue/**', 'pinia',
  '@prisma/**',
  '@simplewebauthn/**',
  'otplib', 'express', 'argon2', 'bcrypt', 'jsonwebtoken', 'qrcode', 'qrcode/**',
];

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...houseStyle,
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  {
    files: ['**/*.ts'],
    rules: {
      // The typescript-eslint variant is required: the base rule does not see
      // `import type` specifiers, which would leave a purity hole.
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          group: FRAMEWORK_PACKAGES,
          message: 'libs/core is framework-agnostic — no framework or runtime-specific imports.',
        }],
      }],
      // no-restricted-imports only sees STATIC import/export declarations.
      // Without these, `await import('typeorm')` and `require('typeorm')` walk
      // straight past it, and the "structurally unreachable" claim is false.
      'no-restricted-syntax': ['error',
        {
          selector: 'ImportExpression[source.value=/^(typeorm|@nestjs|nuxt|vue|pinia|@prisma|@simplewebauthn|otplib|express|argon2|bcrypt|jsonwebtoken|qrcode)($|\\u002f)/]',
          message: 'libs/core is framework-agnostic — no dynamic import of framework packages.',
        },
        {
          selector: 'CallExpression[callee.name="require"]',
          message: 'libs/core is framework-agnostic and ESM-only — require() is not permitted.',
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      // Config/tooling scripts (jest.config.js, scripts/*.mjs) run under Node directly,
      // not through the TypeScript parser that already knows these ambient globals.
      globals: {
        module: 'readonly',
        require: 'readonly',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
);
