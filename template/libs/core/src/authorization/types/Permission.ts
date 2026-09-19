/**
 * Something a principal may or may not be allowed to do, as a
 * `resource:action` string.
 *
 * A checked union rather than a free string, because ADR-0006 makes every
 * access decision one call to `can`, and a free string turns a typo into a
 * silent denial that nobody notices until somebody cannot do their job. A
 * misspelled member here stops the build instead.
 *
 * **This union is the whole of what the deployment can be asked about today,
 * and it is short because only the platform layer exists.** ADR-0006 describes
 * three layers — platform role, organization role, resource grant — and the
 * second and third arrive with organizations. Members are added as the layers
 * that give them meaning arrive; a member added before anything can grant it is
 * a permission nobody holds, which reads as a rule and is a constant `false`.
 *
 * The three that exist, documented here rather than one per member: a
 * string-literal union member carries no doc an editor will surface, so a
 * comment attached to one is a comment only a reader of this file ever sees —
 * and it is this file they are reading.
 *
 * - `platform:administer` — operating the deployment itself: listing every
 *   account, suspending one, granting or withdrawing platform administration.
 *   Holding it is what the audit log records as an override, because a pass
 *   here is a pass that the ordinary rules would have refused.
 * - `audit:read` — reading the deployment's history across every account.
 *   Separate from `platform:administer` even though the same people hold both
 *   today, because the layer that splits them is already written down: an
 *   organization administrator reading their own organization's entries is this
 *   permission against a resource, and is not permission to operate the
 *   deployment.
 * - `user:read` — reading a person's profile, one's own always and anybody's as
 *   an administrator. The one member an ordinary principal holds, which is what
 *   keeps the `permission` argument load-bearing rather than a second spelling
 *   of the role check.
 */
export type Permission
  = 'platform:administer'
    | 'audit:read'
    | 'user:read';
