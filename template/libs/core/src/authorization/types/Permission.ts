/**
 * Something a principal may or may not be allowed to do, as a
 * `resource:action` string.
 *
 * A checked union rather than a free string, because ADR-0006 makes every
 * access decision one call to `can`, and a free string turns a typo into a
 * silent denial that nobody notices until somebody cannot do their job. A
 * misspelled member here stops the build instead.
 *
 * **This union is the whole of what the deployment can be asked about today.**
 * ADR-0006 describes three layers — platform role, organization role, resource
 * grant — and members are added as the layers that give them meaning arrive; a
 * member added before anything can grant it is a permission nobody holds, which
 * reads as a rule and is a constant `false`. The organization members below
 * arrive with layer two, which `ROLE_PERMISSIONS` answers. The `grant:*` three
 * are about *administering* grants and are answered by layer two as well, which
 * is what keeps layer three — a grant deciding an ordinary permission — from
 * being able to widen itself. All three layers now exist.
 *
 * Documented here rather than one per member: a string-literal union member
 * carries no doc an editor will surface, so a comment attached to one is a
 * comment only a reader of this file ever sees — and it is this file they are
 * reading.
 *
 * ## The deployment
 *
 * - `platform:administer` — operating the deployment itself: listing every
 *   account, suspending one, granting or withdrawing platform administration.
 *   Holding it is what the audit log records as an override, because a pass
 *   here is a pass that the ordinary rules would have refused. **No
 *   organization role grants it**, and `ROLE_PERMISSIONS` is asserted against
 *   that: layer one is its only route. That holds for layer three as well, and
 *   by a mechanism worth naming here rather than leaving to be discovered —
 *   `can` excludes this member from the grant check **by name**, because a grant
 *   is issued under `grant:create`, which an organization's own ADMIN holds.
 *   Without that exclusion, somebody whose authority ends at one tenant could
 *   issue the one permission that has none.
 * - `audit:read` — reading history. Separate from `platform:administer` because
 *   the layer that splits them now exists: asked *with* an organization it is an
 *   administrator of that organization reading their own organization's
 *   entries; asked without one it is the deployment's whole history, which only
 *   layer one answers.
 * - `user:read` — reading a person's profile, one's own always and anybody's as
 *   a platform administrator. It is about a person rather than a tenant, so it
 *   is the one member layer two never answers.
 *
 * ## One organization
 *
 * - `organization:read` — seeing that the organization exists and what it is
 *   called. Every role has it; it is what belonging means.
 * - `organization:update` — renaming it, changing its settings.
 * - `organization:delete` — removing it and everything in it. An OWNER only:
 *   it is the one action no administrator can be delegated, because it ends the
 *   tenant the delegation was scoped to.
 * - `member:read` — seeing who else belongs and in what role.
 * - `member:invite` — offering somebody a place in it.
 * - `member:update` — changing somebody's role within it.
 * - `member:remove` — ending somebody's membership.
 * - `invitation:read` — seeing which offers are outstanding.
 * - `invitation:revoke` — withdrawing one before it is redeemed.
 * - `grant:read`, `grant:create`, `grant:revoke` — administering the
 *   record-level grants layer three reads. Administering a grant is an
 *   organization-scoped act and so is answered by layer two, which is what keeps
 *   layer three from being able to widen itself.
 */
export type Permission
  = 'platform:administer'
    | 'audit:read'
    | 'user:read'
    | 'organization:read'
    | 'organization:update'
    | 'organization:delete'
    | 'member:read'
    | 'member:invite'
    | 'member:update'
    | 'member:remove'
    | 'invitation:read'
    | 'invitation:revoke'
    | 'grant:read'
    | 'grant:create'
    | 'grant:revoke';
