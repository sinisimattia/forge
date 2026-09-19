/**
 * The webapp's only door to the backend.
 *
 * Everything below this barrel spells a path; nothing above it does. That is the
 * first link of the chain `STANDARDS.md` W2 enforces — fetcher → service →
 * composable → component — and the reason a component reaching for a fetcher is
 * a blocking violation rather than a style note: a component that issues its own
 * request has no service to map its errors and no composable to hold its state,
 * so both of those end up inline in markup.
 */
export { ApiError, createApiClient } from './client';
export type { ApiClientOptions } from './client';
export * from './auth.fetchers';
export * from './identity.fetchers';
export * from './user.fetchers';
