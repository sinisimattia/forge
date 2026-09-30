import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { I18nContext, I18nValidationError, I18nValidationException } from 'nestjs-i18n';
import {
  ConsumedTokenError,
  ExpiredTokenError,
  InvalidCredentialsError,
  SessionNotFoundError,
} from '__FORGE_SCOPE__/core/auth/errors';
import {
  IdentityAlreadyLinkedError,
  IdentityNotFoundError,
  LastIdentityRemovalError,
  WeakPasswordError,
} from '__FORGE_SCOPE__/core/identities/errors';
import { DEFAULT_PASSWORD_POLICY } from '__FORGE_SCOPE__/core/identities/policies';
import type { PasswordPolicyViolation } from '__FORGE_SCOPE__/core/identities/types';
import {
  CrossTenantGrantError,
  GrantNotFoundError,
} from '__FORGE_SCOPE__/core/authorization/errors';
import {
  AlreadyAMemberError,
  InvalidOrganizationSlugError,
  InvitationAddressMismatchError,
  InvitationNoLongerOpenError,
  InvitationNotFoundError,
  LastOwnerError,
  MembershipNotFoundError,
  OrganizationNameRequiredError,
  OrganizationNotFoundError,
} from '__FORGE_SCOPE__/core/organizations/errors';
import {
  MfaLabelRequiredError,
  MfaMethodAlreadyConfirmedError,
  MfaMethodNotFoundError,
  MfaReauthenticationRequiredError,
  MfaVerificationFailedError,
  RecoveryCodeAlreadyConsumedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import { DomainError } from '__FORGE_SCOPE__/core/shared/errors';
import {
  DisplayNameRequiredError,
  EmailAlreadyRegisteredError,
  UserNotFoundError,
} from '__FORGE_SCOPE__/core/users/errors';
import { I18nArgs, I18nKey, TranslatableErrorResponse } from '../i18n/i18n.types';

/** A single field-level error detail in the client-facing response shape. */
interface ResponseDetail {
  field: string;
  message: string;
}

/**
 * One reason a password was refused, as a caller receives it.
 *
 * Two fields because two audiences. `code` is core's own
 * `PasswordPolicyViolation`, so a client can switch on it exhaustively — the
 * webapp evaluates the same union and a member added to it becomes a compile
 * error there rather than an unrendered string. `message` is that reason in
 * prose, already translated, so a caller with no knowledge of the union has
 * something to show without inventing wording of its own.
 *
 * Deliberately **not** `details`, which is the field-level shape validation
 * errors use. These are not field-level: the field a password arrives in is
 * `secret` on registration and recovery and `newSecret` on a change, and the
 * domain error knows none of them. Putting them in `details` would mean
 * inventing a field name that is wrong on one endpoint out of three.
 */
interface ResponseViolation {
  /** Core's `PasswordPolicyViolation` member. */
  code: PasswordPolicyViolation;
  /** The same reason, translated. */
  message: string;
}

/**
 * The translation key for every way a password can be refused.
 *
 * A `Record` keyed by the union rather than a template string, and the
 * difference is the whole point: `` `errors.auth.password.${violation}` `` reads
 * fine and silently emits a raw key as the user-facing message the day the union
 * grows a member with no translation behind it. This map does not compile
 * without every member — and the union grew one two rounds ago (`BREACHED`), so
 * that is a live hazard and not a hypothetical.
 *
 * `__tests__/http-exception.filter.spec.ts` carries the other half: that each of
 * these keys resolves to real prose in `i18n/en/errors.json`, which the compiler
 * cannot see.
 */
const PASSWORD_VIOLATION_KEYS: Record<PasswordPolicyViolation, I18nKey> = {
  TOO_SHORT: 'errors.auth.password.TOO_SHORT',
  TOO_LONG: 'errors.auth.password.TOO_LONG',
  NEEDS_MIXED_CASE: 'errors.auth.password.NEEDS_MIXED_CASE',
  NEEDS_DIGIT: 'errors.auth.password.NEEDS_DIGIT',
  BREACHED: 'errors.auth.password.BREACHED',
};

/**
 * The numbers the password messages interpolate.
 *
 * Read from the same constant the judgement was made against
 * (`AuthService` applies `DEFAULT_PASSWORD_POLICY`), so a deployment that
 * changes its policy changes what people are told in the same edit. A literal
 * here would be a second copy of a number, and the failure would be a message
 * telling somebody to use twelve characters when the rule now says sixteen.
 */
const POLICY_ARGS: I18nArgs = {
  minLength: DEFAULT_PASSWORD_POLICY.minLength,
  maxLength: DEFAULT_PASSWORD_POLICY.maxLength,
};

/**
 * How a refusal the domain expressed becomes a status and a message.
 *
 * **Without this table every one of these is a `500`**, because a `DomainError`
 * is not an `HttpException` and falls through to the internal-error branch
 * below. That is not a cosmetic difference: a person presenting a verification
 * link twice, or renewing with a credential that has lapsed, is doing something
 * ordinary, and answering it with "an unexpected error occurred" tells them —
 * and whoever is watching the error rate — that the server is broken.
 *
 * `message` is always a translation key, never `error.message`. A domain error's
 * own message is written for a developer reading a log and can name identifiers
 * (`No session with id "..."`); none of it reaches a response.
 *
 * The order matters where one error extends another; today none of them do, and
 * the first match wins either way.
 *
 * ## `code`, and why a status is not enough
 *
 * Each row also carries a stable, machine-readable name that goes into the
 * response as `code`. **It is what makes this API's refusals implementable by a
 * caller, and its absence was a real defect rather than a missing nicety.**
 * `ConsumedTokenError` and `ExpiredTokenError` share `410` on purpose, three
 * different errors share `404`, and three more share `409`; the only other thing
 * that distinguished any of them was `message`, which is translated prose and
 * therefore changes with the reader's language. A caller obliged to honour
 * `IAuthService.verifyEmail` — which names both token errors — could not.
 *
 * It is deliberately not the class name. A class is renamed by a refactor and a
 * wire contract is not, so these are written out as their own vocabulary and a
 * rename that wants to change one has to come here and say so.
 */
const DOMAIN_ERRORS: {
  type: new (...args: never[]) => DomainError;
  status: HttpStatus;
  messageKey: I18nKey;
  code: string;
}[] = [
  // 401, not 403: the caller has not proven who they are, rather than having
  // been found not to be allowed.
  { type: InvalidCredentialsError, status: HttpStatus.UNAUTHORIZED, messageKey: 'errors.auth.invalid_credentials', code: 'INVALID_CREDENTIALS' },
  // 410 Gone for both, and two different keys. The statuses match because only
  // somebody who held a real credential can reach either, so telling them apart
  // reveals nothing to a guesser and is the difference between "try again" and
  // "you already did this". The two `code`s are what let a caller act on that
  // difference; without them the status is all a caller has and the distinction
  // this pair exists to draw is invisible outside the server.
  { type: ConsumedTokenError, status: HttpStatus.GONE, messageKey: 'errors.auth.token_consumed', code: 'TOKEN_CONSUMED' },
  { type: ExpiredTokenError, status: HttpStatus.GONE, messageKey: 'errors.auth.token_expired', code: 'TOKEN_EXPIRED' },
  // 404, which is what it means at every call site but one: no session the
  // caller may see answers to that id. The renewal endpoint turns it into a 401
  // itself, because there it means the credential presented is dead — see
  // `AuthController.refreshSession`.
  { type: SessionNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.auth.session_not_found', code: 'SESSION_NOT_FOUND' },
  { type: WeakPasswordError, status: HttpStatus.UNPROCESSABLE_ENTITY, messageKey: 'errors.auth.weak_password', code: 'WEAK_PASSWORD' },
  { type: UserNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.http.not_found', code: 'USER_NOT_FOUND' },
  { type: IdentityNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.http.not_found', code: 'IDENTITY_NOT_FOUND' },
  // Also the answer for an organization the caller is not a member of —
  // `OrganizationNotFoundError` is the one error `OrganizationsService` raises
  // for both, on purpose (see its own TSDoc). `messageKey` is deliberately
  // `errors.http.not_found`, the SAME key `UserNotFoundError` uses, rather
  // than an organization-specific one: a distinct key would put back through
  // the body exactly what the shared 404 status was chosen to keep out — that
  // a non-member's guess named a real organization. Before this row existed,
  // every one of these fell through to the unnamed-domain-error branch below
  // and answered 422, which leaks the same fact a different way: 422 confirms
  // the id parsed as a UUID and reached the service, 404 does not distinguish
  // "not yours" from "not real" at all.
  { type: OrganizationNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.http.not_found', code: 'ORGANIZATION_NOT_FOUND' },
  // The same collapse, for the same reason, one level down: a membership
  // outside an organization the actor may see is answered exactly as a
  // membership id nobody ever issued. `changeMemberRole` and `removeMember`
  // never reach this error for a non-member actor at all — `requireMember`
  // throws `OrganizationNotFoundError` first — so this row is reached only
  // once the actor's own standing is already established, and it is still
  // the shared 404 key rather than a membership-specific one, so that
  // "no such member" and "you may not see whether they are one" stay one
  // answer in the body as well as the status.
  { type: MembershipNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.http.not_found', code: 'MEMBERSHIP_NOT_FOUND' },
  // The same shared 404 key, one level down again: a token that redeems
  // nothing is answered exactly as an id nobody ever issued would be, in
  // status and in body. Deliberately NOT merged with `InvitationNoLongerOpenError`
  // below — core's own TSDoc on that error explains why: the enumeration-oracle
  // argument that justifies collapsing "you may not see it" into "it does not
  // exist" elsewhere on this table depends on the identifier being guessable,
  // and a 32-byte CSPRNG token from `generateOpaqueToken` is not. Nobody can
  // present a token that was real once without having held it, so telling
  // "never issued" apart from "issued and now closed" here reveals nothing to
  // a guesser — it only tells somebody managing invitations whether there is
  // anything left to withdraw.
  { type: InvitationNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.http.not_found', code: 'INVITATION_NOT_FOUND' },
  // 410 Gone, not 409 and not 404. Only somebody who once held a real,
  // single-use token can reach this branch at all — the row above already
  // catches everyone else — so the status tells a caller nothing they did not
  // already know by holding it: that it is real, and that it no longer works.
  // `errors.http.gone` is a new shared key rather than three domain-specific
  // ones, because this is already the collapse of three domain reasons —
  // revoked, already accepted, expired — into ONE error in core
  // (`InvitationNoLongerOpenError`'s own TSDoc, spec §9.4): giving the three a
  // single message here is completing the same collapse the domain already
  // made, not inventing a new one. 409 was considered and rejected: unlike
  // `LastOwnerError` or `AlreadyAMemberError`, which fail again on an
  // unmodified resend until something else about the membership set changes,
  // this refusal is permanent — resubmitting the identical request never
  // succeeds, which is exactly what 410 means and 409 does not.
  { type: InvitationNoLongerOpenError, status: HttpStatus.GONE, messageKey: 'errors.http.gone', code: 'INVITATION_NO_LONGER_OPEN' },
  // 403, and the shared `errors.http.forbidden` key — not a new one, and not
  // the same status as either invitation row above. Reaching this branch
  // already requires holding a real, currently open invitation:
  // `OrganizationsService.acceptInvitation` judges openness first, precisely
  // so this check is never reached by a token that is merely closed (see that
  // method's own TSDoc for why the order is load-bearing). So a caller here
  // learns only what holding the token already told them — that it is real
  // and open — and that redemption is refused because of WHO is asking, not
  // WHAT was presented. That is what 403 means and what 404 or 410 would
  // misstate: this is not a hidden or a spent resource, it is a real one this
  // account may not act on.
  { type: InvitationAddressMismatchError, status: HttpStatus.FORBIDDEN, messageKey: 'errors.http.forbidden', code: 'INVITATION_ADDRESS_MISMATCH' },
  { type: OrganizationNameRequiredError, status: HttpStatus.UNPROCESSABLE_ENTITY, messageKey: 'errors.http.unprocessable', code: 'ORGANIZATION_NAME_REQUIRED' },
  { type: InvalidOrganizationSlugError, status: HttpStatus.UNPROCESSABLE_ENTITY, messageKey: 'errors.http.unprocessable', code: 'INVALID_ORGANIZATION_SLUG' },
  // 409, the same status `LastIdentityRemovalError` gets and for the same
  // shape of reason: this is not a hidden thing (an organization the caller
  // cannot see, or a resource that never existed) and it is not the request
  // being malformed — it is a legal request refused because of the CURRENT
  // state of the membership set, and the identical request would succeed
  // once a second OWNER exists. 404 would be a lie (there is a real
  // membership, and the actor can see it); 422 is what every domain error
  // this table does not name falls through to, and this one deserves a name:
  // a caller that wants to detect "you cannot demote/remove the sole owner"
  // specifically, rather than "something about this request was refused",
  // needs a stable `code` to switch on, which is what this row is for.
  { type: LastOwnerError, status: HttpStatus.CONFLICT, messageKey: 'errors.http.conflict', code: 'LAST_OWNER' },
  // Also 409, and also state rather than shape: the request is well-formed
  // and the address is real, and it is refused because of who this
  // organization's members already are. Grouped with `LastOwnerError` and
  // `LastIdentityRemovalError` on purpose — all three are "cannot, given the
  // current state of a set", none of them "cannot, given what you sent".
  { type: AlreadyAMemberError, status: HttpStatus.CONFLICT, messageKey: 'errors.http.conflict', code: 'ALREADY_A_MEMBER' },
  // 422 and a code, rather than falling through to the unnamed-domain-error
  // branch below. A blank display name is the one refusal `PATCH /users/me` can
  // raise from the domain, and a caller that had to infer it from "a 422 on this
  // path" would be reading the route rather than the answer.
  { type: DisplayNameRequiredError, status: HttpStatus.UNPROCESSABLE_ENTITY, messageKey: 'errors.http.unprocessable', code: 'DISPLAY_NAME_REQUIRED' },
  { type: EmailAlreadyRegisteredError, status: HttpStatus.CONFLICT, messageKey: 'errors.http.conflict', code: 'EMAIL_ALREADY_REGISTERED' },
  { type: IdentityAlreadyLinkedError, status: HttpStatus.CONFLICT, messageKey: 'errors.http.conflict', code: 'IDENTITY_ALREADY_LINKED' },
  { type: LastIdentityRemovalError, status: HttpStatus.CONFLICT, messageKey: 'errors.http.conflict', code: 'LAST_IDENTITY_REMOVAL' },
  // The shared 404 key `UserNotFoundError` and `OrganizationNotFoundError`
  // both use, one level down again: a grant belonging to another
  // organization answers exactly as an id nobody ever issued — core's own
  // TSDoc on `GrantNotFoundError` states the collapse, so that trying grant
  // ids in turn reveals nothing about another tenant's exceptions.
  { type: GrantNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.http.not_found', code: 'GRANT_NOT_FOUND' },
  // 409, not 404 and not 422. Grouped with `LastOwnerError` and
  // `AlreadyAMemberError` on purpose: this is not a hidden thing (the
  // organization and the subject are both real, and both visible to the
  // actor issuing the grant, which is precisely what `grant:create` already
  // established) and it is not the request being malformed (`subjectUserId`
  // is a well-formed id for a real account) — it is refused because of the
  // CURRENT state of the organization's membership set, and the identical
  // request would succeed the moment that same person becomes a member. That
  // is 409's meaning exactly, and it is the same shape of reason
  // `AlreadyAMemberError` is grouped under one row above — the mirror image
  // of it, in fact: that one refuses because somebody already IS a member,
  // this one refuses because somebody is NOT one (yet). 404 was rejected
  // because nothing here is hidden — the actor already has `grant:create` in
  // this very organization, which is not true of anything else this table
  // collapses into 404 — and 422 was rejected because the request is not
  // malformed, it is a legal ask about a set that has to change first.
  { type: CrossTenantGrantError, status: HttpStatus.CONFLICT, messageKey: 'errors.http.conflict', code: 'CROSS_TENANT_GRANT' },
  // The refusals of managing one's own second factors (`/mfa/*`). Not
  // reached by `POST /auth/mfa/verify`, which flattens every one of its
  // refusals into a single `401` itself and never lets these through.
  //
  // 404 for a method that is not the caller's, and the shared key for the same
  // reason as every 404 above: a method belonging to somebody else answers as
  // one that does not exist.
  { type: MfaMethodNotFoundError, status: HttpStatus.NOT_FOUND, messageKey: 'errors.http.not_found', code: 'MFA_METHOD_NOT_FOUND' },
  // 409: state, not shape. The request is well-formed and the method is real and
  // the caller's; it is refused because confirmation already happened, and
  // resending changes nothing.
  { type: MfaMethodAlreadyConfirmedError, status: HttpStatus.CONFLICT, messageKey: 'errors.http.conflict', code: 'MFA_METHOD_ALREADY_CONFIRMED' },
  // 422, and not 401: the caller's session is fine, it is the code they typed
  // that is wrong. A 401 would be read by the webapp's transport as a dead
  // credential and set off a renewal.
  { type: MfaVerificationFailedError, status: HttpStatus.UNPROCESSABLE_ENTITY, messageKey: 'errors.http.unprocessable', code: 'MFA_VERIFICATION_FAILED' },
  { type: MfaLabelRequiredError, status: HttpStatus.UNPROCESSABLE_ENTITY, messageKey: 'errors.http.unprocessable', code: 'MFA_LABEL_REQUIRED' },
  // 403, and not 401: the session is valid and is who it says it is; it is not
  // *enough* for this action. A 401 would set off a token renewal that cannot
  // help, and the webapp reads this code as "ask for a second-factor proof".
  { type: MfaReauthenticationRequiredError, status: HttpStatus.FORBIDDEN, messageKey: 'errors.http.forbidden', code: 'MFA_REAUTHENTICATION_REQUIRED' },
  // 422 like a wrong code, and for the same reason. Distinct from it because the
  // caller is signed in and the difference reveals nothing they could not learn
  // from their own sheet: this code was theirs and is spent.
  { type: RecoveryCodeAlreadyConsumedError, status: HttpStatus.UNPROCESSABLE_ENTITY, messageKey: 'errors.http.unprocessable', code: 'RECOVERY_CODE_ALREADY_CONSUMED' },
];

/**
 * Every code this API can emit, sorted, as a value.
 *
 * It exists so that the copy of this vocabulary the webapp has to keep
 * (`apps/webapp/app/types/api.ts`) can be pinned against a literal list on each
 * side. The two apps share no package a wire code could live in — it is
 * transport vocabulary, so `libs/core` may not hold it (ADR-0008) — and nothing
 * else would notice the copies drifting: the webapp's own conformance stub emits
 * the strings the webapp switches on, so a rename there keeps the webapp
 * internally consistent and makes it externally wrong, silently.
 *
 * Derived from the table rather than written out again, so that a row added
 * without a matching literal in this module's spec turns that spec red.
 */
export const DOMAIN_ERROR_CODES: readonly string[] = DOMAIN_ERRORS
  .map((entry) => entry.code)
  .sort((left, right) => left.localeCompare(right));

/**
 * The codes this API emits **with a `401`**.
 *
 * Derived rather than written out, and exported for one reason: the webapp's
 * `createAuthFetch` renews a session on a `401` and must not do so for a `401`
 * that answers the *request* rather than the credential. It tells them apart by
 * `code !== undefined`, which is correct only while two things hold — a
 * framework `401` carries no code (it takes this filter's generic branch), and
 * the domain names exactly one 401. Neither was asserted anywhere, and a rule
 * resting on an unasserted invariant is the same defect one level down: the next
 * 401 added to the table above would silently change what the webapp's transport
 * does to it.
 *
 * So this list exists to be pinned, in this file's own spec, against a literal.
 * It is the only reason it is exported.
 */
export const UNAUTHORIZED_DOMAIN_ERROR_CODES: readonly string[] = DOMAIN_ERRORS
  .filter((entry) => entry.status === HttpStatus.UNAUTHORIZED)
  .map((entry) => entry.code)
  .sort((left, right) => left.localeCompare(right));

/** Generic fallback translation key for framework-originated HTTP statuses. */
const HTTP_STATUS_FALLBACK_KEY: Record<number, I18nKey> = {
  [HttpStatus.BAD_REQUEST]: 'errors.http.bad_request',
  [HttpStatus.UNAUTHORIZED]: 'errors.http.unauthorized',
  [HttpStatus.FORBIDDEN]: 'errors.http.forbidden',
  [HttpStatus.NOT_FOUND]: 'errors.http.not_found',
  [HttpStatus.CONFLICT]: 'errors.http.conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'errors.http.unprocessable',
};

/**
 * Postgres SQLSTATEs a `SERIALIZABLE` transaction is documented to fail with
 * for a reason that has nothing to do with the request itself: `40001`
 * (`serialization_failure`) is what `OrganizationsService.changeMemberRole`
 * and `removeMember`'s own TSDoc names as the cost of that isolation level,
 * and `40P01` (`deadlock_detected`) is the other outcome Postgres defines for
 * two transactions that cannot both proceed. Both are resolved the same way —
 * the whole transaction re-run, unmodified — which is why they share one
 * branch here rather than two.
 */
const RETRYABLE_TRANSACTION_CODES = new Set(['40001', '40P01']);

/**
 * Whether a caught error is one of {@link RETRYABLE_TRANSACTION_CODES}.
 *
 * Matched on SQLSTATE rather than on the driver's message text, for the same
 * reason `AuthService.isUniqueViolation` matches `23505` that way: the
 * message is localized by the server's own settings and a match on it stops
 * matching after a Postgres upgrade. TypeORM wraps the underlying `pg` error
 * in a `QueryFailedError` and copies every one of the driver error's own
 * properties onto it (see typeorm's `QueryFailedError` constructor), so
 * `.code` reads straight off the caught exception without this filter
 * importing `QueryFailedError` itself — the same duck-typed check
 * `isUniqueViolation` already uses, kept duck-typed here for the same reason.
 */
function isRetryableTransactionConflict(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && RETRYABLE_TRANSACTION_CODES.has(String((error as { code?: unknown }).code))
  );
}

/**
 * Global exception filter that produces the standard
 * `{ error, message, code?, details? }` response. All user-facing text is resolved through `nestjs-i18n` using the
 * request-scoped `I18nContext`:
 * - `I18nValidationException` (from `I18nValidationPipe`) → translated per-field details.
 * - `HttpException` carrying a `TranslatableErrorResponse` (`messageKey`) → translated message.
 * - Any other `HttpException` (framework-originated) → generic translated message for its status.
 * - `DomainError` from `__FORGE_SCOPE__/core` → the status and key `DOMAIN_ERRORS` gives it,
 *   or `422` for one it does not name. A refusal the domain expressed is a
 *   statement about the request, not a fault, and must never answer `500`.
 *   `WeakPasswordError` additionally carries a `violations` array — see
 *   {@link ResponseViolation}.
 * - A `SERIALIZABLE` transaction's own documented failure (`40001`) or a plain
 *   deadlock (`40P01`) → `409` with `code: 'SERIALIZATION_CONFLICT'`, telling
 *   the caller the one thing a `500` cannot: that resending the SAME request
 *   is the expected remedy, not a bug to report. See
 *   {@link isRetryableTransactionConflict}.
 * - Anything else → translated internal-error message.
 *
 * The `error` field stays the canonical HTTP reason phrase (a protocol-level
 * identifier derived from the status code), not localized prose.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const i18n = I18nContext.current(host);

    const translate = (key: I18nKey, args?: I18nArgs): string =>
      i18n ? i18n.translate(key, { args }) : key;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string;
    let details: ResponseDetail[] | undefined;
    let violations: ResponseViolation[] | undefined;
    let errorOverride: string | undefined;
    let code: string | undefined;

    if (exception instanceof I18nValidationException) {
      status = exception.getStatus();
      message = translate('errors.common.validation_failed');
      details = this.flattenValidationErrors(exception.errors);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const translatable = this.asTranslatable(exceptionResponse);

      if (translatable) {
        message = translate(translatable.messageKey, translatable.args);
        errorOverride = translatable.error;
        if (translatable.details?.length) {
          details = translatable.details.map((detail) => ({
            field: detail.field,
            message: translate(detail.messageKey, detail.args),
          }));
        }
      } else {
        message = translate(HTTP_STATUS_FALLBACK_KEY[status] ?? 'errors.http.internal');
      }
    } else if (exception instanceof DomainError) {
      const mapped = DOMAIN_ERRORS.find((entry) => exception instanceof entry.type);
      // 422 for a domain error this table does not name, NOT 500. A refusal the
      // domain expressed is a statement about the request; the alternative is
      // that every core error added in a later phase silently becomes an
      // internal-server-error until somebody notices, which is the failure this
      // whole branch exists to stop.
      status = mapped?.status ?? HttpStatus.UNPROCESSABLE_ENTITY;
      message = translate(mapped?.messageKey ?? 'errors.http.unprocessable');
      // Absent for a domain error this table does not name, which is the
      // truthful answer: there is no stable name to give it yet. A caller then
      // sees the 422 and no code, and treats it as a refusal it does not
      // understand — which is what it is.
      code = mapped?.code;

      // The list core built, rendered. `WeakPasswordError` carries every way a
      // password fell short precisely so a caller can show a person all of them
      // at once — core's own comment says the list "is what a caller shows the
      // person" — and for a phase this filter dropped it, so the person was told
      // only that something was wrong with a password they could not see.
      //
      // When there is exactly one, it becomes the message. That is a rule rather
      // than a special case for `BREACHED`, and it generalises: a single-reason
      // refusal is the common one, and "Use at least 12 characters" is a better
      // sentence than "does not meet this deployment's requirements" whatever the
      // reason happens to be. Several reasons keep the summary, because there is
      // no one sentence to promote and `violations` carries them all.
      if (exception instanceof WeakPasswordError) {
        violations = exception.violations.map((violation) => ({
          code: violation,
          message: translate(PASSWORD_VIOLATION_KEYS[violation], POLICY_ARGS),
        }));
        if (violations.length === 1) message = violations[0].message;
      }
    } else if (isRetryableTransactionConflict(exception)) {
      // 409, not 500 and not 503. Not 500: this is one of the two outcomes
      // `SERIALIZABLE` (or a plain deadlock) is documented to produce, not the
      // server being broken, and answering it the same way as `boom` tells
      // whoever is watching the error rate — and the caller — nothing. Not
      // 503: this transaction specifically lost a race with another one that
      // ran concurrently with it; no other request is unavailable, and a
      // caller that backs off every endpoint on a `503` would be reacting to
      // the wrong scope. 409 puts this beside this table's other conflicts —
      // but unlike `LAST_OWNER` or `LAST_IDENTITY_REMOVAL`, which fail again
      // on an unmodified resend until something else about the world changes,
      // resending THIS exact request is the correct and expected remedy. That
      // is the whole reason it gets its own message
      // (`errors.http.conflict_retryable`, not the shared `errors.http.conflict`)
      // and its own `code` — a caller has to be able to tell "retry this" from
      // "do not retry this" without parsing translated prose.
      status = HttpStatus.CONFLICT;
      code = 'SERIALIZATION_CONFLICT';
      message = translate('errors.http.conflict_retryable');
    } else {
      message = translate('errors.common.internal');
    }

    const error = errorOverride ?? this.reasonPhrase(status);

    response.status(status).json({
      error,
      message,
      ...(code ? { code } : {}),
      ...(details ? { details } : {}),
      ...(violations ? { violations } : {}),
    });
  }

  /** Narrows an exception response body to our translatable payload, if it is one. */
  private asTranslatable(
    exceptionResponse: string | object,
  ): TranslatableErrorResponse | undefined {
    if (
      typeof exceptionResponse === 'object'
      && exceptionResponse !== null
      && typeof (exceptionResponse as Record<string, unknown>).messageKey === 'string'
    ) {
      return exceptionResponse as TranslatableErrorResponse;
    }
    return undefined;
  }

  /** Flattens (already-translated) validation errors into `{ field, message }`, using dotted paths for nested fields. */
  private flattenValidationErrors(
    errors: I18nValidationError[],
    parentPath = '',
  ): ResponseDetail[] {
    const details: ResponseDetail[] = [];
    for (const error of errors) {
      const field = parentPath ? `${parentPath}.${error.property}` : error.property;
      const messages = Object.values(error.constraints ?? {});
      if (messages.length) {
        details.push({ field, message: messages.join(', ') });
      }
      if (error.children?.length) {
        details.push(...this.flattenValidationErrors(error.children, field));
      }
    }
    return details;
  }

  /** Canonical HTTP reason phrase for a status code (e.g. 404 → "Not Found"). */
  private reasonPhrase(status: number): string {
    const key = HttpStatus[status];
    if (!key) {
      return 'Error';
    }
    return key
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
