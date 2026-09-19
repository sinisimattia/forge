/**
 * Where an interrupted visitor is sent back to, or the fallback.
 *
 * A sign-in page that reads `?redirect=` and navigates to it without judging it
 * is an **open redirect**, and a sign-in page is the most valuable place in an
 * application to have one: the link that carries the payload is a link to the
 * real site, on the real domain, with a real certificate, and the person is
 * expecting to type a password. It is a phishing primitive that arrives
 * pre-trusted.
 *
 * The rule is therefore the narrow one — a path within this application and
 * nothing else — rather than a list of the ways out. In particular:
 *
 * - `https://elsewhere.example/x` has a scheme, so it does not begin with `/`.
 * - `//elsewhere.example/x` **does** begin with `/`, and is the form that gets
 *   through a check written as "must start with a slash". It is protocol-
 *   relative: a browser reads it as `https://elsewhere.example/x`. This is the
 *   one people forget, and it is the one that works.
 * - `/\elsewhere.example/x` is the same attack spelled with a backslash.
 *   Browsers normalise `\` to `/` in the authority position, so this leaves the
 *   site exactly as the form above does while passing a check that only looked
 *   for a second `/`.
 * - A value carrying a control character — a newline, a tab, a NUL — is refused
 *   outright. Those are how a value is smuggled past a parser that strips them
 *   (`/\t/evil.example`) and how a header is split when one is built from this.
 *
 * Everything else that begins with a single `/` stays inside this origin, which
 * is the whole of what is being promised.
 *
 * @param value - whatever arrived in the query string, of whatever type
 * @param fallback - where to go when the value may not be trusted
 * @returns the path to navigate to
 */
export function localRedirect(value: unknown, fallback: string): string {
  // A repeated query parameter arrives as an array, and an absent one as
  // `undefined`. Neither is a path.
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // A control character — a NUL, a newline, a tab — is refused outright rather
  // than stripped. Written as a loop and not as a regular expression because a
  // character class of escaped code points is exactly the kind of literal that
  // does not survive being copied between files, and a silently mangled one
  // still compiles.
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point < 0x20 || point === 0x7f) return fallback;
  }
  return value;
}

/**
 * Where an anonymous visitor is sent to prove who they are.
 *
 * Named once and imported by both middleware so that the path the `auth` guard
 * redirects *to* and the path the `guest` guard redirects *away from* cannot
 * drift apart. It is not a configuration knob: the specs assert the literal
 * `'/login'`, because a test that compared the middleware's answer against this
 * same binding would agree with itself no matter what either one said.
 */
export const SIGN_IN_PATH = '/login';

/** Where a signed-in visitor goes when the request carried nowhere to go back to. */
export const SIGNED_IN_HOME = '/';
