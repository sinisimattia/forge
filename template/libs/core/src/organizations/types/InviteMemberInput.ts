import type { OrgRole } from '../enums/OrgRole';

/** What a caller must supply to invite a member into an organization. */
export interface InviteMemberInput {
  /** The address the invitation is addressed to. */
  email: string;
  /** The role the invitation offers, once accepted. */
  role: OrgRole;
}
