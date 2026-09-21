import type { CookieOptions, Request, Response } from 'express';
import { SESSION_TTL_SECONDS } from './session/session.service';

/**
 * The one place the renewal credential's cookie is named and described.
 *
 * **Seven call sites read this and none of them spells its own options**:
 * signing in sets it (`AuthController.login`), renewing replaces it
 * (`AuthController.refreshSession`, on success), a refused renewal clears it
 * (`AuthController.refreshSession`, on failure), changing a password re-issues
 * it (`AuthController.changePassword`), signing out clears it
 * (`AuthController.logout`), completing a federated sign-in sets it
 * (`OAuthController.callback`), and closing an account clears it
 * (`UsersController.deleteMe`). That is the point of the file existing — and
 * the count is written down because a new call site is exactly the one a
 * reader forgets to add here, which is exactly the one a hand-spelled
 * `clearCookie` would get wrong. **Read this file's own history before
 * trusting this number**: it was already stale once, undercounting by three,
 * before anyone noticed — update it in the same commit that adds an eighth.
 *
 * Clearing a cookie only works when the name, the `path` and the other
 * attributes match what was set — the browser treats a different `path` as a
 * different cookie — and a mismatch fails *silently*: the response looks
 * correct, the server believes the credential is gone, and the browser still
 * holds a working one. Seven call sites each spelling their own options is
 * exactly how that arrives.
 *
 * ### Why each attribute is what it is
 *
 * - **`httpOnly`** — script cannot read it. This is what makes the credential
 *   survive a cross-site scripting bug that would hand an attacker anything
 *   readable from JavaScript.
 * - **`sameSite: 'lax'`** — the browser does not attach it to a cross-site
 *   request another site provoked, which is what closes cross-site request
 *   forgery against the renewal and sign-out endpoints. `'strict'` was
 *   considered and rejected: it also withholds the cookie on an ordinary
 *   top-level navigation *back into* the application from an external link, so a
 *   person following a link from their mail client would arrive signed out.
 * - **`secure` in production only** — the browser refuses a `Secure` cookie over
 *   plain HTTP, and local development is plain HTTP. Setting it unconditionally
 *   makes a generated project's own dev stack unable to sign in, which is the
 *   kind of breakage that gets fixed by deleting the flag everywhere.
 * - **`path: '/auth'`** — the credential is attached only to the endpoints that
 *   renew or end a session, and to nothing else the application requests. A
 *   long-lived credential sent on every image and every API call is a
 *   long-lived credential in every proxy log and every error report along the
 *   way.
 * - **`maxAge`** matching the session's own lifetime, so the browser stops
 *   sending a credential the server would refuse anyway.
 */
export const REFRESH_COOKIE = {
  /** The cookie's name. Tasks that read it on the client side depend on this value. */
  name: 'refreshCredential',

  /** How long the browser keeps it, in milliseconds. */
  maxAgeMs: SESSION_TTL_SECONDS * 1000,

  /**
   * Everything that must match between setting and clearing.
   *
   * A function rather than a frozen object because `secure` reads `NODE_ENV`,
   * and a constant evaluated at import time would fix that answer to whatever
   * the environment was when the module was first loaded — which in a test
   * process is decided by import order.
   *
   * `maxAge` is deliberately **not** in here: it is meaningful only to the call
   * that sets the cookie, and `clear` passes this same object straight to
   * `Response.clearCookie`. Express 5 happens to delete `maxAge` and force an
   * expiry in the past itself (`lib/response.js`, verified against 5.2.1), so a
   * `maxAge` that leaked in here would currently be survivable — it was NOT
   * under Express 4, which recomputed the expiry from it and so left the cookie
   * in place. Keeping it out is the version-independent form.
   *
   * **`path` is the attribute that actually bites today.** `clearCookie`
   * defaults it to `'/'`, and a browser treats a cookie at a different path as a
   * different cookie, so a clear that dropped `path: '/auth'` removes nothing
   * and reports complete success. That one is asserted in
   * `__tests__/auth.controller.spec.ts`.
   */
  attributes(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/auth',
    };
  },

  /**
   * Sets the credential. Used by signing in, by renewal, by a password
   * change and by completing a federated sign-in.
   */
  set(response: Response, value: string): void {
    response.cookie(this.name, value, { ...this.attributes(), maxAge: this.maxAgeMs });
  },

  /**
   * Removes it. Used by signing out, by any path that refuses a renewal, and
   * by closing an account.
   */
  clear(response: Response): void {
    response.clearCookie(this.name, this.attributes());
  },

  /** Reads it off a request, or `null` when the request carried none. */
  read(request: Request): string | null {
    const jar = (request as Request & { cookies?: Record<string, unknown> }).cookies;
    const value = jar?.[this.name];
    return typeof value === 'string' && value !== '' ? value : null;
  },
} as const;
