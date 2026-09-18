import { SetMetadata } from '@nestjs/common';

/**
 * The metadata key {@link Public} sets, read by `JwtAuthGuard`.
 *
 * Exported because the guard is the only other thing that may name it, and a
 * second spelling of the string in that file is a typo away from a guard that
 * silently never finds the flag — which fails *open* for every route that
 * thought it was exempt, and closed for none, so nothing would report it.
 */
export const IS_PUBLIC = 'auth:isPublic';

/**
 * Marks a route reachable without proving anything.
 *
 * Every route in this application requires a proven identity unless it says
 * otherwise, and this is how it says otherwise. The default direction is what
 * makes that safe: a developer who adds an endpoint and does not think about
 * authentication gets a closed door, and the one who genuinely wants an open
 * one has to write it down where a reviewer sees it. The reverse arrangement —
 * open unless decorated — fails silently every time somebody forgets, and the
 * forgetting is invisible until it is exploited.
 *
 * Asserted by `__tests__/global-guard.spec.ts` (D6), against a controller
 * defined inside that file so the assertion cannot be satisfied by any existing
 * endpoint's own decorators.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
