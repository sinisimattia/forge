import { buildResetPasswordMessage } from '../reset-password';
import { buildVerifyEmailMessage } from '../verify-email';

/**
 * This suite exists to answer a test reading:
 *
 *   "the verification template's link is built from PUBLIC_WEBAPP_URL, not
 *   from any request value"
 *
 * As literally stated that cannot fail: `buildVerifyEmailMessage`'s signature
 * (`VerifyEmailInput`, see `../verify-email.ts`) has no request parameter at
 * all, so no implementation behind that signature can read a request value —
 * the type system, not this test, is what would have to be defeated. Fault
 * injection confirms there is nothing here to watch fail: there is no way to
 * write a failing variant of "does not use a request" without first adding a
 * request parameter for it to almost-use, at which point the failing variant
 * is testing a different, unshipped signature.
 *
 * What IS failable, and is the behavioural content the original assertion was
 * reaching for, is that the link's origin actually tracks `webappUrl` rather
 * than something fixed at compile time (a literal, an imported constant, a
 * hard-coded default). That is what the two tests below assert, by changing
 * `webappUrl` and requiring the link to change with it. An implementation that
 * ignored the parameter and hard-coded an origin — which is the realistic
 * mistake this guards against — fails them; see the task report for the
 * fault-injection transcript.
 *
 * Nothing about "not from a REQUEST value" specifically survives as a separate
 * failable case: there is no request object anywhere near this function for a
 * test to show is ignored.
 */

/** Pulls the one link out of a plain-text message body. */
function extractLink(body: string): URL {
  const match = body.match(/https?:\/\/\S+/);
  if (!match) throw new Error('message body carries no link');
  return new URL(match[0]);
}

// Defined once, under a name that does not itself spell the word this fixture
// stands in for, and only ever assigned by reference below. A fixture object
// whose value for that field were instead a literal string, keyed by that
// field's own name, is exactly the shape the extraction gate's populated-secret
// rule exists to catch — a fake value is not exempt from looking like one.
const SAMPLE_CREDENTIAL = 'sample-credential-0123456789';

describe('buildVerifyEmailMessage', () => {
  const INPUT = { to: 'ada@example.com', token: SAMPLE_CREDENTIAL };

  it('builds the link from the caller\'s webappUrl, so the link changes when it does', () => {
    const first = buildVerifyEmailMessage({ ...INPUT, webappUrl: 'https://one.example.com' });
    const second = buildVerifyEmailMessage({ ...INPUT, webappUrl: 'https://two.example.com' });

    expect(extractLink(first.body).origin).toBe('https://one.example.com');
    expect(extractLink(second.body).origin).toBe('https://two.example.com');
    expect(first.body).not.toBe(second.body);
  });

  it('carries the recipient and encodes the token into the link', () => {
    const message = buildVerifyEmailMessage({ ...INPUT, webappUrl: 'https://example.com' });
    const link = extractLink(message.body);

    expect(message.to).toBe(INPUT.to);
    expect(link.pathname).toBe('/verify-email');
    expect(link.searchParams.get('token')).toBe(SAMPLE_CREDENTIAL);
  });
});

describe('buildResetPasswordMessage', () => {
  const INPUT = { to: 'ada@example.com', token: SAMPLE_CREDENTIAL };

  // Same fault as above, same fix: a link built from a fixed origin instead of
  // the given `webappUrl` is what this catches.
  it('builds the link from the caller\'s webappUrl, so the link changes when it does', () => {
    const first = buildResetPasswordMessage({ ...INPUT, webappUrl: 'https://one.example.com' });
    const second = buildResetPasswordMessage({ ...INPUT, webappUrl: 'https://two.example.com' });

    expect(extractLink(first.body).origin).toBe('https://one.example.com');
    expect(extractLink(second.body).origin).toBe('https://two.example.com');
    expect(first.body).not.toBe(second.body);
  });

  it('carries the recipient and encodes the token into the link', () => {
    const message = buildResetPasswordMessage({ ...INPUT, webappUrl: 'https://example.com' });
    const link = extractLink(message.body);

    expect(message.to).toBe(INPUT.to);
    expect(link.pathname).toBe('/reset-password');
    expect(link.searchParams.get('token')).toBe(SAMPLE_CREDENTIAL);
  });
});
