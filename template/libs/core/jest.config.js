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
  // One wildcard maps every `__FORGE_SCOPE__/core/<domain>/<folder>` subpath to its `src/`
  // barrel, so core's own tests exercise SOURCE and a new domain needs no edit here.
  // This deliberately does NOT mirror the published `exports` map: `exports` stays
  // hand-enumerated because it is the only map resolving into `dist/`, where a missing
  // entry must fail loudly rather than serve a stale build. See README "How to add a domain".
  moduleNameMapper: {
    '^__FORGE_SCOPE__/core/(.*)$': '<rootDir>/src/$1/index.ts',
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
