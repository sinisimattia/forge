import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import { CurrentUser } from '../auth/decorators';
import type { BeginLinkResponseDto } from '../auth/oauth/dto';
import { OAuthService } from '../auth/oauth/oauth.service';
import type { AuthenticatedActor } from '../auth/strategies';
import { ParseUuidParamPipe } from '../common/pipes';
import type { IdentityResponseDto } from './dto';
import { IdentitiesService } from './identities.service';

/**
 * The ways the actor can prove who they are, how one is given up, and how a
 * federated one is added.
 *
 * Mounted under `/users/me/` because that is what these are: part of the actor's
 * own account, reachable only for the actor, with no route anywhere that takes
 * somebody else's user id. The path says so, which is worth more than a comment
 * saying so — an endpoint under `/identities/:id` would look like a place where
 * a user id could be added later.
 *
 * **Neither `list` nor `unlink` re-implements the unlink rule.** `IdentitiesService`
 * calls core's `assertAtLeastOneIdentityRemains`, which decides both refusals; a
 * check here would be a second copy of a rule that the webapp also evaluates,
 * and a second copy is one that can disagree. One rule, one place.
 *
 * **`beginLink` needs `OAuthService`, which lives in `AuthModule` alongside the
 * session machinery it also depends on — so this controller is registered by
 * `AuthModule`, not by `IdentitiesModule`, even though the file stays here.**
 * `AuthModule` already imports `IdentitiesModule` for `AuthService`'s own
 * dependency on `IdentitiesService`; the reverse import `IdentitiesModule` would
 * need to reach `OAuthService` would make the two modules depend on each other,
 * which NestJS can only resolve with `forwardRef` on both sides — real
 * complexity for what both `composition-root.spec.ts` and `guard-wiring.spec.ts`
 * already handle for the direction that exists today. Registering this
 * controller where `OAuthService` already lives avoids the cycle entirely, at
 * the cost of a controller whose registering module is not the one implied by
 * its own package folder. See `identities.module.ts` and `auth.module.ts` for
 * the wiring this leaves behind, and `__tests__/identities.controller.spec.ts`
 * for where the "who wires this" assertion now lives.
 */
@Controller('users/me/identities')
export class IdentitiesController {
  public constructor(
    private readonly identities: IdentitiesService,
    private readonly oauth: OAuthService,
  ) {}

  /** Every identity the actor holds. */
  @Get()
  public async list(
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<IdentityResponseDto[]> {
    const held = await this.identities.listIdentities(actor.userId);
    return held.map((identity) => identity.toJSON());
  }

  /**
   * Gives one of them up.
   *
   * Refusing to remove the last one answers 409, because it is a statement about
   * the state of the account rather than about the request being malformed: the
   * same request would succeed after a second identity was linked. Refusing one
   * the actor does not hold answers 404, and the two are told apart because only
   * the account's owner can reach either.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async unlink(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) id: string,
  ): Promise<void> {
    await this.identities.unlinkIdentity(actor.userId, id as AuthIdentityId);
  }

  /**
   * Begins linking a federated provider to the actor's own account.
   *
   * Carries no `@Public()` — the global `JwtAuthGuard` closes it exactly as it
   * closes `list` and `unlink` above, which is the whole reason this route
   * exists separately from `GET /auth/oauth/:provider`: a top-level browser
   * navigation cannot carry the in-memory access credential this route needs
   * to prove, so linking has to be *started* by an authenticated `fetch` —
   * this call — and only then navigated to by the client, using the URL this
   * answers with. `GET /auth/oauth/:provider` is public for the opposite
   * reason: signing in has no credential yet to carry.
   *
   * Answers JSON, not a redirect, for the same reason: a `fetch` response is
   * read by the caller's own code, not followed by the browser, so there is
   * nowhere for a `302` to send anybody.
   */
  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  public async beginLink(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('provider') provider: string,
  ): Promise<BeginLinkResponseDto> {
    const authorizationUrl = await this.oauth.beginLink(actor.userId, provider);
    return { authorizationUrl };
  }
}
