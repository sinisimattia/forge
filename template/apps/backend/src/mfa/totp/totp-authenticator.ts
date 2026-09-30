import { authenticator } from 'otplib';
import { HashAlgorithms, KeyEncodings } from '@otplib/core';

/**
 * Seconds per time step — RFC 6238 §5.2's own default, and what every authenticator app assumes.
 * The one definition: the verifier checks with it and the enrollment URI advertises it.
 */
export const STEP_SECONDS = 30;

/**
 * Bytes of entropy in a new shared secret — 160 bits, the length RFC 4226 §4
 * (R6) recommends and the length of the HMAC-SHA-1 block the code is derived
 * with. `otplib`'s own default is 10 bytes (80 bits), the RFC's stated minimum
 * is 128.
 */
const SECRET_BYTES = 20;

/**
 * **The only place in this codebase that may assign `authenticator.options`.**
 *
 * `otplib` 12's `authenticator` is one shared, mutable object: assigning
 * `.options` merges into state that the next `generate`, `generateSecret` or
 * `keyuri` reads, whoever calls it. **Every hazard this has produced has the
 * same shape** — one caller reading an option some other caller left behind: a
 * helper that copied the option block and could drift from the verifier's; a
 * secret generator whose output depended on which caller had run last; and
 * `keyuri`, which would take its digit count from whatever ran before it and
 * hand a person a URI their app's codes never verify against, the reason
 * `totp-enrollment.ts` builds that URI by hand instead. So every use of the
 * singleton lives in the functions below, each of which sets every option it
 * depends on, then reads the result in the same synchronous call with no
 * `await` between (nothing else can run on Node's single thread inside that
 * window). **No other module, production or test, may
 * touch `authenticator.options` directly**; call these instead. The one
 * exception is `totp-enrollment.spec.ts`, which assigns it on purpose to prove
 * the functions here do not depend on what it was left as.
 *
 * @param secret - the shared secret, Base32
 * @param step - the RFC 6238 time-step counter, `floor(unixSeconds / 30)`
 * @param digits - the code length
 * @returns the code `secret` produces at `step`
 */
export function totpCodeAtStep(secret: string, step: number, digits: number): string {
  authenticator.options = {
    algorithm: HashAlgorithms.SHA1,
    digits,
    step: STEP_SECONDS,
    encoding: KeyEncodings.HEX,
    epoch: step * STEP_SECONDS * 1000,
  };
  return authenticator.generate(secret);
}

/**
 * A fresh shared secret, Base32-encoded — the form an authenticator app reads
 * from the URI and a person types for manual entry, and the form
 * `TotpVerifier.verify` takes.
 *
 * ## Why `encoding` is set here
 *
 * `generateSecret` asks `createRandomBytes` for a string *in the singleton's
 * `encoding`* and then Base32-encodes that string as text. Left alone, the
 * secret would depend on whether some other call had run first. Under the
 * library's default (`ascii`) the random bytes are decoded to text with the top
 * bit of every byte discarded — 7 bits of entropy per byte, not 8; under the
 * encoding `totpCodeAtStep` leaves behind (`hex`) it is the full 8. Setting
 * `hex` here makes it the second every time.
 *
 * @returns 32 Base32 characters encoding 20 random bytes
 */
export function generateTotpSecret(): string {
  authenticator.options = { encoding: KeyEncodings.HEX };
  return authenticator.generateSecret(SECRET_BYTES);
}
