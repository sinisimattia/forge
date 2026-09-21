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

/** Where a redirect lands when nothing more specific was ever recorded. */
const DEFAULT_LANDING_PATH = '/';

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
   * R5: the access credential this callback may mint is set as the refresh
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
        case 'SIGNED_IN':
          REFRESH_COOKIE.set(response, result.credentials.refreshToken);
          return this.landingUrl(result.redirectTo, null);
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
   * Builds the webapp URL this callback ends every path at.
   *
   * `path` is either `null` or a value `OAuthService.validateRedirectTo`
   * already accepted at `begin` time — a single leading `/`, never `//` or
   * `/\` — so resolving it against `this.webappUrl` with `URL` is exactly the
   * relative-path resolution that validation exists to make safe, and never
   * an origin a caller supplied.
   */
  private landingUrl(path: string | null, error: FederatedRefusalCode | null): string {
    const target = new URL(path ?? DEFAULT_LANDING_PATH, this.webappUrl);
    if (error !== null) target.searchParams.set('error', error);
    return target.toString();
  }
}
