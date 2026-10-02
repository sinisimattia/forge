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

## Discriminating tests (`D<N>`)

A **discriminating test** is one chosen so that a plausible *wrong* implementation fails it.
An application that compiles and answers `200` on the happy path has shown almost nothing;
these are the checks picked because a specific way of getting the thing wrong would pass
everything else. Source files across this repository cite them by number, and the table below
is what those numbers mean.

The numbering is inherited from the template this repository was generated from, so it has
gaps. The absent numbers check that generation tooling rather than this application, and
nothing here cites them.

**Every file named in the table lives in the full generated application.** A repository that
adopted only the process layer — these standards, the agents, the first few ADRs — has this
page without that code, and will not find them; the table is then a description of what the
template holds, not a map of the repository you are in.

| | The fault it is chosen to catch | Where it is held |
|---|---|---|
| **D2** | a framework or persistence package imported inside `libs/core/src/` | `nx run core:lint`. `libs/core/eslint.config.mjs` restricts those imports and also the dynamic-`import()` and `require()` forms that would otherwise walk straight past the rule. |
| **D3** | a shared conformance suite that only its own reference implementation ever satisfies | the backend's `*.conformance.spec.ts` drivers, which run core's suite against an implementation that really reads a store. (The webapp drives the same suites against a stub, which is a different claim — see `libs/core/README.md`'s DEC-1 note.) A contract only its own reference implementation passes is a contract about that one file. |
| **D6** | an endpoint added with no decorator, left open because nothing said to close it | `apps/backend/src/auth/__tests__/global-guard.spec.ts` — a controller carrying no decorator must still answer `401` without a credential. |
| **D7** | sign-in disclosing whether an address is known | `apps/backend/src/auth/__tests__/enumeration-safety.spec.ts` — the *whole* response is compared for a known address and an unknown one, not just the status code. |
| **D8** | a renewal credential that still works the second time it is presented | `apps/backend/src/auth/__tests__/refresh-rotation.spec.ts` — the second presentation is rejected **and** the whole credential family is revoked. |
| **D9** | a member of one organization reading another organization's data | `apps/backend/src/__tests__/tenant-isolation.spec.ts`, with `apps/backend/src/__tests__/discriminating/d9-tenant-isolation.spec.ts` deriving the route list from the decorators, so a guarded route added later is red until it is covered. |
| **D10** | an MFA-enrolled account handed a session straight from correct credentials | `apps/backend/src/__tests__/discriminating/d10-mfa-challenge-only.spec.ts` — a challenge comes back and an access credential does not. |
| **D11** | a federated sign-in silently linking to an existing password account because the addresses match | `apps/backend/src/__tests__/discriminating/d11-federated-email-match.spec.ts`. |
| **D12** | a per-record grant revoked mid-session still honoured from a cached principal | **Stated, and not satisfied.** `apps/backend/src/__tests__/discriminating/d12-grant-revocation.spec.ts` is a labelled partial: its header says what it does not establish, and why no route this backend mounts can. Read it before assuming the property is covered. |
| **D13** | the application's own database role being able to `UPDATE` or `DELETE` an audit row | the privilege itself, not a test double. `apps/backend/src/db/migrations/1758000002000-AuditAppendOnly.ts` revokes both, and `apps/backend/src/db/audit-privilege-check.ts` re-checks the `UPDATE` half at start-up and refuses to serve without it. |
| **D14** | transport or framework vocabulary in `libs/core`'s *prose*, which lint cannot see because lint reads imports | `nx run core:purity` — `libs/core/scripts/check-purity.mjs` scans comments and TSDoc under `libs/core/src/`. |
| **D15** | an organization left with no owner at all | `apps/backend/src/__tests__/discriminating/d15-last-owner.spec.ts` — the invariant is a count of the owners who would remain, not a rule about who is asking. |
| **D16** | a budget refusal answered by the throttling library instead of by this application | `apps/backend/src/__tests__/discriminating/d16-throttle-refusal.spec.ts` — the domain error, its translated message and its retry window, none of which the library's own body carries. |

Adding one is a deliberate act: name the wrong implementation it distinguishes, in the test's
own header, the way the files above do. A test whose header cannot name a wrong implementation
that would fail it is not discriminating, whatever it is numbered.
