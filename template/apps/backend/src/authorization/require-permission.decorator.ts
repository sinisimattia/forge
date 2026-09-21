import { SetMetadata } from '@nestjs/common';
import type { Permission } from '__FORGE_SCOPE__/core/authorization/types';

/**
 * The metadata key {@link RequirePermission} sets, read by `PermissionsGuard`.
 *
 * Exported for the reason `IS_PUBLIC` is: the guard is the only other thing
 * that may name it, and a second spelling of the string in that file is a typo
 * away from a guard that never finds the annotation — which, unlike
 * `IS_PUBLIC`'s failure mode, fails *open* on every route that thought it was
 * protected, because a route with no permission declared is not this guard's
 * business.
 */
export const REQUIRED_PERMISSION = 'authorization:requiredPermission';

/**
 * Declares what a route requires, in the vocabulary `can` evaluates.
 *
 * It states the ask; it does not answer it. `PermissionsGuard` reads this,
 * hydrates the principal from the credential's subject, resolves the
 * organization from the stored record, and calls `can` — which is the one
 * decision in this project (ADR-0006). Putting the permission in metadata
 * rather than in a per-route call is what lets the webapp evaluate the same
 * `Permission` against the same rule to decide whether to render the action at
 * all.
 *
 * Typed as {@link Permission} rather than `string`, so a permission nobody
 * declared is a compile error rather than a route that silently refuses
 * everybody — a misspelling here would be invisible in exactly the direction
 * nobody reports, since the people it affects are the ones who cannot do their
 * job and assume they are not allowed to.
 *
 * A route with no `@RequirePermission` is not unprotected: the global
 * `JwtAuthGuard` still closes it unless it is `@Public()`. It is unauthorized —
 * either because it is about no particular organization (`POST
 * /organizations`), or because something other than a role authorizes it (`POST
 * /invitations/:token/accept`, authorized by holding the token).
 *
 * @param permission - what the route requires
 * @returns the method decorator that records it
 */
export const RequirePermission = (permission: Permission): MethodDecorator =>
  SetMetadata(REQUIRED_PERMISSION, permission);
