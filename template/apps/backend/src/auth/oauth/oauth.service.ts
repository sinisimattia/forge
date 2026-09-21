import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { AuthenticationRejectionReason } from '__FORGE_SCOPE__/core/auth/enums';
import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import type { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider, FederatedLinkOutcome, FederatedSignInOutcome } from '__FORGE_SCOPE__/core/identities/enums';
import { decideFederatedLink, decideFederatedSignIn } from '__FORGE_SCOPE__/core/identities/policies';
import type {
  AuthIdentityId,
  FederatedAccount,
  FederatedLinkInput,
  FederatedSignInInput,
} from '__FORGE_SCOPE__/core/identities/types';
import { assertNever, normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditService } from '../../audit/audit.service';
import { generateOpaqueToken, hashOpaqueToken } from '../../common/crypto';
import { IdentitiesService } from '../../identities/identities.service';
import { UserRecord } from '../../users/user-record.entity';
import { AuthService } from '../auth.service';
import { IssuedCredentials, SessionService } from '../session/session.service';
import { OAuthAuthorizationRequestRecord } from './oauth-authorization-request.entity';
import { OAuthProviderRegistry } from './oauth-provider.registry';
import { createPkcePair } from './pkce';

/**
 * What one `oauth_authorization_requests` row is for.
 *
 * **The one place either value is spelled.** `purpose` is plain `text` with no
 * SQL literal (see the migration's own TSDoc for why: every enum-ish column
 * in this schema is declared the same way), so nothing in the database stops
 * a writer storing `'SIGN_IN'` and a reader comparing `'SIGNIN'` — a silent
 * mismatch no constraint would catch. `OAuthService.begin` and `beginLink`
 * write through this object below; the callback reads through it too,
 * rather than either side writing the string again.
 *
 * `__tests__/oauth.service.begin.spec.ts` pins these two literal values
 * independently of this object, so a change here that drifted from what the
 * column actually needs to hold would fail that test rather than only this
 * object's own (tautological) reflection of itself.
 */
export const OAuthAuthorizationPurpose = {
  /** No actor yet — that is what a sign-in is. */
  SIGN_IN: 'SIGN_IN',
  /** Recorded against the actor already authenticated when the request began. */
  LINK: 'LINK',
} as const;

/** The type half of {@link OAuthAuthorizationPurpose}. */
export type OAuthAuthorizationPurpose
  = (typeof OAuthAuthorizationPurpose)[keyof typeof OAuthAuthorizationPurpose];

/**
 * How long a pending authorization lives, in milliseconds.
 *
 * Minutes, not the session's lifetime: a pending authorization is a thing a
 * person can be walked into completing, by a link mailed to them or a tab
 * left open, and every minute it stays valid is a minute that walk-through
 * stays possible. Ten minutes is comfortably enough to reach a provider's
 * consent screen and comfortably short of anything a person forgets they
 * started.
 */
export const OAUTH_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

/**
 * The opaque codes {@link OAuthService.complete} may put in a redirect.
 *
 * **This repository owns every one of them.** None is a provider's own error
 * text, and none is a database or driver message: `complete`'s own TSDoc
 * states why — a provider's error string is attacker-influenced text this
 * application would otherwise be rendering in its own UI, and a rejection
 * reason is server-side knowledge the caller was never entitled to in the
 * first place (`AuthenticationRejectionReason`'s own doc makes the same
 * argument for a password sign-in; this is the federated side of the same
 * rule).
 */
export type FederatedRefusalCode
  = | 'AUTHORIZATION_EXPIRED'
    | 'AUTHORIZATION_UNKNOWN'
    | 'PROVIDER_UNAVAILABLE'
    | 'EMAIL_UNVERIFIED'
    | 'EMAIL_ALREADY_REGISTERED'
    | 'IDENTITY_ALREADY_LINKED'
    | 'ACCOUNT_UNAVAILABLE';

/**
 * What {@link OAuthService.complete} decided. One member per ending, each
 * carrying only what that ending needs — `redirectTo` on every member because
 * every ending has somewhere to send the browser, even a refusal: it is the
 * authorization row's own `redirectTo`, echoed back once the row is known
 * (`null` when no row was ever found, because there is nothing to echo).
 */
export type CompletedAuthorization
  = | {
    readonly status: 'SIGNED_IN';
    readonly credentials: IssuedCredentials;
    readonly redirectTo: string | null;
  }
  | { readonly status: 'LINKED'; readonly redirectTo: string | null }
  | { readonly status: 'REFUSED'; readonly code: FederatedRefusalCode; readonly redirectTo: string | null };

/**
 * Thrown, and only ever caught, inside {@link OAuthService.complete}: the
 * control-flow device that lets the authorization row's own validity checks
 * — read inside one transaction, under a write lock — refuse from deep
 * inside that transaction without the transaction's own return type having
 * to carry a refusal alongside a row. Never thrown across a public method
 * boundary and never a class anything outside this file has a reason to
 * name.
 *
 * Carries `redirectTo` because one of the checks it stands for — expired —
 * finds a real row before refusing it, and that row's own `redirectTo` is
 * the right one to echo back so the browser lands where it asked to go.
 * Every `AUTHORIZATION_UNKNOWN` refusal passes `null` instead, **even the
 * ones that also found a row** (already consumed, wrong provider, the
 * race-defensive re-check): those three and "no row answers to this state
 * at all" are meant to be indistinguishable from outside, and echoing a
 * row's `redirectTo` only on three of the four would let whoever presents a
 * state learn that a row existed exactly when the fourth case wouldn't.
 */
class AuthorizationRowRefusal extends Error {
  public constructor(
    public readonly code: FederatedRefusalCode,
    public readonly redirectTo: string | null,
  ) {
    super(`oauth authorization row refused: ${code}`);
  }
}

/**
 * Beginning a federated authorization — for signing in and for linking.
 *
 * Both entry points below do the same four things, in the same order: resolve
 * the provider through the fail-closed {@link OAuthProviderRegistry} (never a
 * cast of the route parameter — see that class's own TSDoc), mint a PKCE pair
 * and an opaque state, persist one row recording what this request is *for*
 * and *who asked*, and hand back the URL the browser is sent to. The two
 * public methods differ only in which purpose and which actor they record —
 * see {@link OAuthService.start}, which both call.
 *
 * ## Why the purpose and the actor live on the row, never in the URL
 *
 * A purpose carried as a query parameter or a route segment can be edited by
 * whoever holds the browser between the redirect out and the return — turning
 * a link into a sign-in, or the reverse. Fixing it here, at the moment this
 * server itself asked for it, is what the callback will have to trust
 * instead.
 */
@Injectable()
export class OAuthService {
  private readonly publicApiUrl: string;

  public constructor(
    @InjectRepository(OAuthAuthorizationRequestRecord)
    private readonly requests: Repository<OAuthAuthorizationRequestRecord>,
    @InjectRepository(UserRecord)
    private readonly users: Repository<UserRecord>,
    private readonly registry: OAuthProviderRegistry,
    private readonly identities: IdentitiesService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    // Read once, at construction, with no default — the reasoning
    // `AuthService`'s own `PUBLIC_WEBAPP_URL` field gives applies unchanged: a
    // redirect URI built from an incoming request's `Host` header would let
    // anyone who can reach this API choose where an authorization code is
    // delivered.
    this.publicApiUrl = config.getOrThrow<string>('PUBLIC_API_URL');
  }

  /**
   * Begins a sign-in. No actor: that is what a sign-in is, and the row
   * records `userId: null` to say so.
   *
   * @param providerName - the raw route parameter naming a provider
   * @param redirectTo - where the browser should land once sign-in completes,
   *   or `null` for this deployment's own default
   * @returns the absolute URL to send the browser to
   * @throws NotFoundException when `providerName` names no provider this
   *   deployment registered
   * @throws BadRequestException when `redirectTo` is not a same-application
   *   path
   */
  public async begin(providerName: string, redirectTo: string | null): Promise<string> {
    return this.start(providerName, redirectTo, OAuthAuthorizationPurpose.SIGN_IN, null);
  }

  /**
   * Begins linking a federated provider to the account already authenticated.
   *
   * `redirectTo` is not a parameter here on purpose: this call is made by an
   * already-authenticated caller through this application's own UI, not by
   * whoever can construct a URL, so there is no untrusted destination to
   * carry.
   *
   * @param actorId - the account making the request, recorded on the row so
   *   the callback links against the actor who asked rather than
   *   whoever the callback happens to arrive as
   * @param providerName - the raw route parameter naming a provider
   * @returns the absolute URL to send the browser to
   * @throws NotFoundException when `providerName` names no provider this
   *   deployment registered
   */
  public async beginLink(actorId: UserId, providerName: string): Promise<string> {
    return this.start(providerName, null, OAuthAuthorizationPurpose.LINK, actorId);
  }

  /**
   * Completes a federated authorization — the callback's whole job, and the
   * only place a provider's assertion becomes a session or an identity.
   *
   * ## The ordering, and why each step comes where it does
   *
   * 1. The provider is resolved through the registry first, before the
   *    authorization row is ever read — an unregistered provider is refused
   *    with nothing about this state value looked at.
   * 2. The row is read **inside a transaction, under a write lock**, exactly
   *    as `AuthService.verifyEmail` reads its own single-use row (see
   *    {@link OAuthService.consumeAuthorizationRow}): two simultaneous
   *    presentations of one state must not both succeed, and without the
   *    lock both would read `consumed_at IS NULL` and both proceed.
   * 3. Every refusal the row itself can produce — no row, already consumed,
   *    expired, or issued for a different provider than this callback
   *    arrived at — is decided and the row is marked consumed, all inside
   *    that one transaction, before this method calls anything that can
   *    fail or be slow. A code minted by one provider and presented at
   *    another's callback is refused **on the row**, never on the code,
   *    which this application cannot read.
   * 4. Only once the row is safely consumed, and the transaction holding its
   *    lock has committed, does the exchange happen: `fetchAccount`, a
   *    network call to the provider, deliberately outside the transaction.
   *    A provider that is slow, or an exchange that throws, must not leave
   *    the authorization presentable a second time — marking it consumed
   *    first, rather than after, is the ordering that survives both.
   * 5. `fetchAccount` throwing becomes `PROVIDER_UNAVAILABLE` and nothing
   *    else. Never the provider's own error text: it is attacker-influenced
   *    text this application would otherwise be rendering in its own UI.
   * 6. What happens with a fetched account depends on the row's own
   *    `purpose`, never on anything else — {@link OAuthService.completeSignIn}
   *    or {@link OAuthService.completeLink}, the same discipline `start`
   *    holds itself to when it fixes `purpose` at the beginning rather than
   *    trusting a value a caller could supply later.
   *
   * @param providerName - the raw route parameter naming the provider this
   *   callback arrived at
   * @param code - the authorization code the provider's redirect carried
   * @param state - the state value the provider's redirect carried
   * @param client - what could be told about where the callback arrived from
   * @returns what happened, and where the browser should go next
   */
  public async complete(
    providerName: string,
    code: string,
    state: string,
    client: ClientContext,
  ): Promise<CompletedAuthorization> {
    const provider = this.registry.find(providerName);
    if (provider === null) {
      return { status: 'REFUSED', code: 'PROVIDER_UNAVAILABLE', redirectTo: null };
    }

    const now = new Date();
    const stateHash = hashOpaqueToken(state);

    let row: OAuthAuthorizationRequestRecord;
    try {
      row = await this.dataSource.transaction((manager) =>
        OAuthService.consumeAuthorizationRow(manager, stateHash, provider.provider, now));
    } catch (error) {
      if (error instanceof AuthorizationRowRefusal) {
        return { status: 'REFUSED', code: error.code, redirectTo: error.redirectTo };
      }
      throw error;
    }

    let account: FederatedAccount;
    try {
      account = await provider.fetchAccount({
        code,
        codeVerifier: row.codeVerifier,
        redirectUri: `${this.publicApiUrl}/auth/oauth/${providerName}/callback`,
      });
    } catch {
      return { status: 'REFUSED', code: 'PROVIDER_UNAVAILABLE', redirectTo: row.redirectTo };
    }

    const linkedRow = await this.identities.findByProviderAccount(
      provider.provider,
      account.subject,
    );
    const linkedIdentity = linkedRow === null ? null : IdentitiesService.toEntity(linkedRow);

    // An explicit dispatch on both values `purpose` is ever written with,
    // never a fallthrough default. `purpose` is plain `text` with no SQL
    // constraint (see `OAuthAuthorizationPurpose`'s own TSDoc), so a row
    // whose value is neither is reachable in principle — corruption, a
    // future writer, a botched migration. A ternary that reads "not LINK,
    // so treat it as a sign-in" would answer such a row by minting a
    // session; the safe default on a security branch is to refuse, not to
    // guess.
    if (row.purpose === OAuthAuthorizationPurpose.SIGN_IN) {
      return this.completeSignIn(row, account, linkedIdentity, provider.provider, now, client);
    }
    if (row.purpose === OAuthAuthorizationPurpose.LINK) {
      return this.completeLink(
        row,
        linkedIdentity,
        provider.provider,
        account.subject,
        now,
        client,
      );
    }
    return { status: 'REFUSED', code: 'AUTHORIZATION_UNKNOWN', redirectTo: null };
  }

  /**
   * Reads the authorization row under a write lock and marks it consumed —
   * points 2 and 3 of {@link OAuthService.complete}'s own TSDoc, pulled out
   * as their own `static` so the transaction boundary is visible at the call
   * site instead of folded into a much longer method.
   *
   * @throws AuthorizationRowRefusal `AUTHORIZATION_UNKNOWN` for no row, an
   *   already-consumed row, or a row issued for a different provider;
   *   `AUTHORIZATION_EXPIRED` for one whose time has run out
   */
  private static async consumeAuthorizationRow(
    manager: EntityManager,
    stateHash: string,
    provider: AuthProvider,
    now: Date,
  ): Promise<OAuthAuthorizationRequestRecord> {
    const found = await manager.findOne(OAuthAuthorizationRequestRecord, {
      where: { stateHash },
      lock: { mode: 'pessimistic_write' },
    });

    // Every AUTHORIZATION_UNKNOWN throw below passes `null`, never
    // `found.redirectTo`, even on the three branches that DID find a row —
    // already consumed, wrong provider, and the race-defensive re-check
    // after the update. Echoing the row's own `redirectTo` only on
    // AUTHORIZATION_EXPIRED (below) and never on AUTHORIZATION_UNKNOWN is
    // what makes "no row answers to this state" and "a row does, but this
    // presentation of it is refused for a different reason" genuinely
    // indistinguishable from outside, on every field of the response, not
    // only on `code`.
    if (found === null) throw new AuthorizationRowRefusal('AUTHORIZATION_UNKNOWN', null);
    if (found.consumedAt !== null) throw new AuthorizationRowRefusal('AUTHORIZATION_UNKNOWN', null);
    if (found.expiresAt.getTime() <= now.getTime()) {
      throw new AuthorizationRowRefusal('AUTHORIZATION_EXPIRED', found.redirectTo);
    }
    // Refused on the row, never on the code — this application cannot read
    // the code, so a code minted by one provider and presented at another's
    // callback is indistinguishable, from here, from a state presented at
    // the right callback but naming the wrong one. Both are
    // AUTHORIZATION_UNKNOWN.
    if (found.provider !== provider) throw new AuthorizationRowRefusal('AUTHORIZATION_UNKNOWN', null);

    // The `affected` count is read for the reason `AuthService.verifyEmail`
    // reads its own: redundant while the lock above is held, and the only
    // thing standing between a double-spend and a reported success if that
    // lock were ever removed.
    const consumed = await manager.update(
      OAuthAuthorizationRequestRecord,
      { id: found.id, consumedAt: IsNull() },
      { consumedAt: now },
    );
    if (consumed.affected !== 1) throw new AuthorizationRowRefusal('AUTHORIZATION_UNKNOWN', null);

    return { ...found, consumedAt: now };
  }

  /**
   * The sign-in half of {@link OAuthService.complete}: applies
   * `decideFederatedSignIn` — discriminating test D11's own rule — and, for
   * the one outcome that signs somebody in, the account-state rule a
   * password sign-in is subject to, in the same order. `AuthService.rejectionFor`
   * is called below rather than restated: a second implementation of that
   * ordering is a second place for the two to disagree about which reason is
   * most permanent.
   */
  private async completeSignIn(
    row: OAuthAuthorizationRequestRecord,
    account: FederatedAccount,
    linkedIdentity: AuthIdentity | null,
    provider: AuthProvider,
    now: Date,
    client: ClientContext,
  ): Promise<CompletedAuthorization> {
    const matchingUserRow = account.email === null
      ? null
      : await this.users.findOne({ where: { email: normalizeEmail(account.email) } });

    const input: FederatedSignInInput = {
      account,
      linkedIdentity,
      userWithMatchingEmail: matchingUserRow === null ? null : { id: matchingUserRow.id as UserId },
    };
    const decision = decideFederatedSignIn(input);

    switch (decision.outcome) {
      case FederatedSignInOutcome.SIGN_IN_EXISTING:
        return this.signInExisting(
          decision.userId,
          decision.identityId,
          row.redirectTo,
          now,
          client,
        );

      case FederatedSignInOutcome.PROVISION_NEW:
        // `provider` — the registry-resolved value, never `account.provider`
        // (the adapter's own self-report) — is what a later sign-in's own
        // `findByProviderAccount` lookup above is keyed on too. Every
        // adapter today reports its own value correctly, so writing the
        // wrong one is latent, not live — but if the two ever disagreed,
        // this identity would be unfindable by that lookup, the next
        // sign-in would re-provision, D11 would refuse it, and the account
        // would be locked out with nothing pointing at why.
        return this.provisionAndSignIn(
          decision.email,
          decision.displayName,
          provider,
          account.subject,
          row.redirectTo,
          now,
          client,
        );

      case FederatedSignInOutcome.REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT:
        // D11, at the service level: refused, and NOT linked. The actor
        // recorded is the account that already existed — nothing has been
        // established about whoever presented this assertion, which is the
        // point — and `decision.existingUserId` exists on this decision for
        // exactly this entry; it is never returned to the caller below.
        // `client` IS passed here, unlike a first draft of this method:
        // the actor being the incumbent makes the client address the only
        // field in this row saying anything about whoever made the attempt,
        // and this action's own TSDoc calls it the entry a reader looking
        // for an attempted takeover would search for.
        await this.record(
          AuditAction.FEDERATED_LINK_REFUSED,
          decision.existingUserId,
          { provider },
          now,
          client,
        );
        return { status: 'REFUSED', code: 'EMAIL_ALREADY_REGISTERED', redirectTo: row.redirectTo };

      case FederatedSignInOutcome.REFUSE_UNVERIFIED_EMAIL:
        // No account is established on this branch, but the attempt itself
        // is not therefore invisible: `AuditService.record` takes a null
        // actor exactly for this shape (see `signInExisting`'s
        // UNKNOWN_ACCOUNT branch below, and `AuthService.register`'s
        // lost-race branch), and an unverified or absent address asserted
        // by a provider is a refusal somebody investigating abuse would
        // come looking for. `LOGIN_FAILED` is the action already used for
        // any rejected sign-in attempt; `code` in the metadata is this
        // method's own `FederatedRefusalCode`, not
        // `AuthenticationRejectionReason` — this is not a judgement about a
        // local account's state, nothing local was ever reached, it is
        // only what the provider itself said.
        await this.record(
          AuditAction.LOGIN_FAILED,
          null,
          { code: 'EMAIL_UNVERIFIED', provider },
          now,
          client,
        );
        return { status: 'REFUSED', code: 'EMAIL_UNVERIFIED', redirectTo: row.redirectTo };

      default:
        return assertNever(decision);
    }
  }

  /**
   * Signs in the account a federated subject is already linked to.
   *
   * @param userId - whose account this is, per `decideFederatedSignIn`
   * @param identityId - the identity that proved it, marked used
   * @param redirectTo - the authorization row's own destination, echoed back
   * @param now - the instant this authorization completed
   * @param client - what could be told about where the callback arrived from
   */
  private async signInExisting(
    userId: UserId,
    identityId: AuthIdentityId,
    redirectTo: string | null,
    now: Date,
    client: ClientContext,
  ): Promise<CompletedAuthorization> {
    const row = await this.users.findOne({ where: { id: userId } });
    if (row === null) {
      // Unreachable through this application — `auth_identities.user_id`
      // cascades on delete, so a linked identity naming a user with no row
      // cannot exist — and answered rather than thrown regardless, the same
      // discipline `AuthService.signIn` holds itself to for the identical
      // shape of gap.
      await this.record(
        AuditAction.LOGIN_FAILED,
        null,
        { reason: AuthenticationRejectionReason.UNKNOWN_ACCOUNT },
        now,
        client,
      );
      return { status: 'REFUSED', code: 'ACCOUNT_UNAVAILABLE', redirectTo };
    }

    const user = AuthService.toUser(row);
    if (!user.canAuthenticate()) {
      // Checked AFTER the subject was proven, exactly where
      // `AuthService.signIn` checks it relative to the secret: an account
      // that is suspended, deleted or unverified must be exactly as
      // unreachable through a provider as it is through a password. The
      // reason is recorded and never returned — `ACCOUNT_UNAVAILABLE` is the
      // one outward code for all three, the same collapse
      // `AuthenticationRejectionReason`'s own doc describes for a rejected
      // password attempt.
      await this.record(
        AuditAction.LOGIN_FAILED,
        user.id,
        { reason: AuthService.rejectionFor(user) },
        now,
        client,
      );
      return { status: 'REFUSED', code: 'ACCOUNT_UNAVAILABLE', redirectTo };
    }

    await this.identities.markUsed(identityId, now);
    const credentials = await this.sessions.begin(user.id, client);
    await this.record(
      AuditAction.LOGIN_SUCCEEDED,
      user.id,
      { sessionId: credentials.session.id },
      now,
      client,
    );
    return { status: 'SIGNED_IN', credentials, redirectTo };
  }

  /**
   * Provisions a new account for a verified address nobody holds, and signs
   * it in — `decideFederatedSignIn`'s fourth ending, reached only once the
   * other three have refused it. The user row, its new federated identity,
   * and the session it signs in with are one transaction: both or neither,
   * the same argument `AuthService.changePasswordAndReissue` makes for
   * pairing a password change with the session it reissues. A window between
   * "the account exists" and "the session exists" would leave somebody who
   * just proved a brand-new address with no way to use the account it was
   * proven for.
   */
  private async provisionAndSignIn(
    email: string,
    displayName: string | null,
    provider: AuthProvider,
    subject: string,
    redirectTo: string | null,
    now: Date,
    client: ClientContext,
  ): Promise<CompletedAuthorization> {
    const resolvedDisplayName = OAuthService.resolveDisplayName(displayName, email);

    const { userId, credentials } = await this.dataSource.transaction(async (manager) => {
      const inserted = await manager.insert(UserRecord, {
        email,
        displayName: resolvedDisplayName,
        status: UserStatus.ACTIVE,
        platformRole: PlatformRole.PLATFORM_USER,
        // The provider proved this address. Sending a verification mail to
        // an address a provider just proved would be asking the person to
        // prove it twice — the reason this differs from `AuthService.register`,
        // which never has a provider's own proof to lean on.
        emailVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      const id = inserted.identifiers[0].id as UserId;
      await this.identities.createFederatedIdentityIn(manager, id, provider, subject, now);
      const issued = await this.sessions.beginIn(manager, id, client);
      return { userId: id, credentials: issued };
    });

    await this.record(AuditAction.USER_REGISTERED, userId, {}, now);
    await this.record(
      AuditAction.LOGIN_SUCCEEDED,
      userId,
      { sessionId: credentials.session.id },
      now,
      client,
    );
    return { status: 'SIGNED_IN', credentials, redirectTo };
  }

  /**
   * What to call a newly provisioned account when the provider disclosed no
   * name (`FederatedAccount.displayName` is `string | null` for exactly this
   * reason). The mailbox's own local part — the substring before `@` —
   * rather than a placeholder such as "New User": `User`'s constructor
   * refuses an empty display name, so *something* has to be stored, and the
   * local part is at least a value the account's own owner chose, unlike an
   * invented placeholder every provisioned-with-no-name account would
   * otherwise share.
   *
   * **A display convenience only, carrying no identity meaning.** `email`
   * here is always the address `decideFederatedSignIn`'s `PROVISION_NEW`
   * has already established as verified — `REFUSE_UNVERIFIED_EMAIL` refuses
   * an absent or unverified one before this function is ever reached — but
   * what THIS function returns is not itself a verified fact about anybody:
   * it is a string derived from one, shown back to the account's own owner
   * and nobody else. Nothing may ever compare against it, look an account up
   * by it, or treat it as though a provider had asserted it — that would be
   * mistaking a cosmetic default for a fact this function was never in a
   * position to establish.
   */
  private static resolveDisplayName(displayName: string | null, email: string): string {
    const trimmed = displayName?.trim() ?? '';
    if (trimmed !== '') return trimmed;
    return email.split('@')[0];
  }

  /**
   * The link half of {@link OAuthService.complete}: applies
   * `decideFederatedLink`, called and never restated — see that function's
   * own TSDoc for why no address plays any part in this decision, and why
   * linking is unconditional on the address a provider happens to assert.
   */
  private async completeLink(
    row: OAuthAuthorizationRequestRecord,
    linkedIdentity: AuthIdentity | null,
    provider: AuthProvider,
    subject: string,
    now: Date,
    client: ClientContext,
  ): Promise<CompletedAuthorization> {
    // Set unconditionally by `beginLink`, and by nothing else: a LINK row
    // always carries the actor it was opened for. See that method's own
    // doc — but the column itself is nullable, with nothing enforcing that
    // a LINK-purpose row actually has one, so a null here is answered
    // rather than trusted with a cast, the same discipline
    // `signInExisting`'s own unreachable-row branch holds itself to for the
    // identical shape of gap: a null owner must never reach the write below
    // that creates an identity.
    if (row.userId === null) {
      return { status: 'REFUSED', code: 'AUTHORIZATION_UNKNOWN', redirectTo: row.redirectTo };
    }
    const actorId = row.userId as UserId;

    const input: FederatedLinkInput = { actorUserId: actorId, linkedIdentity };
    const decision = decideFederatedLink(input);

    switch (decision.outcome) {
      case FederatedLinkOutcome.LINK: {
        const identity = await this.dataSource.transaction((manager) =>
          this.identities.createFederatedIdentityIn(manager, actorId, provider, subject, now));
        await this.audit.record({
          organizationId: null,
          actorId,
          action: AuditAction.IDENTITY_LINKED,
          resourceType: 'auth_identity',
          resourceId: identity.id,
          metadata: { provider },
          clientAddress: client.address,
          clientLabel: client.label,
          occurredAt: now,
        });
        return { status: 'LINKED', redirectTo: row.redirectTo };
      }

      case FederatedLinkOutcome.ALREADY_LINKED_TO_ACTOR:
        // Idempotent, not an error — see that outcome's own TSDoc. Nothing
        // changed, so nothing new is written: an IDENTITY_LINKED entry here
        // would record a link that did not happen, a second time.
        return { status: 'LINKED', redirectTo: row.redirectTo };

      case FederatedLinkOutcome.LINKED_TO_ANOTHER_ACCOUNT:
        // Refused without saying whose account it is — `decision` itself
        // carries no id, for exactly that reason (see
        // `FederatedLinkDecision`'s own TSDoc), and neither `code` nor
        // `redirectTo` below can leak one either.
        //
        // The audit entry is `IDENTITY_LINK_CONFLICT`, not
        // `FEDERATED_LINK_REFUSED` — a deliberately different action from
        // D11's, above, because the actor rule has to be the opposite one.
        // D11 arrives unauthenticated, so nothing is known about whoever
        // made the attempt and the incumbent is the only honest actor to
        // record. This request is authenticated: `actorId` IS who made the
        // attempt, established before this flow ever began, and recording
        // the incumbent here instead would misattribute the attempt to an
        // account that did nothing. See `AuditAction.IDENTITY_LINK_CONFLICT`'s
        // own TSDoc for the full argument — it is the useful part of having
        // two actions rather than one with two incompatible actor rules.
        // `client` IS passed, matching `IDENTITY_LINKED` a few lines above —
        // a refusal entry recording less about the request than its own
        // sibling success entry would be an odd asymmetry to ship silently.
        await this.record(
          AuditAction.IDENTITY_LINK_CONFLICT,
          actorId,
          { provider },
          now,
          client,
        );
        return { status: 'REFUSED', code: 'IDENTITY_ALREADY_LINKED', redirectTo: row.redirectTo };

      default:
        return assertNever(decision);
    }
  }

  /** One audit write, with this phase's fixed `organizationId` of `null` and `resourceType` of `'user'`. */
  private record(
    action: AuditAction,
    actorId: UserId | null,
    metadata: Record<string, unknown>,
    occurredAt: Date,
    client: ClientContext = { address: null, label: null },
  ): Promise<void> {
    return this.audit.record({
      organizationId: null,
      actorId,
      action,
      resourceType: 'user',
      resourceId: actorId,
      metadata,
      clientAddress: client.address,
      clientLabel: client.label,
      occurredAt,
    });
  }

  /** The whole of beginning an authorization. See this class's own TSDoc. */
  private async start(
    providerName: string,
    redirectTo: string | null,
    purpose: OAuthAuthorizationPurpose,
    userId: UserId | null,
  ): Promise<string> {
    const provider = this.registry.find(providerName);
    if (provider === null) throw new NotFoundException();

    const safeRedirectTo = OAuthService.validateRedirectTo(redirectTo);

    const { verifier, challenge } = createPkcePair();
    const state = generateOpaqueToken();
    const now = new Date();

    await this.requests.insert({
      // Never the raw state — see this column's own TSDoc on the entity and
      // the migration that created it. A leak of this table must not be a
      // set of usable pending authorizations.
      stateHash: state.hash,
      // In the clear, deliberately: this is what this server proves to the
      // provider at the token exchange, so it has to be recoverable here.
      codeVerifier: verifier,
      provider: provider.provider,
      purpose,
      userId,
      redirectTo: safeRedirectTo,
      createdAt: now,
      expiresAt: new Date(now.getTime() + OAUTH_AUTHORIZATION_TTL_MS),
      consumedAt: null,
    });

    return provider.authorizationUrl({
      // The raw value, never the digest: this is what the browser carries out
      // and what the callback will present back, for this server to hash and
      // compare against `stateHash`.
      state: state.token,
      codeChallenge: challenge,
      redirectUri: `${this.publicApiUrl}/auth/oauth/${providerName}/callback`,
    });
  }

  /**
   * Accepts `redirectTo` only as a path beginning with a single `/` and not
   * `//` — refuses everything else.
   *
   * **A whitelist over the one accepted shape, not a blacklist of rejected
   * ones.** An open redirect on a sign-in path is a phishing primitive: a
   * link that genuinely signs somebody in and then lands them wherever the
   * link's author chose. Enumerating the bad forms — an absolute URL, a
   * scheme-relative `//host` that a browser reads as "same scheme, different
   * host", a backslash a browser normalizes into a second forward slash
   * before ever reaching this server — is the shape of defect this
   * repository has already paid for once: `migration-sql.spec.ts` records
   * five rounds of exactly that approach, each round closing one variant and
   * each followed by another. Refusing anything that is not the one modeled
   * shape closes all of them, known and not-yet-thought-of alike, in one
   * rule.
   *
   * @param redirectTo - the caller-supplied destination, or `null` for none
   * @returns `redirectTo` unchanged, or `null`
   * @throws BadRequestException when `redirectTo` is any other shape
   */
  private static validateRedirectTo(redirectTo: string | null): string | null {
    if (redirectTo === null) return null;
    // Exactly one leading '/', and the character after it is neither another
    // '/' nor a '\' — the latter because a browser resolving a redirect
    // normalizes a leading backslash into a second forward slash before it
    // ever reaches this server, making '/\\evil.example' the same
    // scheme-relative escape as '//evil.example' typed with a different
    // character.
    if (/^\/(?!\/|\\)/.test(redirectTo)) return redirectTo;
    throw new BadRequestException({ messageKey: 'errors.oauth.invalid_redirect' });
  }
}
