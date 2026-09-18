import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!main.ts', '!**/*.entity.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  passWithNoTests: true,
  moduleNameMapper: {
    // Resolve core to SOURCE, not to its compiled output: a test that reads
    // `dist/` passes against whatever was last built, which can be anything.
    // `rootDir` is `src`, so three levels up is the workspace root.
    '^__FORGE_SCOPE__/core/(.*)$': '<rootDir>/../../../libs/core/src/$1/index.ts',
    '^@/(.*)$': '<rootDir>/$1',
  },
};

export default config;
