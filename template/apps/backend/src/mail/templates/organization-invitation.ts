import type { OutboundMessage } from '../IMailer';

export type OrganizationInvitationInput = {
  /** The address the invitation is addressed to. */
  to: string;
  /** The opaque, single-use token minted for this invitation. */
  token: string;
  /** The organization the invitation offers membership in, as its members see it. */
  organizationName: string;
  /**
   * The webapp's own origin, as configured by this deployment
   * (`PUBLIC_WEBAPP_URL`) — never derived from anything about the request that
   * triggered the send. See `reset-password.ts` for why that origin must never
   * come from an incoming request.
   */
  webappUrl: string;
};

/**
 * Builds the message sent when somebody is invited to join an organization.
 *
 * Follows `verify-email.ts`'s shape exactly: one link, built from
 * `webappUrl` and carrying the token in a path segment, because this address
 * need not belong to an existing account — accepting while signed out routes
 * through registration first (spec §9.4) and the same link works either way.
 */
export function buildOrganizationInvitationMessage({
  to,
  token,
  organizationName,
  webappUrl,
}: OrganizationInvitationInput): OutboundMessage {
  const query = new URLSearchParams({ token }).toString();
  const link = `${webappUrl}/invitations/accept?${query}`;

  return {
    to,
    subject: `You've been invited to join ${organizationName} on __FORGE_TITLE__`,
    body: [
      `You have been invited to join "${organizationName}" on __FORGE_TITLE__.`,
      'Accept the invitation by opening this link:',
      '',
      link,
      '',
      'If you were not expecting this invitation, you can ignore this message.',
    ].join('\n'),
  };
}
