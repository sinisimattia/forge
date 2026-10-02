import { Controller, Get, HttpStatus, Param, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { assertNever } from '__FORGE_SCOPE__/core/shared/policies';
import { clientContextOf } from '../client-context';
import { Public } from '../decorators';
import { REFRESH_COOKIE } from '../refresh-cookie';
import type { ProviderListResponseDto } from './dto';
import { OAuthProviderRegistry } from './oauth-provider.registry';
import type { FederatedRefusalCode } from './oauth.service';
import { OAuthService } from './oauth.service';

/**
 * The one page on the webapp every completed authorization lands on, success
 * or refusal alike.
 *
 * **This literal has to agree with a route this repository does not compile
 * against** — `apps/webapp/app/pages/oauth/callback.vue`, a separate
 * application this one shares no package with (ADR-0008). Nuxt's file-based
 * routing turns that file into exactly this path; there is nothing on this
 * side that would fail to build if the two drifted, only a browser landing on
 * a 404 mid sign-in. `oauth.controller.spec.ts` pins this constant's value
 * against the literal string, which is the only cross-check two apps that
 * share no package can have (the same trade `FEDERATED_REFUSAL_CODES`'s own
 * TSDoc, on the webapp side, makes for the seven codes carried through it).
 *
 * ## Why every path — not only a refusal — routes through here now
 *
 * It did not always. A first version of this callback sent a *successful*
 * authorization straight to its own `redirectTo` — `/organizations`, say —
 * and appended `?error=` to *that* URL for a refusal that had found the same
 * row. That put a refusal on whatever page the person happened to be
 * heading to, most of which render no `error` query parameter at all: the
 * message this application built specifically to carry D11's remedy —
 * `EMAIL_ALREADY_REGISTERED`, "sign in the way you already can, then link the
 * provider from account settings" — was minted correctly and shown to nobody,
 * silently. That is exactly the "a refusal with no route forward" failure
 * this flow exists to avoid, arriving through the wiring rather than the
 * wording.
 *
 * So every ending — `SIGNED_IN`, `LINKED`, and every `REFUSED` — now lands
 * here, and the authorization's own destination travels as `redirectTo`
 * rather than as the URL's own path. `pages/oauth/callback.vue` is the one
 * place a person's browser can be on this origin holding a session that was
 * *just* renewed and a refusal that has somewhere specific to show it. On
 * success it renews through the store (never through a credential in this
 * URL — see the note on `callback` below, "why no credential travels in the
 * redirect URL") and forwards to `redirectTo`; on a
 * refusal it renders the named message and goes nowhere on its own.
 */
const OAUTH_CALLBACK_PATH = '/oauth/callback';

/**
 * Where a federated sign-in goes when the account still owes a second factor.
 *
 * The same cross-application literal {@link OAUTH_CALLBACK_PATH} is, with the
 * same trade and the same cross-check in `oauth.controller.spec.ts`: Nuxt's
 * file-based routing turns `apps/webapp/app/pages/mfa/challenge.vue` into
 * exactly this path, and nothing on this side fails to build if the two
 * drift. **That page does not exist yet** — it belongs to the change that
 * builds the webapp half of two-phase login. Landing here is still the
 * correct destination now: the alternative is landing on the ordinary
 * callback page, which would show somebody who owes a factor a page saying
 * their sign-in is complete.
 *
 * ## Why the challenge token travels in this URL, where the access credential must not
 *
 * The note on `callback` below keeps the refresh credential out of a redirect
 * URL because a query string lands in browser history, in the `Referer` of
 * whatever the webapp loads next, and in every proxy log on the way. All of
 * that is equally true of this token, and it is carried here anyway, because
 * what the two are worth to whoever reads them differs completely: a refresh
 * credential is a session, while this token is *permission to attempt* a
 * second factor for a five-minute window, single-use, and worth nothing
 * without a proof its holder does not have — which is the entire premise of
 * the account having enrolled one. A browser redirect is also the only
 * channel this callback has to the webapp; there is no response body to put
 * it in.
 */
const MFA_CHALLENGE_PATH = '/mfa/challenge';

/**
 * The federated flow on the wire — signing in and completing a sign-in.
 *
 * Every route here is `@Public()`, and the reason differs per route, which is
 * worth writing down separately rather than once for the whole class:
 *
 * - `providers` is public because the login page that reads it is public —
 *   there is no credential yet for anybody to have proven.
 * - `:provider` is public for the same reason: somebody *beginning* a
 *   sign-in, by definition, has none.
 * - `:provider/callback` is public because its caller is not a person at all —
 *   it is the provider's own redirect, following a URL this server minted,
 *   carrying nothing of this application's but the opaque `state` it handed
 *   out. There is no credential to have proven and no session to attach one
 *   to until `OAuthService.complete` decides there is.
 *
 * Linking a provider to an already-proven account is deliberately **not**
 * here — see `IdentitiesController.beginLink`, which is authenticated for a
 * reason of its own that has nothing to do with any of the three above.
 */
@Controller('auth/oauth')
export class OAuthController {
  private readonly webappUrl: string;

  public constructor(
    private readonly oauth: OAuthService,
    private readonly registry: OAuthProviderRegistry,
    config: ConfigService,
  ) {
    // Read once, at construction, with no default and never from a request —
    // the same reasoning `AuthService`'s own `webappUrl` field gives, and
    // `mail/templates/reset-password.ts` spells out in full: a value taken
    // from a request's `Host` header is chosen by whoever sends the request,
    // and a browser this server redirects there on a caller's say-so is an
    // open redirect wearing this application's own name.
    this.webappUrl = config.getOrThrow<string>('PUBLIC_WEBAPP_URL');
  }

  /**
   * Lists only the providers this deployment configured.
   *
   * `providers` before `:provider` in this file on purpose: NestJS (via
   * Express) matches routes in declaration order within a controller, and a
   * static segment declared after a dynamic one risks the dynamic route
   * swallowing it (`GET /auth/oauth/providers` read as `:provider` =
   * `"providers"`). Declared here, first, it cannot be.
   */
  @Public()
  @Get('providers')
  public providers(): ProviderListResponseDto {
    return { providers: [...this.registry.available] };
  }

  /**
   * Begins a sign-in: mints a pending authorization and sends the browser to
   * the provider. Any refusal here — an unregistered provider, an unsafe
   * `redirectTo` — answers with an ordinary error status, because the caller
   * has not gone anywhere yet: this is the click that starts the trip, not
   * the return from it, so there is no half-completed redirect to hide a
   * failure from.
   */
  @Public()
  @Get(':provider')
  public async redirectToProvider(
    @Param('provider') provider: string,
    @Query('redirectTo') redirectTo: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const target = await this.oauth.begin(
      provider,
      typeof redirectTo === 'string' && redirectTo.length > 0 ? redirectTo : null,
    );
    response.redirect(HttpStatus.FOUND, target);
  }

  /**
   * Completes a sign-in or a link and sends the browser back to the webapp.
   *
   * **No exception may escape this method.** Its caller followed a redirect
   * here; an unhandled throw is an error page rendered on this application's
   * own origin in the middle of somebody signing in, not a JSON body a
   * developer is looking at. Every path below — a malformed query, a refusal
   * `OAuthService.complete` decided, or a failure nothing here anticipated —
   * ends in exactly one thing: a `302` to the webapp, carrying one of this
   * repository's own opaque codes and never a provider's own error text
   * (attacker-influenced, and this application would be the one rendering it).
   *
   * **Why no credential travels in the redirect URL:** the access credential
   * this callback may mint is set as the refresh
   * cookie, exactly as `POST /auth/login` sets it (`REFRESH_COOKIE`, the one
   * place that cookie's options are spelled), and never appears in the
   * redirect URL — a token in a query string lands in browser history, the
   * `Referer` header of whatever the webapp loads next, and every proxy log
   * on the way.
   */
  @Public()
  @Get(':provider/callback')
  public async callback(
    @Param('provider') provider: string,
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const location = await this.completeSafely(provider, code, state, request, response);
    response.redirect(HttpStatus.FOUND, location);
  }

  /**
   * The whole of {@link OAuthController.callback}'s logic, isolated so the
   * try/catch reads as the one thing standing between whatever happens in
   * here and a browser that must always end up redirected somewhere.
   */
  private async completeSafely(
    provider: string,
    code: unknown,
    state: unknown,
    request: Request,
    response: Response,
  ): Promise<string> {
    try {
      if (typeof code !== 'string' || code === '' || typeof state !== 'string' || state === '') {
        // The provider's own redirect carries no `code` at all when a person
        // refuses consent, and a direct hit on this endpoint with nothing to
        // present is the same shape of nothing. Neither names a row this
        // application could look up, so this is the same refusal
        // `OAuthService.complete` gives a `state` nothing answers to —
        // decided here because `complete`'s own signature requires both as
        // strings, and never reached for a corrupt or absent value.
        return this.landingUrl(null, 'AUTHORIZATION_UNKNOWN');
      }

      const result = await this.oauth.complete(provider, code, state, clientContextOf(request));

      switch (result.status) {
        case 'SIGNED_IN': {
          // The destination is judged before the cookie is set, so a destination
          // that is refused leaves no credential behind on the response. Deliberate,
          // and behaviour-preserving on every reachable path: `landingUrl` does not
          // throw for a validated `redirectTo`, so no test pins the order. Do not
          // "simplify" it back to setting the cookie first.
          const landing = this.landingUrl(result.redirectTo, null);
          REFRESH_COOKIE.set(response, result.credentials.refreshToken);
          return landing;
        }
        case 'MFA_REQUIRED':
          // **No `REFRESH_COOKIE.set` on this branch, and nothing to set it
          // from** — `CompletedAuthorization`'s `MFA_REQUIRED` member has no
          // `credentials` field, so a copy of the line above would not
          // compile. The session is `POST /auth/mfa/verify`'s to issue once
          // the factor this redirect goes to collect has actually been
          // produced.
          return this.challengeUrl(result.redirectTo, result.challengeToken);
        case 'LINKED':
          return this.landingUrl(result.redirectTo, null);
        case 'REFUSED':
          return this.landingUrl(result.redirectTo, result.code);
        default:
          return assertNever(result);
      }
    } catch {
      // Whatever failed — including something `OAuthService.complete` itself
      // did not anticipate — becomes this one opaque code. Never the
      // underlying error's own message: see this method's own doc.
      return this.landingUrl(null, 'PROVIDER_UNAVAILABLE');
    }
  }

  /**
   * Builds the URL this callback ends every path at: always
   * {@link OAUTH_CALLBACK_PATH}, carrying the authorization's own destination
   * as `redirectTo` and a refusal, if there was one, as `error`.
   *
   * **Two independent checks on `path`, not one.** It is either `null` or a
   * value `OAuthService.validateRedirectTo` already accepted at `begin`
   * time — a single leading `/`, never `//` or `/\` — before it was ever
   * persisted on the authorization row this method is echoing back. That
   * alone would be enough to resolve it safely here. It is carried as a query
   * *value* rather than resolved into this URL's own path so that
   * `pages/oauth/callback.vue` can put it through `localRedirect` a second
   * time before it ever reaches `navigateTo` — the same judgement, applied
   * again, by the side that actually performs the navigation. Neither check
   * alone is load-bearing on its own account; both exist because a value that
   * crosses a redirect this repository does not compile against (ADR-0008)
   * gets no compiler-checked guarantee that the first one still holds by the
   * time the second one runs.
   *
   * `redirectTo` is omitted, not sent empty, when `path` is `null` —
   * `pages/oauth/callback.vue` reads its absence the same way `login.vue`
   * reads an absent `redirect`: as "nowhere was recorded", which resolves to
   * that page's own default rather than to an empty string a browser would
   * try to navigate to.
   */
  private landingUrl(path: string | null, error: FederatedRefusalCode | null): string {
    const target = new URL(OAUTH_CALLBACK_PATH, this.webappUrl);
    if (path !== null) target.searchParams.set('redirectTo', path);
    if (error !== null) target.searchParams.set('error', error);
    return target.toString();
  }

  /**
   * Builds the URL a sign-in that still owes a second factor ends at:
   * {@link MFA_CHALLENGE_PATH}, carrying the challenge token to present at
   * `POST /auth/mfa/verify` and the authorization's own destination to
   * continue to once it has been.
   *
   * Separate from {@link OAuthController.landingUrl} rather than a parameter
   * on it, because the two differ in the one way that matters: `landingUrl`
   * describes a finished authorization, and this one describes a half-done
   * one that is going somewhere specific to be finished. `redirectTo` is
   * carried the same way and for the same reason — including being omitted
   * rather than sent empty when nothing was recorded, which is how the
   * webapp tells "nowhere" from a destination.
   */
  private challengeUrl(path: string | null, challengeToken: string): string {
    const target = new URL(MFA_CHALLENGE_PATH, this.webappUrl);
    target.searchParams.set('challengeToken', challengeToken);
    if (path !== null) target.searchParams.set('redirectTo', path);
    return target.toString();
  }
}
