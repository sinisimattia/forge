import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import type { Request } from 'express';

/**
 * For the routes that serve both a signed-in person and one who is halfway
 * through signing in: **a session is checked when one is offered, and its
 * absence is not a refusal.**
 *
 * ## Who this is for, and who it is not
 *
 * `POST /mfa/webauthn/options` and `POST /mfa/webauthn/verify` are the only
 * routes in this application with two kinds of caller. An enrollment arrives
 * with a session; a login arrives with a challenge token and, by definition,
 * no session at all. Neither could be served by `JwtAuthGuard` (the login has
 * nothing to prove) nor by `@Public()` alone (the enrollment's account would
 * then have to come from somewhere, and everywhere else is a request field).
 *
 * **This is not a softer `JwtAuthGuard`, and nothing else may use it as one.**
 * A route whose every caller has a session uses `JwtAuthGuard` — which is the
 * default and needs no decorator. Applying this one there would turn an
 * unauthenticated request into a handler call with no actor, which is the
 * failure `CurrentUser`'s own TSDoc describes.
 *
 * ## Present-and-bad is a refusal, not an absence
 *
 * The decision is made on **the presence of the `Authorization` header**, not
 * on whether the credential in it verifies. A guard that swallowed an invalid
 * credential and continued would let a request with a forged or expired token
 * be served as though it carried none — which on these two routes means being
 * served as a *login*, the more powerful of the two branches, chosen by
 * sending something broken. So: no header, carry on with no actor; a header,
 * and `AuthGuard('jwt')` decides exactly as it does everywhere else.
 *
 * The same presence — not the same verdict — is what
 * `webAuthnCallerOf` is told, so "this request carried both credentials" is a
 * fact about the request rather than about what a guard made of it.
 *
 * Route-scoped, and it must stay that way: it is applied with `@UseGuards`
 * alongside `@Public()`, which is what stops the global `JwtAuthGuard`
 * refusing the login half before this ever runs. `@Public()` here opens the
 * door to a token check this guard then performs; it does not open the route.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  public canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.get('authorization') === undefined) return true;
    return super.canActivate(context);
  }
}
