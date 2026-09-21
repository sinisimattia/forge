import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { generateOpaqueToken } from '../../common/crypto';
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
 * write through this object below; the callback this phase adds in Task 11
 * reads through it too, rather than either side writing the string again.
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
 * server itself asked for it, is what Task 11's callback will have to trust
 * instead.
 */
@Injectable()
export class OAuthService {
  private readonly publicApiUrl: string;

  public constructor(
    @InjectRepository(OAuthAuthorizationRequestRecord)
    private readonly requests: Repository<OAuthAuthorizationRequestRecord>,
    private readonly registry: OAuthProviderRegistry,
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
   *   Task 11's callback links against the actor who asked rather than
   *   whoever the callback happens to arrive as
   * @param providerName - the raw route parameter naming a provider
   * @returns the absolute URL to send the browser to
   * @throws NotFoundException when `providerName` names no provider this
   *   deployment registered
   */
  public async beginLink(actorId: UserId, providerName: string): Promise<string> {
    return this.start(providerName, null, OAuthAuthorizationPurpose.LINK, actorId);
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
      // provider at the token exchange, in Task 11, so it has to be
      // recoverable here.
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
