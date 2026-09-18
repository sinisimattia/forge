import type { OutboundMessage } from '../IMailer';

export type AccountExistsInput = {
  /** The address somebody just tried to register, which already has an account. */
  to: string;
  /**
   * The webapp's own origin, as configured by this deployment
   * (`PUBLIC_WEBAPP_URL`) — never derived from anything about the request that
   * triggered the send. See `reset-password.ts`.
   */
  webappUrl: string;
};

/**
 * Builds the message sent when somebody registers an address that already has
 * an account.
 *
 * **This message is the only place the difference is told.** Registration
 * answers a known address and an unknown one identically, because an answer
 * that differed would let anybody test any address for an account one request at
 * a time. The person who actually owns the address learns what happened here,
 * where only they can read it; a stranger who guessed the address learns
 * nothing, because the message goes to the address rather than to them.
 *
 * It therefore carries **no token and no link that acts**: only a pointer at the
 * sign-in and recovery pages, which are reachable by anyone anyway. A
 * verification or reset credential sent here would turn "type somebody else's
 * address into a registration form" into a way to have a working credential
 * mailed to them — and the whole design assumes this message reaches people who
 * did not ask for it.
 */
export function buildAccountExistsMessage({ to, webappUrl }: AccountExistsInput): OutboundMessage {
  return {
    to,
    subject: 'Your __FORGE_TITLE__ account',
    body: [
      'Somebody — possibly you — tried to create a __FORGE_TITLE__ account with this',
      'address. One already exists, so nothing has changed.',
      '',
      `Sign in:              ${webappUrl}/login`,
      `Forgotten password:   ${webappUrl}/forgot-password`,
      '',
      'If this was not you, no action is needed: nobody can create an account with',
      'your address, and nothing about your account has been revealed to them.',
    ].join('\n'),
  };
}
