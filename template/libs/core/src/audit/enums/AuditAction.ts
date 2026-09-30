/**
 * What happened. One member per kind of event worth reconstructing later.
 *
 * Members are added by later phases and never renamed or removed: a stored
 * value that changes meaning makes every historical entry a lie, and this is a
 * table nothing is permitted to rewrite.
 */
export enum AuditAction {
  USER_REGISTERED = 'USER_REGISTERED',
  /**
   * Somebody tried to bring an account into being at an address that already has
   * one.
   *
   * It exists because the alternative was a false entry. Registration answers a
   * known address and an unknown one identically — that silence is the whole
   * design — and what makes the silence affordable is that the *server* still
   * knows which of the two happened and writes it down. Recording that as
   * {@link AuditAction.USER_REGISTERED} would say an account was created when
   * none was; recording it as {@link AuditAction.EMAIL_VERIFICATION_REQUESTED}
   * would say a verification was asked for when none was issued and none was
   * sent. Either one destroys the only thing the entry is for, in a table
   * nothing is permitted to correct afterwards.
   *
   * The actor is the account that already existed, not whoever made the attempt
   * — nothing about them has been established, which is the point.
   */
  DUPLICATE_REGISTRATION_ATTEMPTED = 'DUPLICATE_REGISTRATION_ATTEMPTED',
  EMAIL_VERIFICATION_REQUESTED = 'EMAIL_VERIFICATION_REQUESTED',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',
  LOGIN_SUCCEEDED = 'LOGIN_SUCCEEDED',
  /** Recorded with the reason, which the person attempting it is never told. */
  LOGIN_FAILED = 'LOGIN_FAILED',
  SESSION_RENEWED = 'SESSION_RENEWED',
  /** Recorded when a credential that has already been used is presented again. */
  SESSION_REUSE_DETECTED = 'SESSION_REUSE_DETECTED',
  LOGGED_OUT = 'LOGGED_OUT',
  SESSION_REVOKED = 'SESSION_REVOKED',
  ALL_SESSIONS_REVOKED = 'ALL_SESSIONS_REVOKED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED = 'PASSWORD_RESET_COMPLETED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  IDENTITY_UNLINKED = 'IDENTITY_UNLINKED',
  PROFILE_UPDATED = 'PROFILE_UPDATED',
  ACCOUNT_DELETED = 'ACCOUNT_DELETED',
  USER_STATUS_CHANGED = 'USER_STATUS_CHANGED',
  PLATFORM_ROLE_CHANGED = 'PLATFORM_ROLE_CHANGED',
  /** Every time platform administration is used to pass a check that would otherwise deny. */
  PLATFORM_ADMIN_OVERRIDE = 'PLATFORM_ADMIN_OVERRIDE',
  ORGANIZATION_CREATED = 'ORGANIZATION_CREATED',
  ORGANIZATION_UPDATED = 'ORGANIZATION_UPDATED',
  ORGANIZATION_DELETED = 'ORGANIZATION_DELETED',
  MEMBER_INVITED = 'MEMBER_INVITED',
  /** An invitation withdrawn by an organization before anybody accepted it. */
  INVITATION_REVOKED = 'INVITATION_REVOKED',
  INVITATION_ACCEPTED = 'INVITATION_ACCEPTED',
  MEMBER_ROLE_CHANGED = 'MEMBER_ROLE_CHANGED',
  MEMBER_REMOVED = 'MEMBER_REMOVED',
  GRANT_CREATED = 'GRANT_CREATED',
  GRANT_REVOKED = 'GRANT_REVOKED',
  /** A second way in was attached to an account that had proven itself first. */
  IDENTITY_LINKED = 'IDENTITY_LINKED',
  /**
   * A federated provider asserted an address that already belongs to an account,
   * and the assertion was refused rather than linked.
   *
   * The whole of discriminating test D11 lives on the other side of this entry.
   * Whoever made the attempt is told only that it failed; this is where the
   * server writes down what actually happened, and it is the entry a reader
   * looking for an attempted takeover would search for. The actor is the account
   * that already existed — nothing has been established about whoever made the
   * attempt, which is the point.
   */
  FEDERATED_LINK_REFUSED = 'FEDERATED_LINK_REFUSED',
  /**
   * An authenticated actor tried to link a federated subject another account
   * already holds.
   *
   * **The actor rule is the opposite of {@link AuditAction.FEDERATED_LINK_REFUSED}'s,
   * and the reason is the difference between the two situations, not a
   * stylistic choice.** `FEDERATED_LINK_REFUSED` records the incumbent
   * because a sign-in attempt arrives unauthenticated — nothing has been
   * established about whoever made it, so naming the account that already
   * existed is the only honest entry available. Here the opposite is true:
   * the actor is authenticated before this flow ever begins — proving who
   * they are is the entire reason a link flow exists rather than a second
   * sign-in — so everything is established about them, and recording the
   * incumbent instead would attribute the attempt to an account that did
   * nothing while losing the identity of the account that made it. That is
   * not merely less useful; it is a false statement in a table nothing is
   * permitted to correct, of exactly the kind a reader investigating "who
   * tried to claim this identity" would be misled by. The actor recorded
   * here is the one making the attempt, never the incumbent.
   */
  IDENTITY_LINK_CONFLICT = 'IDENTITY_LINK_CONFLICT',
  /**
   * A second factor was attached to an account, by the account holder, once it
   * had been confirmed.
   *
   * The actor is the account the method now belongs to, and it is also the one
   * making the request: enrollment is refused unless a session already names it,
   * so nothing here is inferred. Recorded at confirmation, not at the start of
   * enrollment, because only a confirmed method is a factor: an abandoned
   * enrollment gates nothing and is not an event worth reconstructing. The
   * resource is the method, never the secret or the public key behind it — this
   * table is read by people who must never be able to reconstruct a factor from
   * it.
   */
  MFA_METHOD_ADDED = 'MFA_METHOD_ADDED',
  /**
   * A confirmed second factor was taken off an account, by the account holder.
   *
   * The actor is the account it was removed from, which is also the account that
   * asked: the request arrives on a session, and removing the last confirmed
   * factor additionally demands a fresh proof of one. The entry says whether
   * that proof was supplied, because "removed while other factors remained" and
   * "removed after re-proving" are different facts to somebody reading the trail
   * after a takeover. Discarding an enrollment that was never confirmed is not
   * recorded: it was never recorded as added, and an entry for it would describe
   * the removal of something the trail never saw exist.
   */
  MFA_METHOD_REMOVED = 'MFA_METHOD_REMOVED',
  /**
   * Credentials were accepted and a second factor was demanded before any
   * session was opened. **It records that a challenge was issued, not that
   * anybody proved anything**: whoever received it has shown a correct password
   * or a provider's assertion and nothing more, and the outcome is
   * {@link AuditAction.MFA_CHALLENGE_SUCCEEDED} or
   * {@link AuditAction.MFA_CHALLENGE_FAILED} if it ever arrives.
   *
   * It exists because the alternative was silence: a federated sign-in reaches
   * this point with no local credential presented at all, and a challenge that
   * is issued and never answered would otherwise leave nothing behind. The actor
   * is the account the challenge was minted for, because that is the one thing
   * established at this moment. It is not evidence that the account's owner was
   * the one who asked.
   */
  MFA_CHALLENGE_ISSUED = 'MFA_CHALLENGE_ISSUED',
  /**
   * A second factor was presented for a pending sign-in and held; the session
   * that follows is recorded separately as {@link AuditAction.LOGIN_SUCCEEDED}.
   *
   * The actor is the account the challenge was minted for. It is read off the
   * challenge row this server wrote and never off the request that spent it, so
   * it names the account whose first factor really did pass, not whoever the
   * caller of an unauthenticated route claimed to be.
   */
  MFA_CHALLENGE_SUCCEEDED = 'MFA_CHALLENGE_SUCCEEDED',
  /**
   * A second factor was presented for a pending sign-in and did not hold.
   *
   * **Recorded with the reason, which the person attempting it is never told** —
   * the discipline {@link AuditAction.LOGIN_FAILED} follows, and the reason the
   * challenge machinery raises a distinct error per cause rather than one shared
   * refusal: the collapse happens at the transport boundary, after this entry is
   * written. The actor is the account the challenge was minted for, which is the
   * only account established at that point. Nothing about whoever is guessing
   * has been, and naming any other account would attribute the guesses to
   * somebody who made none.
   *
   * A challenge refused before any account can be named (one that does not
   * exist, has expired or was already spent) is not recorded here: the error
   * carries no account, and an entry naming a guessed one would be a false
   * statement in a table nothing may correct.
   */
  MFA_CHALLENGE_FAILED = 'MFA_CHALLENGE_FAILED',
  /**
   * A fresh set of recovery codes replaced the previous set, at the account
   * holder's request, after a second factor was proven.
   *
   * The actor is the account the codes belong to, and also the one asking: the
   * route requires both a session and a live proof. Every code from the earlier
   * set stopped working when this happened, which is the fact the entry is for.
   * The codes themselves are never written here. The first set, issued when an
   * account's first method is confirmed, is not this event and is noted on
   * {@link AuditAction.MFA_METHOD_ADDED} instead.
   */
  RECOVERY_CODES_REGENERATED = 'RECOVERY_CODES_REGENERATED',
  /**
   * A recovery code was spent.
   *
   * The actor is the account the code was issued to: consumption is scoped by
   * that account, so a code belonging to somebody else does not match and
   * produces no entry. It is recorded whether the code was used to sign in or to
   * re-prove a factor, because either way one of a finite set is gone.
   */
  RECOVERY_CODE_CONSUMED = 'RECOVERY_CODE_CONSUMED',
  /**
   * A federated authorization row was completed and found to be in a state this
   * application never writes.
   *
   * Two shapes reach it: a `purpose` that is neither of the two values a row is ever
   * created with, and a link-purpose row with no owner. Neither is reachable through a
   * request this application accepts, so reaching either means the stored row is corrupt,
   * which is when a trace is worth most. The caller is refused with the same outward code
   * as an unknown authorization; the metadata says which shape it was. No account has
   * been established at this point, so the actor is null.
   */
  FEDERATED_AUTHORIZATION_CORRUPT = 'FEDERATED_AUTHORIZATION_CORRUPT',
}
