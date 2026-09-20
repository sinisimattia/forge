/**
 * Where an invitation stands, as a fact somebody recorded.
 *
 * **There is no EXPIRED member, deliberately.** Expiry is a function of
 * `expiresAt` and the instant you ask — a fact that becomes true while nothing
 * is running. Storing it as a status would mean every read had to repair the row
 * before trusting it, and the read path is precisely where that repair gets
 * forgotten. `Invitation.isOpenAt(now)` is the question every caller actually
 * has, and it answers both halves.
 */
export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REVOKED = 'REVOKED',
}
