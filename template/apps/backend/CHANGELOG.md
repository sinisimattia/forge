# Changelog

## [Unreleased]

### Added
- `GET /health/ready`, a readiness probe that consults the database (`503` when it does not
  answer), on `@nestjs/terminus`. `GET /health` stays a liveness probe that consults nothing,
  and the container healthchecks poll readiness.
- NestJS backend skeleton: `GET /health`, TypeORM/PostgreSQL wiring via `DATABASE_URL`,
  global exception filter + i18n response interceptor, shared pagination DTO, TypeORM
  migration scaffolding. No business domain or auth yet.

### Changed
- **Breaking, for a project that already holds users: every recovery code issued before this
  change stops working.** Recovery codes are now drawn from Crockford base32 (no `I`, `L`, `O`
  or `U`) instead of base64url, and `consume` upper-cases a code and reads `O` as `0` and `I`/`L`
  as `1` before taking its digest. A code issued earlier is the digest of a base64url string that
  may be mixed case and may contain exactly those characters, so what a person types now hashes
  to something else and the stored digest never matches. Nothing fails loudly: the code is
  refused as unknown. After upgrading, a user who can still produce a code from a confirmed method can issue a new
  batch (`POST /mfa/recovery-codes`); a user who held only their old codes has no working recovery
  path. A fresh project has no stored codes and is unaffected.
