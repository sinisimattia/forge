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

/** The metadata key {@link ReadsSession} sets, read by `JwtAuthGuard`. */
export const READS_SESSION = 'auth:readsSession';

/**
 * On a `@Public()` route: **a session credential that is offered is verified at
 * the global guard, so the guards that run after it can see who it is.**
 *
 * It exists for one reason, and it is ordering. Route-level guards run after
 * every global one, so on a route that is public but also serves signed-in
 * callers, `request.user` is still empty when `ForgeThrottlerGuard` decides what
 * to count a request against — and a budget that cannot see the account falls
 * back to the credential presented, which a caller resets by obtaining another.
 * Verifying here puts the account where that guard can read it.
 *
 * It changes nothing about who is let in: no `Authorization` header carries on
 * with no actor, and a header that does not verify is refused, exactly as
 * `OptionalJwtAuthGuard` does. It is not a softer `JwtAuthGuard` and is no
 * substitute for it; apply it only alongside `@Public()` and
 * `OptionalJwtAuthGuard`.
 */
export const ReadsSession = (): MethodDecorator => SetMetadata(READS_SESSION, true);
