import { Controller, Delete, Get, HttpCode, HttpStatus, Param } from '@nestjs/common';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import { CurrentUser } from '../auth/decorators';
import type { AuthenticatedActor } from '../auth/strategies';
import { ParseUuidParamPipe } from '../common/pipes';
import type { IdentityResponseDto } from './dto';
import { IdentitiesService } from './identities.service';

/**
 * The ways the actor can prove who they are, and how one of them is given up.
 *
 * Mounted under `/users/me/` because that is what these are: part of the actor's
 * own account, reachable only for the actor, with no route anywhere that takes
 * somebody else's user id. The path says so, which is worth more than a comment
 * saying so — an endpoint under `/identities/:id` would look like a place where
 * a user id could be added later.
 *
 * **Neither method re-implements the unlink rule.** `IdentitiesService` calls
 * core's `assertAtLeastOneIdentityRemains`, which decides both refusals; a check
 * here would be a second copy of a rule that the webapp also evaluates, and a
 * second copy is one that can disagree. One rule, one place.
 */
@Controller('users/me/identities')
export class IdentitiesController {
  public constructor(private readonly identities: IdentitiesService) {}

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
}
