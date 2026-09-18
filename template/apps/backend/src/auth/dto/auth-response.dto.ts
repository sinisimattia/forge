import type { UserJSON } from '__FORGE_SCOPE__/core/users/types';

/**
 * What a successful sign-in or renewal returns in the body.
 *
 * The renewal credential is **not** here: it is set as a cookie the browser
 * will not let script read (see `refresh-cookie.ts`). A long-lived credential in
 * a response body is one the page has to store somewhere itself, and everywhere
 * it could store it is readable by any script the page ever loads.
 *
 * The access credential *is* here, and the asymmetry is deliberate: it is short
 * lived, it has to be attached to requests by the application's own code, and
 * there is nowhere else to put it that the code could read.
 */
export interface AuthResponseDto {
  /** Who was proven, in the shape core's `User.toJSON` defines. */
  user: UserJSON;
  /** The credential to present on ordinary requests. */
  accessToken: string;
  /** How long it lasts, in seconds, so a client can renew before it lapses. */
  expiresIn: number;
}

/**
 * The body every registration returns, whether or not the address was already
 * in use.
 *
 * **There is no branch here, and there must never be one.** The server knows
 * which of the two happened and writes it to the audit log; the caller is told
 * only that something was sent. The moment this body says "an account already
 * exists", anybody can test any address for registration one request at a time
 * — which is the enumeration oracle core's `IAuthService.register` is written
 * around, and registration is the easiest of the three such endpoints to probe.
 *
 * Whoever opens this file to improve the experience will see a fixed message
 * where a helpful one could be, and this is the reason it stays fixed. The
 * helpful message exists; it goes to the address, where only its owner reads it.
 */
export interface RegistrationAcceptedDto {
  /** Fixed. Says what was done, never what was found. */
  status: 'accepted';
}
