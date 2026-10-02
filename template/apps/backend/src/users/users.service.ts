import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { can } from '__FORGE_SCOPE__/core/authorization/policies';
import type { Principal } from '__FORGE_SCOPE__/core/authorization/types';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { User } from '__FORGE_SCOPE__/core/users/entities';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { DisplayNameRequiredError, UserNotFoundError } from '__FORGE_SCOPE__/core/users/errors';
import type { UpdateUserProfileInput, UserId, UserQuery } from '__FORGE_SCOPE__/core/users/types';
import type { IUserService } from '__FORGE_SCOPE__/core/users/contracts';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session/session.service';
import { toUserEntity } from './to-user';
import { UserRecord } from './user-record.entity';

/**
 * {@link IUserService} over the `users` table.
 *
 * Every entitlement question in this class is one call to core's `can`
 * (ADR-0006) and nothing local. That matters more here than anywhere else in
 * this backend, because this is where the rules an administrator cares about
 * live and where a second, slightly different copy of them would be invisible:
 * a role check written inline reads exactly like a role check written correctly.
 *
 * The checks are made **here** and not only in `PlatformAdminGuard`, and the
 * duplication is the design. A service is reachable from a scheduled job or a
 * console command, neither of which passes through a guard, and the day
 * somebody adds such a caller the rule must already be on this side of the
 * boundary. The two refusals are shaped differently on purpose — see the guard.
 */
@Injectable()
export class UsersService implements IUserService {
  public constructor(
    @InjectRepository(UserRecord)
    private readonly users: Repository<UserRecord>,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The profile of `targetId`: one's own always, anybody's as an administrator.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param targetId - the user whose profile is wanted
   * @returns the target's profile
   * @throws UserNotFoundError when no such user exists **and** when the actor is
   *   not entitled to it. The two are one answer on purpose: a distinguishable
   *   refusal turns this into a way to test any id for existence, which is the
   *   same oracle the sign-in endpoints are arranged to avoid, reached from the
   *   other side.
   */
  public async getProfile(actorId: UserId, targetId: UserId): Promise<User> {
    const principal = await this.principalOf(actorId);
    if (!can(principal, 'user:read', { ownerId: targetId })) throw new UserNotFoundError(targetId);
    return toUserEntity(await this.require(targetId));
  }

  /**
   * Updates the actor's own profile. There is no path to another user's —
   * `targetId` is not a parameter, so there is nothing to get wrong.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param input - the fields to change; an omitted field is left alone
   * @returns the updated user
   * @throws DisplayNameRequiredError when the new display name is blank
   */
  public async updateProfile(actorId: UserId, input: UpdateUserProfileInput): Promise<User> {
    // Read before anything is written, so an actor whose account has gone is a
    // `UserNotFoundError` rather than an update that matches no row and reports
    // success.
    await this.require(actorId);
    const now = new Date();

    if (input.displayName !== undefined) {
      // Judged before anything is written. The entity refuses a blank name too,
      // but it would refuse it after the row had already been updated, and the
      // account would be left holding a name its own domain rejects.
      if (input.displayName.trim() === '') throw new DisplayNameRequiredError();
      await this.users.update(
        { id: actorId },
        { displayName: input.displayName.trim(), updatedAt: now },
      );
    }

    // The fields that changed, never their values: a display name is ordinary,
    // but an entry that recorded values would be the wrong shape to add the next
    // field to, and this table is one nothing may correct afterwards.
    const changed = Object.keys(input).filter(
      (field) => input[field as keyof UpdateUserProfileInput] !== undefined,
    );
    await this.record(AuditAction.PROFILE_UPDATED, actorId, actorId, { fields: changed }, now);

    return toUserEntity(await this.require(actorId));
  }

  /**
   * Soft-deletes the actor's own account and ends every session it holds.
   *
   * The row stays, and so do the account's audit entries. An entry naming an
   * actor whose row had been removed would be an entry nobody can resolve, in a
   * table nothing is permitted to rewrite — the history would degrade quietly
   * every time somebody left.
   *
   * Ending the sessions is not optional. A soft delete that left them alive
   * would leave every credential already issued working until it lapsed, and the
   * renewal credential lasts as long as the session does.
   *
   * @param actorId - the user on whose behalf the call is made
   */
  public async deleteAccount(actorId: UserId): Promise<void> {
    const now = new Date();
    await this.require(actorId);
    await this.users.update({ id: actorId }, { deletedAt: now, updatedAt: now });
    await this.sessions.revokeAll(actorId);
    await this.record(AuditAction.ACCOUNT_DELETED, actorId, actorId, {}, now);
  }

  /**
   * One page of accounts. Platform administrators only.
   *
   * Deleted accounts are **included**. An administrator looking for somebody who
   * left is exactly the person who needs to see them, and a list that silently
   * omitted them would answer "no such account" for a record that is right
   * there.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param query - which page is wanted, and an optional filter
   * @returns one page of accounts, with the totals a caller needs
   * @throws ForbiddenException when the actor may not operate the deployment
   */
  public async listUsers(actorId: UserId, query: UserQuery): Promise<PaginatedResult<User>> {
    await this.requireAdministrator(actorId);

    const page = Math.max(1, Math.trunc(query.page));
    const limit = Math.max(1, Math.trunc(query.limit));

    // `UserQuery.search`'s semantics are deliberately unpinned by the conformance
    // suite, so this is this implementation's reading and not a contract:
    // case-insensitive, over the two fields an administrator has to hand. Two
    // `where` objects rather than one, because TypeORM reads an array as a
    // disjunction and an object as a conjunction.
    const search = query.search?.trim();
    const narrowed = search === undefined || search === '';
    const where: FindOptionsWhere<UserRecord>[] | undefined = narrowed
      ? undefined
      : [{ email: ILike(`%${search}%`) }, { displayName: ILike(`%${search}%`) }];

    const [rows, total] = await this.users.findAndCount({
      ...(where === undefined ? {} : { where }),
      // A total order. `created_at` alone is not one — two accounts created in
      // the same millisecond would return a different page 2 every time.
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: rows.map((row) => toUserEntity(row)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Suspends or reinstates an account. Platform administrators only.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param targetId - the account to suspend or reinstate
   * @param status - the standing the account is to have
   * @returns the updated user
   * @throws UserNotFoundError when no such user exists
   * @throws ForbiddenException when the actor may not operate the deployment
   * @throws BadRequestException when an administrator suspends themselves —
   *   which would end every session they hold and leave them unable to sign back
   *   in and undo it. It is not that it would be wrong; it is that it is not
   *   undoable by the person doing it.
   */
  public async setStatus(actorId: UserId, targetId: UserId, status: UserStatus): Promise<User> {
    await this.requireAdministrator(actorId);
    const row = await this.require(targetId);

    if (actorId === targetId && status === UserStatus.SUSPENDED) {
      throw new BadRequestException({ messageKey: 'errors.users.cannot_suspend_self' });
    }

    const now = new Date();
    await this.users.update({ id: targetId }, { status, updatedAt: now });
    // Suspending ends the sessions. Leaving them alive means a suspended account
    // keeps working until every credential it holds lapses, which is the whole of
    // what suspension is for.
    if (status === UserStatus.SUSPENDED) await this.sessions.revokeAll(targetId);
    const change = { from: row.status, to: status };
    await this.record(AuditAction.USER_STATUS_CHANGED, actorId, targetId, change, now);

    return toUserEntity(await this.require(targetId));
  }

  /**
   * Grants or withdraws platform administration. Platform administrators only.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param targetId - the account whose standing changes
   * @param role - the standing the account is to have
   * @returns the updated user
   * @throws UserNotFoundError when no such user exists
   * @throws ForbiddenException when the actor may not operate the deployment
   * @throws BadRequestException when an administrator withdraws their own
   *   standing — the last one to do so orphans the deployment, with nobody able
   *   to grant it back to anybody, and the account that could have fixed it is
   *   the one that just gave the power up.
   */
  public async setPlatformRole(
    actorId: UserId,
    targetId: UserId,
    role: PlatformRole,
  ): Promise<User> {
    await this.requireAdministrator(actorId);
    const row = await this.require(targetId);

    // Checked on identity rather than on "would this leave none": counting the
    // remaining administrators is a check that passes while a second one exists
    // and fails only in the moment it matters, which is a rule nobody ever sees
    // work. This one refuses the same way whether there are two administrators
    // or twenty — somebody else withdraws it, which is also a second person
    // knowing it happened.
    if (actorId === targetId && role !== PlatformRole.PLATFORM_ADMIN) {
      throw new BadRequestException({ messageKey: 'errors.users.cannot_demote_self' });
    }

    const now = new Date();
    await this.users.update({ id: targetId }, { platformRole: role, updatedAt: now });
    await this.record(
      AuditAction.PLATFORM_ROLE_CHANGED,
      actorId,
      targetId,
      { from: row.platformRole, to: role },
      now,
    );

    return toUserEntity(await this.require(targetId));
  }

  // -------------------------------------------------------------------- private

  /** The row behind an id, or the domain's own refusal. */
  private async require(userId: UserId): Promise<UserRecord> {
    const row = await this.users.findOne({ where: { id: userId } });
    if (row === null) throw new UserNotFoundError(userId);
    return row;
  }

  /**
   * The actor as core's `can` wants them, read from the row.
   *
   * No memberships and no grants. Every question this service asks is about a
   * person or about the deployment — never about a record inside an
   * organization — and every one of them is asked without a `resource`, so
   * layers two and three are unreachable rather than merely unused. Hydrating
   * either would be a second query for an answer that cannot depend on it.
   * `PermissionsGuard` is what builds a full principal for the callers
   * that do ask organization-scoped questions, and it is the one place the
   * expiry rule that `Principal.grants` promises is applied.
   */
  private async principalOf(actorId: UserId): Promise<Principal> {
    const row = await this.require(actorId);
    return {
      userId: row.id as UserId,
      platformRole: row.platformRole,
      memberships: [],
      grants: [],
    };
  }

  /**
   * Refuses anybody who may not operate the deployment.
   *
   * `ForbiddenException` rather than the guard's 404, for the reason
   * `AuditService.query` states: this is the answer a caller that has already
   * been identified gets, and it is what makes a missing guard visible.
   */
  private async requireAdministrator(actorId: UserId): Promise<void> {
    // The row is read directly rather than through `require`, because an actor
    // whose account has gone is a refusal and not a `UserNotFoundError` about
    // somebody else's id — which is what the caller would otherwise report.
    const row = await this.users.findOne({ where: { id: actorId } });
    if (row === null) throw new ForbiddenException();
    // No memberships and no grants: `platform:administer` is layer one's alone.
    // No organization role carries it, layer three excludes it by name, and this
    // call names no resource anyway — so there is nothing for either list to be
    // read by.
    const principal = {
      userId: row.id as UserId,
      platformRole: row.platformRole,
      memberships: [],
      grants: [],
    };
    if (!can(principal, 'platform:administer')) {
      throw new ForbiddenException();
    }
  }

  /** One audit write. These are platform-level acts, so they belong to no organization. */
  private record(
    action: AuditAction,
    actorId: UserId,
    resourceId: UserId,
    metadata: Record<string, unknown>,
    occurredAt: Date,
  ): Promise<void> {
    return this.audit.record({
      organizationId: null,
      actorId,
      action,
      resourceType: 'user',
      resourceId,
      metadata,
      clientAddress: null,
      clientLabel: null,
      occurredAt,
    });
  }
}
