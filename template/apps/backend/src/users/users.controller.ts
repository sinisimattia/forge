import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { PaginatedResponse } from '../common/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { CurrentUser } from '../auth/decorators';
import { PlatformAdminGuard } from '../auth/guards';
import { REFRESH_COOKIE } from '../auth/refresh-cookie';
import type { AuthenticatedActor } from '../auth/strategies';
import { ParseUuidParamPipe } from '../common/pipes';
import {
  ListUsersQueryDto,
  SetPlatformRoleDto,
  SetStatusDto,
  UpdateProfileDto,
  type UserResponseDto,
} from './dto';
import { UsersService } from './users.service';

/**
 * A person's own account, and — behind {@link PlatformAdminGuard} — everybody
 * else's.
 *
 * Nothing here is `@Public()`. The global guard closes every route by default
 * and these are all routes about a particular person, so there is nothing to
 * open.
 *
 * ## Route order is load-bearing
 *
 * `me` is declared before `:id` in this class, and the framework matches in
 * declaration order. The other way round, `GET /users/:id` matches `/users/me`
 * first, `me` is parsed as an identifier, the UUID pipe refuses it and the
 * endpoint every signed-in caller uses answers 400 — while every test that asks
 * for a real id passes.
 */
@Controller('users')
export class UsersController {
  public constructor(private readonly users: UsersService) {}

  /** The actor's own profile. */
  @Get('me')
  public async me(@CurrentUser() actor: AuthenticatedActor): Promise<UserResponseDto> {
    const user = await this.users.getProfile(actor.userId, actor.userId);
    return user.toJSON();
  }

  /** Changes the actor's own profile. There is no path to another person's. */
  @Patch('me')
  public async updateMe(
    @CurrentUser() actor: AuthenticatedActor,
    @Body() body: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    const updated = await this.users.updateProfile(actor.userId, {
      // Field by field rather than passing the body: `UpdateUserProfileInput` is
      // core's shape and this DTO is the wire's, and the day they differ the
      // compiler must say so here rather than a field crossing that nothing on
      // the domain side declared.
      ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
    });
    return updated.toJSON();
  }

  /**
   * Closes the actor's own account.
   *
   * The renewal cookie is cleared as well as the sessions being ended, for the
   * reason `AuthController.logout` gives: clearing alone is theatre, and ending
   * the sessions alone leaves the browser presenting a dead credential on every
   * renewal for as long as the cookie lives.
   */
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async deleteMe(
    @CurrentUser() actor: AuthenticatedActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.users.deleteAccount(actor.userId);
    REFRESH_COOKIE.clear(response);
  }

  /**
   * One page of accounts. Platform administrators only.
   *
   * The guard answers everybody else 404 — see its own comment for the trade
   * that is.
   */
  @Get()
  @UseGuards(PlatformAdminGuard)
  public async list(
    @CurrentUser() actor: AuthenticatedActor,
    @Query() query: ListUsersQueryDto,
  ): Promise<PaginatedResponse<UserResponseDto>> {
    const page = await this.users.listUsers(actor.userId, {
      page: query.page,
      limit: query.limit,
      ...(query.search === undefined ? {} : { search: query.search }),
    });
    return { data: page.data.map((user) => user.toJSON()), meta: page.meta };
  }

  /** One account. Platform administrators only. */
  @Get(':id')
  @UseGuards(PlatformAdminGuard)
  public async byId(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) id: string,
  ): Promise<UserResponseDto> {
    const user = await this.users.getProfile(actor.userId, id as UserId);
    return user.toJSON();
  }

  /** Grants or withdraws platform administration. Platform administrators only. */
  @Patch(':id/platform-role')
  @UseGuards(PlatformAdminGuard)
  public async setPlatformRole(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) id: string,
    @Body() body: SetPlatformRoleDto,
  ): Promise<UserResponseDto> {
    const updated = await this.users.setPlatformRole(
      actor.userId,
      id as UserId,
      body.platformRole,
    );
    return updated.toJSON();
  }

  /** Suspends or reinstates an account. Platform administrators only. */
  @Patch(':id/status')
  @UseGuards(PlatformAdminGuard)
  public async setStatus(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) id: string,
    @Body() body: SetStatusDto,
  ): Promise<UserResponseDto> {
    const updated = await this.users.setStatus(actor.userId, id as UserId, body.status);
    return updated.toJSON();
  }
}
