import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import type { ClientContext, SessionId, SessionJSON } from '__FORGE_SCOPE__/core/auth/types';
import { isGrantLive } from '__FORGE_SCOPE__/core/authorization/policies';
import type {
  GrantId,
  ResourceGrantJSON,
} from '__FORGE_SCOPE__/core/authorization/types';
import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import {
  assertAtLeastOneIdentityRemains,
  DEFAULT_PASSWORD_POLICY,
  evaluatePassword,
} from '__FORGE_SCOPE__/core/identities/policies';
import {
  IdentityNotFoundError,
  LastIdentityRemovalError,
} from '__FORGE_SCOPE__/core/identities/errors';
import type { AuthIdentityId, AuthIdentityJSON } from '__FORGE_SCOPE__/core/identities/types';
import { Invitation, Membership, Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import { InvitationStatus, OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import {
  InvalidOrganizationSlugError,
  OrganizationNameRequiredError,
} from '__FORGE_SCOPE__/core/organizations/errors';
import type {
  InvitationId,
  InvitationJSON,
  MembershipId,
  MembershipJSON,
  OrganizationId,
  OrganizationJSON,
} from '__FORGE_SCOPE__/core/organizations/types';
import { normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { DisplayNameRequiredError } from '__FORGE_SCOPE__/core/users/errors';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { ApiError } from '~/fetchers';
import type {
  ApiClient,
  ApiErrorBody,
  ApiErrorCode,
  ApiRequest,
  PrincipalResponseBody,
  SessionResponseBody,
} from '~/types';

/**
 * A model of the backend, at the wire.
 *
 * This stub is a model of the backend, not the backend. It proves that the
 * webapp's services parse what the backend produces and map errors as the
 * contract requires. It proves nothing about whether the backend behaves
 * correctly — that is the backend's own conformance run and the end-to-end
 * walk. When the two disagree, the stub is what is wrong.
 *
 * That paragraph is the difference between DEC-1 being a design and DEC-1 being
 * a comment nobody read, so it is worth saying what it rules out in particular.
 * Nothing below is evidence that the backend answers `410` for a spent
 * verification credential, that its guard answers `404` rather than `403`, or
 * that a session is really revoked in its database. Every one of those is
 * asserted on the other side, against the real implementation, by the same core
 * suites. What is asserted here is the half no backend test can reach: that
 * given those answers, these services build the entities and raise the errors
 * the contracts name.
 *
 * ## What it observes about a client, and why nothing here asserts it
 *
 * A request carries no description of its client and this stub invents none: a
 * session it opens has `null` for both fields. That is what a browser really
 * produces, because the address is decided by the network and the label by the
 * user agent, and both are observed on the serving side. The property "what the
 * implementation could tell about the client reaches the store" is asserted in
 * `runIAuthServiceSecurityContract`, driven by the implementation that can
 * actually observe one.
 *
 * What a driver seeds through `putSession` is a different thing and is carried
 * faithfully: the world may hold a session with a client context, and the shared
 * suite's wire-shape test requires it to come back unchanged.
 *
 * ## Why the world is seeded as JSON and promised from the same literals
 *
 * Every `put*` below takes the wire shape and stores what the *entity* makes of
 * it — `User.fromJSON(seed).toJSON()` — because that is exactly what the backend
 * emits: a controller returns `entity.toJSON()`, never a stored row. A driver
 * then promises the world by building the entity from **its own literal**, not
 * by reading this stub back. That is the difference between an assertion and a
 * tautology: a stub that dropped a field on write would otherwise have the same
 * gap on both sides of every comparison and agree with itself.
 */

/**
 * Nothing is known about the client, which is what every request here says.
 *
 * A stub cannot observe a network address or a user agent, and neither can the
 * webapp whose transport it stands in for — so a session this stub opens carries
 * `null` for both, which is what the real pair would record for a client that
 * told it nothing.
 */
const NO_CLIENT: ClientContext = { address: null, label: null };

/** How long a session the stub opens lasts. A week, as the backend's does. */
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long an access credential lasts, in seconds, as the backend reports it.
 *
 * Exported because a test that asserts what came out of the DEC-3 seam needs a
 * right-hand side that is not the service's own answer, and this world is where
 * the number comes from.
 */
export const STUB_ACCESS_LIFETIME_SECONDS = 900;

/** What the backend's filter puts in `error` for the statuses this stub answers. */
const REASON_PHRASE: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Entity',
};

/** A user as this stub holds one: the wire shape the backend would emit, and the secret. */
interface StoredUser {
  json: UserJSON;
  secret: string;
}

/** A single-use credential the stub issued. */
interface StoredCredential {
  userId: UserId;
  expiresAt: Date;
  consumedAt: Date | null;
}

/** The world, plus the transport that serves it. */
export interface StubBackend {
  /**
   * The transport to build services on.
   *
   * **One per `stubBackend()` call, and the world behind it survives every
   * request made through it.** Building a fresh stub per request instead is the
   * mistake that makes a round-trip assertion fail as though the service were
   * wrong: the write lands in one world and the read happens in another.
   */
  readonly client: ApiClient;
  /** Puts a user in the world, exactly as the backend would hold and emit one. */
  putUser: (seed: UserJSON, secret: string) => void;
  /** Puts a session in the world. */
  putSession: (seed: SessionJSON) => void;
  /** Puts an identity in the world. */
  putIdentity: (seed: AuthIdentityJSON) => void;
  /** Issues a verification credential, valid until `expiresAt`. */
  putVerification: (userId: UserId, credential: string, expiresAt: Date) => void;
  /**
   * Puts an organization in the world, exactly as the backend would hold and
   * emit one.
   *
   * The organizations conformance driver's own comment explains why this
   * exists at all: `organization`, `owner`, `admin` and `member` are the
   * right-hand side of every comparison the shared suite makes, so a driver
   * that built them by calling `OrganizationHttpService.createOrganization`
   * would be comparing the service's answer with itself.
   */
  putOrganization: (seed: OrganizationJSON) => void;
  /** Puts a membership in the world. See `putOrganization` for why. */
  putMembership: (seed: MembershipJSON) => void;
  /**
   * The token this world minted when it issued one invitation.
   *
   * This is `tokenFor` from `IOrganizationServiceContractDeps`, made
   * concrete: the host knows how its own invitations are redeemed and the
   * suite must not, so a driver satisfies that dependency by asking the
   * stub for the value it already generated at `inviteMember` time rather
   * than inventing one of its own.
   *
   * @param invitationId - an invitation this world issued
   * @throws Error when no token was ever minted for it — a driver bug, since
   * every invitation `inviteMember` returns has one
   */
  tokenForInvitation: (invitationId: InvitationId) => string;
  /**
   * Every access credential this world has issued, oldest first.
   *
   * It exists for one test and could not be written without it: the DEC-3 seam
   * hands a caller the credential that arrived beside an outcome, and "the right
   * credential" has to be checked against what the **world** issued rather than
   * against what the service says it got. Comparing the service's answer with
   * itself would pass for a service that invented a value, or handed back the
   * previous one.
   */
  issuedCredentials: () => readonly string[];
  /**
   * The renewal cookie the browser is currently holding, or `null`.
   *
   * A driver reads it to assert that a rotation happened, and to check that the
   * value the browser ends up with is the one the world last issued rather than
   * one it has already spent.
   */
  renewalCookie: () => string | null;
  /**
   * How many renewals this world has been asked for.
   *
   * It exists for the concurrency assertion and cannot be written without it:
   * "three components mounting at once produce one renewal" is a claim about the
   * number of requests, and nothing on the store's own surface reports it.
   */
  refreshRequests: () => number;
  /**
   * Ends every session the user holds, without going through an endpoint.
   *
   * It models what happens *elsewhere*: the person signs out on another device,
   * an administrator revokes them, or reuse detection has already fired. There is
   * no request a client can make that produces this, which is why it is a driver
   * door rather than a route — and it is the only way to reach the one production
   * state the store's renewal path could not otherwise be tested in, a signed-in
   * store whose renewal cookie no longer buys anything.
   */
  endSessionsOf: (userId: UserId) => void;
  /**
   * Puts a value back in the browser's hand as its renewal cookie.
   *
   * The only way to present a **spent** credential deliberately. In the world it
   * happens two ways — two requests raced each other, or somebody else took a
   * copy — and neither is reproducible on demand, which is exactly why reuse
   * detection is the part of renewal that never gets tested.
   */
  presentRenewalCookie: (value: string | null) => void;
}

/** The reason phrase the backend's filter derives from a status. */
function reasonPhrase(status: number): string {
  return REASON_PHRASE[status] ?? 'Error';
}

/** Refuses the request the way the backend's global exception filter would. */
function refuse(status: number, message: string, code?: ApiErrorCode): never {
  const body: ApiErrorBody = {
    error: reasonPhrase(status),
    message,
    ...(code === undefined ? {} : { code }),
  };
  throw new ApiError(status, body);
}

/** The refusal every failed attempt gets, whatever the real reason was. */
function refuseCredentials(): never {
  // One answer for every reason there is — no account, wrong secret, unverified,
  // suspended, deleted. The backend has the reason in scope and deliberately does
  // not read it; a stub that leaked it here would let a service be written that
  // depends on something the real wire never says.
  //
  // **And no `code`**, which is a correction rather than an omission. The
  // backend's sign-in refusal is an `UnauthorizedException` carrying a
  // `messageKey`, and the filter's `HttpException` branch never sets `code` — so
  // a real sign-in refusal is indistinguishable from the guard's. This stub used
  // to emit `INVALID_CREDENTIALS` here, which is what `POST /auth/change-password`
  // really answers (there the refusal is core's `InvalidCredentialsError`, a
  // `DomainError`, which the filter does code) and what sign-in does not. Nothing
  // read it, so nothing caught it; it is corrected because the webapp now decides
  // whether to renew from what a `401` carries, and a decision made on a value
  // only the stub emits is a decision made on nothing.
  refuse(401, 'errors.auth.invalid_credentials');
}

/** Refuses a secret the deployment's policy will not accept, as the backend does. */
function assertAcceptableSecret(secret: string): void {
  const violations = evaluatePassword(secret, DEFAULT_PASSWORD_POLICY);
  if (violations.length === 0) return;
  throw new ApiError(422, {
    error: reasonPhrase(422),
    message: 'errors.auth.weak_password',
    code: 'WEAK_PASSWORD',
    // Every way it fell short, because that is what the backend sends and what
    // `WeakPasswordError` is built from on the other side.
    violations: violations.map((code) => ({ code, message: `errors.auth.password.${code}` })),
  });
}

/**
 * Builds a fresh world with nothing in it, and the transport that serves it.
 *
 * @returns the stub, whose `client` is the transport to build services on
 */
export function stubBackend(): StubBackend {
  const users = new Map<UserId, StoredUser>();
  const sessions = new Map<SessionId, SessionJSON>();
  const identities = new Map<AuthIdentityId, AuthIdentityJSON>();
  const verifications = new Map<string, StoredCredential>();
  const resets = new Map<string, StoredCredential>();
  const organizations = new Map<OrganizationId, OrganizationJSON>();
  const memberships = new Map<MembershipId, MembershipJSON>();
  const invitations = new Map<InvitationId, InvitationJSON>();
  /** The token minted for each invitation, and the reverse lookup a redemption needs. */
  const invitationTokens = new Map<InvitationId, string>();
  const tokenToInvitation = new Map<string, InvitationId>();
  const grants = new Map<GrantId, ResourceGrantJSON>();
  /** Which session an access credential stands for. */
  const credentials = new Map<string, SessionId>();
  /**
   * The renewal credentials this world has issued, and whether each is spent.
   *
   * Modelled rather than skipped because the interesting behaviour of a renewal
   * is not that it works — it is what happens when a spent one is presented, and
   * that is the failure DEC-3 actually produces in the field. A stub that always
   * said yes would let a webapp be written that renews three times per page load
   * and never notice.
   */
  const renewals = new Map<string, { sessionId: SessionId; spentAt: Date | null }>();
  /**
   * The renewal cookie the one browser this world serves is currently holding.
   *
   * A single value, because a stub serves one client. It is **read when a
   * request is issued and not when it is handled** (see `client`), which is the
   * whole of what makes a race reproducible here: three renewals started in the
   * same tick all present the credential that was current when they started.
   */
  let cookie: string | null = null;
  /** How many renewals have been asked for. The number a concurrency test counts. */
  let refreshes = 0;

  let sequence = 0;
  /** The next id of a kind, in this store's own format. */
  const nextId = (kind: string): string => {
    sequence += 1;
    return `stub-${kind}-${String(sequence)}`;
  };

  /**
   * An id of a kind that nothing already answers to.
   *
   * The loop is not defensive programming. A driver seeds the world through
   * `put*` with ids in this same format, and a counter that started at zero
   * regardless minted `stub-Session-1` for the first sign-in — **overwriting the
   * session the world had promised**. The suite reported "the world's session and
   * the fresh one, and nothing else: expected 1 to be 2", which reads as the
   * service losing a session and was this store silently reusing a key.
   *
   * @param kind - the sort of thing being identified
   * @param taken - whether this store already holds that id
   * @returns an id nothing answers to
   */
  const mint = (kind: string, taken: (id: string) => boolean): string => {
    let id = nextId(kind);
    while (taken(id)) id = nextId(kind);
    return id;
  };

  const userByEmail = (email: string): StoredUser | undefined => {
    const normalized = normalizeEmail(email);
    return [...users.values()].find((one) => one.json.email === normalized);
  };

  /** Every membership of one organization, in no particular order. */
  const membershipsOf = (organizationId: OrganizationId): MembershipJSON[] =>
    [...memberships.values()].filter((one) => one.organizationId === organizationId);

  /**
   * The organization an actor may see, or the shared `404` that stands for
   * "does not exist" and "not yours" alike.
   *
   * This is the effect of `OrganizationsService.requireMember` and
   * `PermissionsGuard` together, collapsed into the one check every
   * organization-scoped route in this stub needs: a soft-deleted
   * organization and one the actor does not belong to are both refused with
   * `ORGANIZATION_NOT_FOUND`, indistinguishably, exactly as the shared
   * conformance suite's own "refuses an organization the actor does not
   * belong to, indistinguishably" assertion requires.
   *
   * @param userId - whoever is asking
   * @param organizationId - the organization named
   * @returns the organization, once it is established the caller may see it
   */
  const requireOrganizationMembership = (
    userId: UserId,
    organizationId: OrganizationId,
  ): OrganizationJSON => {
    const organization = organizations.get(organizationId);
    if (organization === undefined || organization.deletedAt !== null) {
      refuse(404, 'errors.http.not_found', 'ORGANIZATION_NOT_FOUND');
    }
    const belongs = membershipsOf(organizationId).some((one) => one.userId === userId);
    if (!belongs) refuse(404, 'errors.http.not_found', 'ORGANIZATION_NOT_FOUND');
    return organization;
  };

  /** One page of `all`, from the request's own `page`/`limit` query. */
  const paginate = <T>(all: readonly T[], request: ApiRequest): {
    data: T[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  } => {
    const page = Number(request.query?.page ?? 1);
    const limit = Number(request.query?.limit ?? 20);
    return {
      data: all.slice((page - 1) * limit, page * limit),
      meta: { total: all.length, page, limit, totalPages: Math.ceil(all.length / limit) },
    };
  };

  /**
   * Turns one of `Organization`'s own invariant errors into the `ApiError`
   * the real backend would answer with, and rethrows anything else
   * unchanged — a programming mistake in this file must not be reported as
   * a domain refusal.
   */
  const asOrganizationDomainRefusal = (error: unknown): never => {
    if (error instanceof OrganizationNameRequiredError) {
      refuse(422, 'errors.http.unprocessable', 'ORGANIZATION_NAME_REQUIRED');
    }
    if (error instanceof InvalidOrganizationSlugError) {
      refuse(422, 'errors.http.unprocessable', 'INVALID_ORGANIZATION_SLUG');
    }
    throw error;
  };

  /**
   * Refuses a change that would leave `organizationId` with no OWNER.
   *
   * A no-op on a membership that does not hold OWNER: only a change AWAY
   * from the role can possibly leave the organization ownerless.
   */
  const assertNotLastOwner = (organizationId: OrganizationId, current: MembershipJSON): void => {
    if (current.role !== OrgRole.OWNER) return;
    const owners = membershipsOf(organizationId).filter((one) => one.role === OrgRole.OWNER);
    if (owners.length <= 1) refuse(409, 'errors.http.conflict', 'LAST_OWNER');
  };

  /** How long a stub-issued invitation lasts before it lapses on its own. A week. */
  const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

  /** One `/organizations/:id/members` request. */
  const memberRoutes = (
    request: ApiRequest,
    organizationId: OrganizationId,
    targetUserIdRaw: string | undefined,
  ): unknown => {
    const actor = actorOf(request);
    requireOrganizationMembership(actor.userId, organizationId);

    if (targetUserIdRaw === undefined) {
      if (request.method === 'GET') {
        const role = request.query?.role as OrgRole | undefined;
        const all = membershipsOf(organizationId)
          .filter((one) => role === undefined || one.role === role);
        return paginate(all, request);
      }
      refuse(405, 'errors.http.bad_request');
    }

    const targetUserId = targetUserIdRaw as UserId;
    const target = membershipsOf(organizationId).find((one) => one.userId === targetUserId);
    if (target === undefined) refuse(404, 'errors.http.not_found', 'MEMBERSHIP_NOT_FOUND');

    if (request.method === 'PATCH') {
      const role = body<{ role: OrgRole }>(request).role;
      // Only a change AWAY from OWNER can possibly leave the organization
      // ownerless — re-affirming the sole owner as OWNER is not a demotion,
      // and asking the invariant about the wrong direction would refuse a
      // no-op change that never threatened it.
      if (role !== OrgRole.OWNER) assertNotLastOwner(organizationId, target);
      const updated = Membership.fromJSON({ ...target, role, updatedAt: new Date().toISOString() });
      memberships.set(updated.id, updated.toJSON());
      return updated.toJSON();
    }

    if (request.method === 'DELETE') {
      assertNotLastOwner(organizationId, target);
      memberships.delete(target.id);
      return undefined;
    }

    refuse(405, 'errors.http.bad_request');
  };

  /** One `/organizations/:id/invitations` request. */
  const organizationInvitationRoutes = (
    request: ApiRequest,
    organizationId: OrganizationId,
    invitationIdRaw: string | undefined,
  ): unknown => {
    const actor = actorOf(request);
    requireOrganizationMembership(actor.userId, organizationId);

    if (invitationIdRaw === undefined) {
      if (request.method === 'POST') {
        const input = body<{ email: string; role: OrgRole }>(request);
        const existing = userByEmail(input.email);
        if (
          existing !== undefined
          && membershipsOf(organizationId).some((one) => one.userId === existing.json.id)
        ) {
          refuse(409, 'errors.http.conflict', 'ALREADY_A_MEMBER');
        }
        const now = new Date();
        const invitation = new Invitation({
          id: mint('Invitation', (id) => invitations.has(id as InvitationId)) as InvitationId,
          organizationId,
          email: input.email,
          role: input.role,
          status: InvitationStatus.PENDING,
          invitedByUserId: actor.userId,
          expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
          createdAt: now,
          acceptedAt: null,
          acceptedByUserId: null,
        });
        invitations.set(invitation.id, invitation.toJSON());
        const token = nextId('invitation-token');
        invitationTokens.set(invitation.id, token);
        tokenToInvitation.set(token, invitation.id);
        return invitation.toJSON();
      }
      if (request.method === 'GET') {
        const status = request.query?.status as InvitationStatus | undefined;
        const all = [...invitations.values()].filter(
          (one) => one.organizationId === organizationId
            && (status === undefined || one.status === status),
        );
        return paginate(all, request);
      }
      refuse(405, 'errors.http.bad_request');
    }

    const invitationId = invitationIdRaw as InvitationId;
    const stored = invitations.get(invitationId);
    if (stored === undefined || stored.organizationId !== organizationId) {
      refuse(404, 'errors.http.not_found', 'INVITATION_NOT_FOUND');
    }

    if (request.method === 'DELETE') {
      const current = Invitation.fromJSON(stored);
      if (!current.isOpenAt(new Date())) {
        refuse(410, 'errors.http.gone', 'INVITATION_NO_LONGER_OPEN');
      }
      const revoked = new Invitation({ ...current, status: InvitationStatus.REVOKED });
      invitations.set(revoked.id, revoked.toJSON());
      return revoked.toJSON();
    }

    refuse(405, 'errors.http.bad_request');
  };

  /**
   * `POST /invitations/:token/accept`.
   *
   * Not organization-scoped, and not behind `requireOrganizationMembership`:
   * the caller is by definition not yet a member of the organization the
   * invitation names, and the token — not the credential's own standing — is
   * what authorizes this one request. Openness is judged before the address
   * match, exactly as `IOrganizationService.acceptInvitation`'s own TSDoc
   * requires, so a second presentation of a spent token is answered the same
   * way whoever presents it.
   */
  const acceptInvitationRoute = (request: ApiRequest, token: string): unknown => {
    const actor = actorOf(request);
    const invitationId = tokenToInvitation.get(token);
    const stored = invitationId === undefined ? undefined : invitations.get(invitationId);
    if (stored === undefined) refuse(404, 'errors.http.not_found', 'INVITATION_NOT_FOUND');

    const invitation = Invitation.fromJSON(stored);
    const now = new Date();
    if (!invitation.isOpenAt(now)) refuse(410, 'errors.http.gone', 'INVITATION_NO_LONGER_OPEN');

    const actorStored = users.get(actor.userId);
    if (actorStored === undefined || actorStored.json.email !== invitation.email) {
      refuse(403, 'errors.http.forbidden', 'INVITATION_ADDRESS_MISMATCH');
    }

    const membership = new Membership({
      id: mint('Membership', (id) => memberships.has(id as MembershipId)) as MembershipId,
      organizationId: invitation.organizationId,
      userId: actor.userId,
      role: invitation.role,
      createdAt: now,
      updatedAt: now,
    });
    memberships.set(membership.id, membership.toJSON());

    const accepted = new Invitation({
      ...invitation,
      status: InvitationStatus.ACCEPTED,
      acceptedAt: now,
      acceptedByUserId: actor.userId,
    });
    invitations.set(accepted.id, accepted.toJSON());

    return membership.toJSON();
  };

  /**
   * One `/organizations/:id/grants` request.
   *
   * No membership check on `actor`, and that is not an oversight: the real
   * `AuthorizationService.listGrants`'s own TSDoc says who may administer
   * grants is `PermissionsGuard`'s question, decided before that service is
   * ever called, and this store draws no finer line than that. The shared
   * `IAuthorizationService` suite never exercises an actor without standing
   * in the organization either — see its own contract deps — so modelling
   * that guard here would assert nothing this suite can fail.
   */
  const grantRoutes = (
    request: ApiRequest,
    organizationId: OrganizationId,
    grantIdRaw: string | undefined,
  ): unknown => {
    const actor = actorOf(request);

    if (grantIdRaw === undefined) {
      if (request.method === 'GET') {
        const all = [...grants.values()].filter((one) => one.organizationId === organizationId);
        return paginate(all, request);
      }
      if (request.method === 'POST') {
        const input = body<{
          subjectUserId: UserId;
          resourceType: ResourceGrantJSON['resourceType'];
          resourceId: string;
          permission: ResourceGrantJSON['permission'];
          expiresAt?: string | null;
        }>(request);
        const subjectIsMember = membershipsOf(organizationId).some(
          (one) => one.userId === input.subjectUserId,
        );
        if (!subjectIsMember) refuse(409, 'errors.http.conflict', 'CROSS_TENANT_GRANT');
        const now = new Date();
        const grant: ResourceGrantJSON = {
          id: mint('Grant', (id) => grants.has(id as GrantId)) as GrantId,
          subjectUserId: input.subjectUserId,
          organizationId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          permission: input.permission,
          grantedBy: actor.userId,
          createdAt: now.toISOString(),
          expiresAt: input.expiresAt ?? null,
        };
        grants.set(grant.id, grant);
        return grant;
      }
      refuse(405, 'errors.http.bad_request');
    }

    const grantId = grantIdRaw as GrantId;
    if (request.method === 'DELETE') {
      const stored = grants.get(grantId);
      if (stored === undefined || stored.organizationId !== organizationId) {
        refuse(404, 'errors.http.not_found', 'GRANT_NOT_FOUND');
      }
      grants.delete(grantId);
      return undefined;
    }

    refuse(405, 'errors.http.bad_request');
  };

  /** One `/organizations` request. */
  const organizationRoutes = (request: ApiRequest, tail: string): unknown => {
    const { method } = request;

    if (tail === '') {
      if (method === 'POST') {
        const actor = actorOf(request);
        const input = body<{ name: string; slug: string }>(request);
        const now = new Date();
        let organization: Organization;
        try {
          organization = new Organization({
            id: mint('Organization', (id) => organizations.has(id as OrganizationId)) as OrganizationId,
            name: input.name,
            slug: input.slug,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
        } catch (error) {
          throw asOrganizationDomainRefusal(error);
        }
        organizations.set(organization.id, organization.toJSON());
        const membership = new Membership({
          id: mint('Membership', (id) => memberships.has(id as MembershipId)) as MembershipId,
          organizationId: organization.id,
          userId: actor.userId,
          role: OrgRole.OWNER,
          createdAt: now,
          updatedAt: now,
        });
        memberships.set(membership.id, membership.toJSON());
        return organization.toJSON();
      }
      if (method === 'GET') {
        const actor = actorOf(request);
        const mine = [...organizations.values()].filter(
          (one) => one.deletedAt === null
            && membershipsOf(one.id).some((membership) => membership.userId === actor.userId),
        );
        return paginate(mine, request);
      }
      refuse(405, 'errors.http.bad_request');
    }

    const membersMatch = /^\/([^/]+)\/members(?:\/([^/]+))?$/.exec(tail);
    if (membersMatch !== null) {
      return memberRoutes(request, membersMatch[1] as OrganizationId, membersMatch[2]);
    }

    const invitationsMatch = /^\/([^/]+)\/invitations(?:\/([^/]+))?$/.exec(tail);
    if (invitationsMatch !== null) {
      return organizationInvitationRoutes(
        request,
        invitationsMatch[1] as OrganizationId,
        invitationsMatch[2],
      );
    }

    const grantsMatch = /^\/([^/]+)\/grants(?:\/([^/]+))?$/.exec(tail);
    if (grantsMatch !== null) {
      return grantRoutes(request, grantsMatch[1] as OrganizationId, grantsMatch[2]);
    }

    const idMatch = /^\/([^/]+)$/.exec(tail);
    if (idMatch !== null) {
      const organizationId = idMatch[1] as OrganizationId;
      const actor = actorOf(request);

      if (method === 'GET') return requireOrganizationMembership(actor.userId, organizationId);

      if (method === 'PATCH') {
        const organization = requireOrganizationMembership(actor.userId, organizationId);
        const changes = body<{ name?: string; slug?: string }>(request);
        const current = Organization.fromJSON(organization);
        try {
          const updated = new Organization({
            ...current,
            ...(changes.name === undefined ? {} : { name: changes.name }),
            ...(changes.slug === undefined ? {} : { slug: changes.slug }),
            updatedAt: new Date(),
          });
          organizations.set(updated.id, updated.toJSON());
          return updated.toJSON();
        } catch (error) {
          throw asOrganizationDomainRefusal(error);
        }
      }

      if (method === 'DELETE') {
        const organization = requireOrganizationMembership(actor.userId, organizationId);
        const now = new Date();
        const current = Organization.fromJSON(organization);
        organizations.set(
          current.id,
          new Organization({ ...current, deletedAt: now, updatedAt: now }).toJSON(),
        );
        return undefined;
      }
    }

    refuse(405, 'errors.http.bad_request');
  };

  /** Whether the account may be used at all, decided by core and not restated. */
  const usable = (stored: StoredUser): boolean => User.fromJSON(stored.json).canAuthenticate();

  const activeSessionsOf = (userId: UserId): SessionJSON[] => {
    const now = new Date();
    return [...sessions.values()]
      .filter((one) => one.userId === userId && Session.fromJSON(one).isActive(now))
      // Newest first, and by id when two share an instant — the order the
      // backend's own session list promises.
      .sort((a, b) => (a.createdAt === b.createdAt
        ? String(b.id).localeCompare(String(a.id))
        : b.createdAt.localeCompare(a.createdAt)));
  };

  /** Opens a session and issues the credential that stands for it. */
  const beginSession = (userId: UserId, client: ClientContext): {
    session: SessionJSON;
    credential: string;
  } => {
    const now = new Date();
    const session: SessionJSON = {
      id: mint('Session', (id) => sessions.has(id as SessionId)) as SessionId,
      userId,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
      revokedAt: null,
      clientAddress: client.address,
      clientLabel: client.label,
    };
    sessions.set(session.id, session);
    const credential = nextId('credential');
    credentials.set(credential, session.id);
    // The renewal credential, which in the real thing is an `httpOnly` cookie the
    // browser stores and script cannot read. Here the "browser" is `cookie`.
    const renewal = nextId('renewal');
    renewals.set(renewal, { sessionId: session.id, spentAt: null });
    cookie = renewal;
    return { session, credential };
  };

  /**
   * Ends one session, and spends every renewal credential still live inside it.
   *
   * **One session, which is the backend's scope and was not always this file's.**
   * `RefreshTokenService.rotate` answers reuse with
   * `SessionService.endSession(manager, row.sessionId, now)` — that session's row
   * revoked, and that session's unspent renewal credentials marked used — and
   * `apps/backend/src/auth/__tests__/refresh-rotation.spec.ts` (D8) pins exactly
   * that. This stub used to end **every session the user held**, which is a
   * different and stronger security property: it said that a reused credential
   * signs you out of every device. Nothing read the difference, so nothing caught
   * it, which is how the `INVALID_CREDENTIALS` divergence survived too.
   * `stubBackend.refresh.spec.ts` is the cross-check that now has to be changed
   * before this can drift again.
   */
  const endSession = (sessionId: SessionId): void => {
    const now = new Date();
    const session = sessions.get(sessionId);
    if (session !== undefined && session.revokedAt === null) {
      sessions.set(sessionId, { ...session, revokedAt: now.toISOString() });
    }
    // Only the ones not already spent, as the backend's sweep is: overwriting
    // `spentAt` on a credential legitimately exchanged earlier would rewrite when
    // that happened, and the chain of instants is what an incident is read from.
    for (const [value, held] of renewals) {
      if (held.sessionId === sessionId && held.spentAt === null) {
        renewals.set(value, { ...held, spentAt: now });
      }
    }
  };

  /** Ends every session the user holds, as recovery and a password change do. */
  const revokeAllOf = (userId: UserId): void => {
    for (const [id, session] of sessions) {
      if (session.userId === userId && session.revokedAt === null) endSession(id);
    }
  };

  /** Spends a single-use credential, answering the way the backend's filter does. */
  const spend = (store: Map<string, StoredCredential>, value: string): UserId => {
    const held = store.get(value);
    // A credential nobody ever issued is reported as expired, **not** as
    // unknown, and that is the backend's rule rather than a shortcut: an answer
    // that distinguished them would tell a guesser which of their guesses had
    // once been real.
    if (held === undefined) refuse(410, 'errors.auth.token_expired', 'TOKEN_EXPIRED');
    if (held.consumedAt !== null) refuse(410, 'errors.auth.token_consumed', 'TOKEN_CONSUMED');
    if (held.expiresAt.getTime() <= Date.now()) {
      refuse(410, 'errors.auth.token_expired', 'TOKEN_EXPIRED');
    }
    store.set(value, { ...held, consumedAt: new Date() });
    return held.userId;
  };

  /**
   * Who the request is being made by, and through which session.
   *
   * A credential is preferred because that is the only thing a real request
   * carries. `actor` is the test transport's own affordance: the conformance
   * suites drive one service instance as several people, which no browser does
   * and no credential can express. See `ApiRequest.actor`.
   */
  const actorOf = (request: ApiRequest): { userId: UserId; sessionId: SessionId | null } => {
    if (request.credential !== undefined) {
      const sessionId = credentials.get(request.credential);
      const session = sessionId === undefined ? undefined : sessions.get(sessionId);
      if (session === undefined) refuse(401, 'errors.http.unauthorized');
      return { userId: session.userId, sessionId: session.id };
    }
    if (request.actor !== undefined) return { userId: request.actor, sessionId: null };
    refuse(401, 'errors.http.unauthorized');
  };

  /** Whether the actor operates the deployment, which is what the admin guard asks. */
  const isAdmin = (userId: UserId): boolean =>
    users.get(userId)?.json.platformRole === PlatformRole.PLATFORM_ADMIN;

  /**
   * The user a platform-administration route was asked about.
   *
   * Everything a non-administrator asks for here is `404` — not `403` — and with
   * the same body a missing user gets, because the guard is written so that "you
   * may not" and "there is no such thing" are indistinguishable.
   */
  const adminTarget = (actorId: UserId, targetId: UserId): StoredUser => {
    if (!isAdmin(actorId)) refuse(404, 'errors.http.not_found');
    const stored = users.get(targetId);
    if (stored === undefined) refuse(404, 'errors.http.not_found', 'USER_NOT_FOUND');
    return stored;
  };

  /** Replaces a user, keeping the wire shape the backend would emit. */
  const save = (user: User, secret: string): UserJSON => {
    const json = user.toJSON();
    users.set(json.id, { json, secret });
    return json;
  };

  const body = <T>(request: ApiRequest): T => request.body as T;

  /**
   * One `/auth` request.
   *
   * @param presented - the renewal cookie the request carried, captured when it
   * was issued rather than read here, so that concurrent renewals present what
   * they really would have presented
   */
  const auth = (request: ApiRequest, tail: string, presented: string | null): unknown => {
    const { method } = request;

    if (method === 'POST' && tail === '/register') {
      const input = body<{ email: string; displayName: string; secret: string }>(request);
      // The policy judgement is made first and out loud, before the address is
      // looked at: how long a secret has to be is a published rule, so refusing
      // one that breaks it reveals nothing about any address.
      assertAcceptableSecret(input.secret);
      if (userByEmail(input.email) === undefined) {
        const now = new Date();
        const user = new User({
          id: mint('User', (id) => users.has(id as UserId)) as UserId,
          email: input.email,
          displayName: input.displayName,
          status: UserStatus.ACTIVE,
          platformRole: PlatformRole.PLATFORM_USER,
          emailVerifiedAt: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        save(user, input.secret);
        const identity = new AuthIdentity({
          id: mint(
            'AuthIdentity',
            (id) => identities.has(id as AuthIdentityId),
          ) as AuthIdentityId,
          userId: user.id,
          provider: AuthProvider.PASSWORD,
          providerAccountId: input.email,
          createdAt: now,
          lastUsedAt: null,
        });
        identities.set(identity.id, identity.toJSON());
        verifications.set(nextId('verification'), {
          userId: user.id,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          consumedAt: null,
        });
      }
      // **No branch reaches the response.** Whether an account was created or
      // one already existed is the difference this endpoint exists not to tell.
      return { status: 'accepted' };
    }

    if (method === 'POST' && tail === '/verify-email') {
      const userId = spend(verifications, body<{ credential: string }>(request).credential);
      const stored = users.get(userId);
      if (stored !== undefined) {
        const user = User.fromJSON(stored.json);
        const now = new Date();
        save(new User({ ...user, emailVerifiedAt: now, updatedAt: now }), stored.secret);
      }
      return { status: 'verified' };
    }

    if (method === 'POST' && tail === '/resend-verification') {
      const stored = userByEmail(body<{ email: string }>(request).email);
      if (stored !== undefined && stored.json.emailVerifiedAt === null) {
        verifications.set(nextId('verification'), {
          userId: stored.json.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          consumedAt: null,
        });
      }
      return { status: 'accepted' };
    }

    if (method === 'POST' && tail === '/login') {
      const attempt = body<{ email: string; secret: string }>(request);
      const stored = userByEmail(attempt.email);
      if (stored === undefined || stored.secret !== attempt.secret || !usable(stored)) {
        refuseCredentials();
      }
      const opened = beginSession(stored.json.id, NO_CLIENT);
      return {
        user: stored.json,
        accessToken: opened.credential,
        expiresIn: STUB_ACCESS_LIFETIME_SECONDS,
      };
    }

    if (method === 'POST' && tail === '/refresh') {
      refreshes += 1;
      // A request that did not ask for the cookie to travel is indistinguishable
      // from a browser holding none — which is the point. `postRefresh` sets
      // `withCookie`, and a version that stopped setting it fails here rather
      // than in production, months later, the first time a credential lapses.
      if (presented === null) refuse(401, 'errors.http.unauthorized');
      const held = renewals.get(presented);
      // Unknown, spent, expired and belonging-to-an-ended-session are one answer
      // on the other side — `SessionNotFoundError`, which the controller turns
      // into a bare `401` — because telling them apart says which credentials
      // were ever real.
      if (held === undefined) {
        cookie = null;
        refuse(401, 'errors.auth.session_not_found');
      }
      if (held.spentAt !== null) {
        // **Reuse detection.** A renewal credential is single-use. A second
        // presentation means either that the holder raced itself or that somebody
        // else has a copy, and nothing on this side can tell those apart — so the
        // safe reading is the second one and the session ends. That session: see
        // `endSession`. This is what turns "the webapp renewed three times at
        // once" into "the user was signed out for no reason they can see".
        endSession(held.sessionId);
        // Cleared, as the backend's controller clears it on every failure below
        // this point: leaving a credential the server has just refused in the
        // browser means every later renewal presents it again.
        cookie = null;
        refuse(401, 'errors.auth.session_not_found');
      }
      const session = sessions.get(held.sessionId);
      if (session === undefined || !Session.fromJSON(session).isActive(new Date())) {
        cookie = null;
        refuse(401, 'errors.auth.session_not_found');
      }
      const stored = users.get(session.userId);
      if (stored === undefined) {
        cookie = null;
        refuse(401, 'errors.auth.session_not_found');
      }
      // Rotation: the presented credential is spent and a fresh one takes its
      // place, which is the reason a second presentation is detectable at all.
      renewals.set(presented, { ...held, spentAt: new Date() });
      const rotated = nextId('renewal');
      renewals.set(rotated, { sessionId: session.id, spentAt: null });
      cookie = rotated;
      const access = nextId('credential');
      credentials.set(access, session.id);
      sessions.set(session.id, { ...session, lastUsedAt: new Date().toISOString() });
      return { user: stored.json, accessToken: access, expiresIn: STUB_ACCESS_LIFETIME_SECONDS };
    }

    if (method === 'POST' && tail === '/forgot-password') {
      const stored = userByEmail(body<{ email: string }>(request).email);
      if (stored !== undefined) {
        resets.set(nextId('reset'), {
          userId: stored.json.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          consumedAt: null,
        });
      }
      return { status: 'accepted' };
    }

    if (method === 'POST' && tail === '/reset-password') {
      const input = body<{ credential: string; secret: string }>(request);
      assertAcceptableSecret(input.secret);
      const userId = spend(resets, input.credential);
      const stored = users.get(userId);
      if (stored !== undefined) {
        users.set(userId, { ...stored, secret: input.secret });
        revokeAllOf(userId);
      }
      return { status: 'reset' };
    }

    if (method === 'POST' && tail === '/change-password') {
      const { userId } = actorOf(request);
      const input = body<{ currentSecret: string; newSecret: string }>(request);
      const stored = users.get(userId);
      if (stored === undefined || stored.secret !== input.currentSecret) {
        refuse(401, 'errors.auth.invalid_credentials', 'INVALID_CREDENTIALS');
      }
      assertAcceptableSecret(input.newSecret);
      users.set(userId, { ...stored, secret: input.newSecret });
      // Every session ends, the caller's included — and then one is opened for
      // the caller this request is serving, which is what the transport can do
      // and the domain cannot.
      revokeAllOf(userId);
      const opened = beginSession(userId, NO_CLIENT);
      return {
        user: stored.json,
        accessToken: opened.credential,
        expiresIn: STUB_ACCESS_LIFETIME_SECONDS,
      };
    }

    if (method === 'POST' && tail === '/logout') {
      const { sessionId } = actorOf(request);
      if (sessionId !== null) {
        const session = sessions.get(sessionId);
        if (session !== undefined) {
          sessions.set(sessionId, { ...session, revokedAt: new Date().toISOString() });
        }
      }
      return undefined;
    }

    if (method === 'GET' && tail === '/sessions') {
      const actor = actorOf(request);
      const listed: SessionResponseBody[] = activeSessionsOf(actor.userId)
        .map((session) => ({ ...session, isCurrent: session.id === actor.sessionId }));
      return listed;
    }

    const revoking = /^\/sessions\/(.+)$/.exec(tail);
    if (method === 'DELETE' && revoking !== null) {
      const actor = actorOf(request);
      const target = sessions.get(revoking[1] as SessionId);
      // Another person's session and one that does not exist are the same answer.
      // Anything else is a way to discover which ids are real by trying them.
      if (target === undefined || target.userId !== actor.userId) {
        refuse(404, 'errors.auth.session_not_found', 'SESSION_NOT_FOUND');
      }
      sessions.set(target.id, { ...target, revokedAt: new Date().toISOString() });
      return undefined;
    }

    refuse(405, 'errors.http.bad_request');
  };

  /** One `/users/me/identities` request. */
  const identityRoutes = (request: ApiRequest, tail: string): unknown => {
    const actor = actorOf(request);
    const held = [...identities.values()]
      .filter((one) => one.userId === actor.userId)
      .map((one) => AuthIdentity.fromJSON(one));

    if (request.method === 'GET' && tail === '') return held.map((one) => one.toJSON());

    const unlinking = /^\/(.+)$/.exec(tail);
    if (request.method === 'DELETE' && unlinking !== null) {
      const identityId = unlinking[1] as AuthIdentityId;
      try {
        // Core's own policy, called rather than restated — the same one the
        // backend calls. A count query here would be a second copy of a rule,
        // and a stub whose rule had drifted from the domain's would report the
        // webapp's mapping as wrong when it was the stub that was.
        assertAtLeastOneIdentityRemains(held, identityId);
      } catch (error) {
        if (error instanceof IdentityNotFoundError) {
          refuse(404, 'errors.http.not_found', 'IDENTITY_NOT_FOUND');
        }
        if (error instanceof LastIdentityRemovalError) {
          refuse(409, 'errors.http.conflict', 'LAST_IDENTITY_REMOVAL');
        }
        throw error;
      }
      identities.delete(identityId);
      return undefined;
    }

    refuse(405, 'errors.http.bad_request');
  };

  /** One `/users` request. */
  const userRoutes = (request: ApiRequest, tail: string): unknown => {
    if (tail.startsWith('/me/identities')) {
      return identityRoutes(request, tail.slice('/me/identities'.length));
    }

    const actor = actorOf(request);
    const { method } = request;

    if (method === 'GET' && tail === '/me') {
      const stored = users.get(actor.userId);
      if (stored === undefined) refuse(404, 'errors.http.not_found', 'USER_NOT_FOUND');
      return stored.json;
    }

    // Mirrors `PrincipalService.hydrate`: every membership of this actor across
    // every organization, and every grant of theirs still live as of now — the
    // same `isGrantLive` rule, not a restatement of it. `useCan`'s own delegation
    // test needs a principal this route can hand it, and there is nowhere else
    // in this stub a webapp test could seed one from.
    if (method === 'GET' && tail === '/me/principal') {
      const stored = users.get(actor.userId);
      if (stored === undefined) refuse(404, 'errors.http.not_found', 'USER_NOT_FOUND');
      const now = new Date();
      const own = [...memberships.values()].filter((one) => one.userId === actor.userId);
      const ownGrants = [...grants.values()]
        .filter((one) => one.subjectUserId === actor.userId)
        .filter((one) => isGrantLive({
          ...one,
          createdAt: new Date(one.createdAt),
          expiresAt: one.expiresAt === null ? null : new Date(one.expiresAt),
        }, now));
      const principal: PrincipalResponseBody = {
        userId: stored.json.id,
        platformRole: stored.json.platformRole,
        memberships: own.map((one) => ({ organizationId: one.organizationId, role: one.role })),
        grants: ownGrants,
      };
      return principal;
    }

    if (method === 'PATCH' && tail === '/me') {
      const stored = users.get(actor.userId);
      if (stored === undefined) refuse(404, 'errors.http.not_found', 'USER_NOT_FOUND');
      const changes = body<{ displayName?: string }>(request);
      const current = User.fromJSON(stored.json);
      try {
        return save(
          new User({
            ...current,
            ...(changes.displayName === undefined ? {} : { displayName: changes.displayName }),
            updatedAt: new Date(),
          }),
          stored.secret,
        );
      } catch (error) {
        // The one domain refusal `PATCH /users/me` can raise, and caught by its
        // own type rather than by a bare `catch` — a bare one would report a
        // programming mistake in this file as a blank display name, and the
        // webapp would then map an internal fault to a perfectly plausible
        // domain error. It carries a code rather than leaving the caller to
        // infer it from "a 422 on this path".
        if (error instanceof DisplayNameRequiredError) {
          refuse(422, 'errors.http.unprocessable', 'DISPLAY_NAME_REQUIRED');
        }
        throw error;
      }
    }

    if (method === 'DELETE' && tail === '/me') {
      const stored = users.get(actor.userId);
      if (stored === undefined) refuse(404, 'errors.http.not_found', 'USER_NOT_FOUND');
      const now = new Date();
      // Soft, so that history referencing the account stays readable.
      save(
        new User({ ...User.fromJSON(stored.json), deletedAt: now, updatedAt: now }),
        stored.secret,
      );
      revokeAllOf(actor.userId);
      return undefined;
    }

    if (method === 'GET' && tail === '') {
      if (!isAdmin(actor.userId)) refuse(404, 'errors.http.not_found');
      const page = Number(request.query?.page ?? 1);
      const limit = Number(request.query?.limit ?? 20);
      const all = [...users.values()].map((one) => one.json);
      return {
        data: all.slice((page - 1) * limit, page * limit),
        meta: { total: all.length, page, limit, totalPages: Math.ceil(all.length / limit) },
      };
    }

    const status = /^\/([^/]+)\/status$/.exec(tail);
    if (method === 'PATCH' && status !== null) {
      const target = adminTarget(actor.userId, status[1] as UserId);
      return save(
        new User({
          ...User.fromJSON(target.json),
          status: body<{ status: UserStatus }>(request).status,
          updatedAt: new Date(),
        }),
        target.secret,
      );
    }

    const role = /^\/([^/]+)\/platform-role$/.exec(tail);
    if (method === 'PATCH' && role !== null) {
      const target = adminTarget(actor.userId, role[1] as UserId);
      return save(
        new User({
          ...User.fromJSON(target.json),
          platformRole: body<{ platformRole: PlatformRole }>(request).platformRole,
          updatedAt: new Date(),
        }),
        target.secret,
      );
    }

    const byId = /^\/([^/]+)$/.exec(tail);
    if (method === 'GET' && byId !== null) {
      return adminTarget(actor.userId, byId[1] as UserId).json;
    }

    refuse(405, 'errors.http.bad_request');
  };

  // `async` with nothing awaited, on purpose: the real transport is async and a
  // service that happened to work only against a synchronous one would be a
  // service nothing had tested. Every refusal below therefore arrives as a
  // rejected promise, exactly as `createApiClient`'s does.
  const client: ApiClient = async <T>(request: ApiRequest): Promise<T> => {
    // Captured BEFORE the await, because that is when a real transport reads it:
    // `createApiClient` builds its headers synchronously and hands them to
    // `fetch`. Reading it after the await would let three renewals started in the
    // same tick each see the credential the one before it had just rotated to,
    // and the race this world exists to expose would quietly disappear.
    const presented = request.withCookie === true ? cookie : null;
    await Promise.resolve();
    if (request.path.startsWith('/auth')) {
      return auth(request, request.path.slice('/auth'.length), presented) as T;
    }
    if (request.path.startsWith('/users')) {
      return userRoutes(request, request.path.slice('/users'.length)) as T;
    }
    if (request.path.startsWith('/organizations')) {
      return organizationRoutes(request, request.path.slice('/organizations'.length)) as T;
    }
    const acceptMatch = /^\/invitations\/([^/]+)\/accept$/.exec(request.path);
    if (acceptMatch !== null) {
      return acceptInvitationRoute(request, acceptMatch[1] as string) as T;
    }
    refuse(404, 'errors.http.not_found');
  };

  return {
    client,

    putUser(seed: UserJSON, secret: string): void {
      // Stored as the *entity* renders it, because that is what the backend
      // emits: a controller returns `entity.toJSON()` and never a stored row. A
      // seed whose address is not in normal form therefore arrives normalized,
      // exactly as it would from the real one.
      users.set(seed.id, { json: User.fromJSON(seed).toJSON(), secret });
    },

    putSession(seed: SessionJSON): void {
      sessions.set(seed.id, Session.fromJSON(seed).toJSON());
    },

    putIdentity(seed: AuthIdentityJSON): void {
      identities.set(seed.id, AuthIdentity.fromJSON(seed).toJSON());
    },

    putOrganization(seed: OrganizationJSON): void {
      organizations.set(seed.id, Organization.fromJSON(seed).toJSON());
    },

    putMembership(seed: MembershipJSON): void {
      memberships.set(seed.id, Membership.fromJSON(seed).toJSON());
    },

    tokenForInvitation(invitationId: InvitationId): string {
      const token = invitationTokens.get(invitationId);
      if (token === undefined) {
        throw new Error(`stubBackend: no token was minted for invitation "${String(invitationId)}"`);
      }
      return token;
    },

    putVerification(userId: UserId, credential: string, expiresAt: Date): void {
      verifications.set(credential, { userId, expiresAt, consumedAt: null });
    },

    issuedCredentials(): readonly string[] {
      return [...credentials.keys()];
    },

    renewalCookie(): string | null {
      return cookie;
    },

    refreshRequests(): number {
      return refreshes;
    },

    endSessionsOf(userId: UserId): void {
      revokeAllOf(userId);
    },

    presentRenewalCookie(value: string | null): void {
      cookie = value;
    },
  };
}
