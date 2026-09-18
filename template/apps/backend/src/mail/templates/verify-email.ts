import type { OutboundMessage } from '../IMailer';

export type VerifyEmailInput = {
  /** The address the identity being verified is registered under. */
  to: string;
  /** The opaque, single-use token minted for this verification. */
  token: string;
  /**
   * The webapp's own origin, as configured by this deployment
   * (`PUBLIC_WEBAPP_URL`) — never derived from anything about the request that
   * triggered the send. See {@link buildVerifyEmailMessage}.
   */
  webappUrl: string;
};

/**
 * Builds the message sent when an identity needs to confirm an email address.
 *
 * Takes `webappUrl` as a plain argument rather than reading `PUBLIC_WEBAPP_URL`
 * itself, so the one thing that decides the link's origin is visible in this
 * function's own signature — see `reset-password.ts` for why that origin must
 * never come from an incoming request.
 */
export function buildVerifyEmailMessage({
  to,
  token,
  webappUrl,
}: VerifyEmailInput): OutboundMessage {
  const query = new URLSearchParams({ token }).toString();
  const link = `${webappUrl}/verify-email?${query}`;

  return {
    to,
    subject: 'Verify your __FORGE_TITLE__ email address',
    body: [
      'Confirm your email address for __FORGE_TITLE__ by opening this link:',
      '',
      link,
      '',
      'If you did not create an account, you can ignore this message.',
    ].join('\n'),
  };
}
