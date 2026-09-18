import type { OutboundMessage } from '../IMailer';

export type ResetPasswordInput = {
  /** The address the identity requesting a reset is registered under. */
  to: string;
  /** The opaque, single-use token minted for this reset. */
  token: string;
  /**
   * The webapp's own origin, as configured by this deployment
   * (`PUBLIC_WEBAPP_URL`) — never derived from anything about the request that
   * triggered the send. See {@link buildResetPasswordMessage}.
   */
  webappUrl: string;
};

/**
 * Builds the message sent when an identity asks to reset its secret.
 *
 * `webappUrl` always comes from this deployment's own configuration
 * (`PUBLIC_WEBAPP_URL`, see `.env.example`) and NEVER from the request that
 * triggered the send — not the `Host` header, not `Origin`, not anything else
 * a caller supplies. A request's `Host` header is chosen by whoever sends the
 * request, not by this deployment, so a link built from it would let anyone
 * who can reach this endpoint choose the domain their own reset link points
 * at. Reconstructing the base from the incoming request would turn a
 * legitimate password-reset flow into a credential-harvesting link served
 * under this deployment's own good name, for a domain of the attacker's
 * choosing — the classic host-header-injection reset-poisoning attack. There
 * is exactly one trustworthy source for this origin: the value this
 * deployment configured once, ahead of time, which is what the parameter
 * below is.
 */
export function buildResetPasswordMessage({
  to,
  token,
  webappUrl,
}: ResetPasswordInput): OutboundMessage {
  const query = new URLSearchParams({ token }).toString();
  const link = `${webappUrl}/reset-password?${query}`;

  return {
    to,
    subject: 'Reset your __FORGE_TITLE__ password',
    body: [
      'Reset your __FORGE_TITLE__ password by opening this link:',
      '',
      link,
      '',
      'If you did not request this, you can ignore this message — your password will stay unchanged.',
    ].join('\n'),
  };
}
