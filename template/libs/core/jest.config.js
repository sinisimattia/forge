/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testMatch: ['<rootDir>/tests/**/*.spec.ts'],
  transform: {
    // The library's own tsconfig targets a bundler (ESM, verbatimModuleSyntax);
    // ts-jest emits CommonJS for the Node test runtime, so it uses a spec tsconfig.
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }],
  },
  testEnvironment: 'node',
  passWithNoTests: true,
  // Consumers import core via per-domain subpaths; map each to its `src/` barrel
  // so tests exercise source directly (mirrors the published `exports` map).
  moduleNameMapper: {
    '^__FORGE_SCOPE__/core/shared/errors$': '<rootDir>/src/shared/errors/index.ts',
    '^__FORGE_SCOPE__/core/shared/testing$': '<rootDir>/src/shared/testing/index.ts',
    '^__FORGE_SCOPE__/core/shared/types$': '<rootDir>/src/shared/types/index.ts',
  },
  // Coverage covers executable domain code only. Barrels re-export; `types/`,
  // `contracts/`, and the type-only testing interfaces (`*ContractDeps`,
  // `ConformanceExpect`, `ConformanceRunner`) are interfaces/aliases that emit no runtime JS.
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/index.ts',
    '!src/**/types/**',
    '!src/**/contracts/**',
    '!src/**/testing/*ContractDeps.ts',
    '!src/shared/testing/ConformanceExpect.ts',
    '!src/shared/testing/ConformanceRunner.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'html', 'lcov'],
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
