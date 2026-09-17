# Testing

The testing philosophy is shared across both apps. The concrete tooling is package-local —
Jest with `@nestjs/testing` in the backend, Jest in `libs/core`, Vitest with `@vue/test-utils`
in the webapp — and the details live in each package's `STANDARDS.md`.

## Principles

- **Every unit of logic has at least one test.** Each service method, controller
  endpoint, composable, fetcher, or store action gets test coverage.
- **Test the happy path AND at least one error case.** Cover the expected flow plus at
  least one failure mode (not found, unauthorized, validation failure, etc.).
- **Mock external dependencies.** Mock databases, repositories, other services, and API
  calls — never hit real endpoints or external systems in unit tests.
- **Co-locate tests with source.** Keep unit test files next to (or within the module
  alongside) the code they exercise.
