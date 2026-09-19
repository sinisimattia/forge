import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { RecordAuditEntryInput } from '__FORGE_SCOPE__/core/audit/types';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { DisplayNameRequiredError, UserNotFoundError } from '__FORGE_SCOPE__/core/users/errors';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { AuditService } from '../../audit/audit.service';
import { FakeDataSource } from '../../auth/__tests__/fake-data-source';
import { RefreshTokenRecord } from '../../auth/entities/refresh-token-record.entity';
import { SessionRecord } from '../../auth/entities/session-record.entity';
import { SessionService } from '../../auth/session/session.service';
import { UserRecord } from '../user-record.entity';
import { UsersService } from '../users.service';

/**
 * Reading and administering people.
 *
 * Two kinds of assertion live here and they are worth telling apart. The
 * ordinary ones pin what each method does. The ones that matter pin what it
 * refuses, and every one of those is written so that an implementation which
 * simply dropped the check fails it — a refusal nobody has watched happen is not
 * a refusal.
 *
 * Entitlement is core's `can` in every case, never a role comparison written
 * here, so these tests are also the backend half of ADR-0006: they prove this
 * service asks the shared function rather than restating its answer.
 */

const SIGNING_KEY = 'users-service-spec-signing-key';

const ADA = 'user-ada';
const GRACE = 'user-grace';
const ROOT = 'user-root';
const ABSENT = '99999999-9999-4999-8999-999999999999' as UserId;

const EPOCH = new Date('2026-09-18T10:00:00.000Z');

/** One stored row, in the shape the table holds it. */
const row = (
  id: string,
  email: string,
  platformRole: PlatformRole,
  createdAt: Date,
): Record<string, unknown> => ({
  id,
  email,
  displayName: `Name of ${id}`,
  status: UserStatus.ACTIVE,
  platformRole,
  emailVerifiedAt: EPOCH,
  createdAt,
  updatedAt: EPOCH,
  deletedAt: null,
});

describe('UsersService', () => {
  let source: FakeDataSource;
  let users: UsersService;
  let sessions: SessionService;
  let recorded: RecordAuditEntryInput[];

  beforeEach(() => {
    source = new FakeDataSource();
    recorded = [];

    const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
      source.getRepository(entity) as unknown as Repository<T>;

    const audit = {
      record: async (input: RecordAuditEntryInput) => {
        recorded.push(input);
      },
    } as unknown as AuditService;

    // The real session service over the in-memory store, not a spy. Ending
    // sessions is a consequence these tests assert by reading the rows back;
    // a spy would only prove a method was called, which is the assertion that
    // survives an implementation calling it on the wrong account.
    sessions = new SessionService(
      repo<SessionRecord>(SessionRecord),
      repo<RefreshTokenRecord>(RefreshTokenRecord),
      new JwtService({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      source as unknown as DataSource,
    );

    users = new UsersService(repo<UserRecord>(UserRecord), sessions, audit);

    source.seed(UserRecord, [
      row(ADA, 'ada@example.test', PlatformRole.PLATFORM_USER, new Date('2026-09-01T00:00:00Z')),
      row(GRACE, 'grace@example.test', PlatformRole.PLATFORM_USER, new Date('2026-09-02T00:00:00Z')),
      row(ROOT, 'root@example.test', PlatformRole.PLATFORM_ADMIN, new Date('2026-09-03T00:00:00Z')),
    ]);
  });

  /** Opens a session for somebody, so a revocation has something to revoke. */
  const signIn = async (userId: string): Promise<void> => {
    await sessions.begin(userId as UserId, { address: null, label: null });
  };

  /** Every session row for somebody that is still usable. */
  const liveSessions = (userId: string): unknown[] =>
    source
      .all(SessionRecord)
      .filter((session) => session.userId === userId && session.revokedAt === null);

  describe('getProfile', () => {
    it('returns the actor\'s own profile, as a real entity', async () => {
      const profile = await users.getProfile(ADA as UserId, ADA as UserId);

      // A real entity, not the row: every invariant runs on every read, and a
      // service that handed back its stored row would fail this line.
      expect(profile).toBeInstanceOf(User);
      expect(profile.id).toBe(ADA);
    });

    it('lets a platform administrator read anybody\'s', async () => {
      const profile = await users.getProfile(ROOT as UserId, ADA as UserId);
      expect(profile.id).toBe(ADA);
    });

    it('refuses one person reading another\'s', async () => {
      await expect(users.getProfile(ADA as UserId, GRACE as UserId)).rejects.toBeInstanceOf(
        UserNotFoundError,
      );
    });

    it('answers an id nobody has exactly as it answers one it may not see', async () => {
      // The whole of the refusal: if these two differed, asking for ids one at a
      // time would sort them into "real" and "not", which is an enumeration
      // oracle over every account on the deployment.
      const forbidden = await users.getProfile(ADA as UserId, GRACE as UserId).catch((e) => e);
      const absent = await users.getProfile(ADA as UserId, ABSENT).catch((e) => e);

      expect(forbidden.constructor).toBe(absent.constructor);
    });

    it('still returns an account after it has been deleted', async () => {
      await users.deleteAccount(ADA as UserId);

      const after = await users.getProfile(ROOT as UserId, ADA as UserId);

      // A deleted account is retained so that the history naming it stays
      // readable. A read that filtered it out would answer "no such account"
      // for a record that is right there, to the one person who needs it.
      expect(after.isDeleted).toBe(true);
      expect(after.canAuthenticate()).toBe(false);
    });
  });

  describe('updateProfile', () => {
    it('changes the display name and returns the updated user', async () => {
      const updated = await users.updateProfile(ADA as UserId, { displayName: '  Ada Lovelace  ' });

      expect(updated.displayName).toBe('Ada Lovelace');
      expect((await users.getProfile(ADA as UserId, ADA as UserId)).displayName)
        .toBe('Ada Lovelace');
    });

    it('refuses a blank display name, and changes nothing', async () => {
      await expect(
        users.updateProfile(ADA as UserId, { displayName: '   ' }),
      ).rejects.toBeInstanceOf(DisplayNameRequiredError);

      expect(source.byId(UserRecord, ADA)?.displayName).toBe(`Name of ${ADA}`);
    });

    it('leaves the address alone — a profile update is not an address change', async () => {
      const updated = await users.updateProfile(ADA as UserId, { displayName: 'Renamed' });
      expect(updated.email).toBe('ada@example.test');
    });

    it('records which fields changed, and never their values', async () => {
      await users.updateProfile(ADA as UserId, { displayName: 'Ada Lovelace' });

      const entry = recorded.find((written) => written.action === AuditAction.PROFILE_UPDATED);
      expect(entry).toBeDefined();
      expect(entry!.metadata).toEqual({ fields: ['displayName'] });
      expect(JSON.stringify(entry)).not.toContain('Ada Lovelace');
    });
  });

  describe('deleteAccount', () => {
    it('marks the account deleted rather than removing the record', async () => {
      await users.deleteAccount(ADA as UserId);

      expect(source.byId(UserRecord, ADA)).toBeDefined();
      expect(source.byId(UserRecord, ADA)?.deletedAt).not.toBeNull();
    });

    it('ends every session the account held', async () => {
      await signIn(ADA);
      await signIn(ADA);
      expect(liveSessions(ADA)).toHaveLength(2);

      await users.deleteAccount(ADA as UserId);

      // Without this a closed account keeps working for as long as its
      // credentials last, and the renewal credential lasts as long as the
      // session does.
      expect(liveSessions(ADA)).toHaveLength(0);
    });

    it('leaves other people signed in', async () => {
      await signIn(ADA);
      await signIn(GRACE);

      await users.deleteAccount(ADA as UserId);

      expect(liveSessions(GRACE)).toHaveLength(1);
    });

    it('records the deletion', async () => {
      await users.deleteAccount(ADA as UserId);
      expect(recorded.map((entry) => entry.action)).toContain(AuditAction.ACCOUNT_DELETED);
    });
  });

  describe('listUsers', () => {
    it('refuses somebody who may not operate the deployment', async () => {
      await expect(
        users.listUsers(ADA as UserId, { page: 1, limit: 20 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('counts every account in meta.total, not the page', async () => {
      const page = await users.listUsers(ROOT as UserId, { page: 1, limit: 2 });

      // The two have to disagree, or an implementation returning the page
      // length as the total passes.
      expect(page.data).toHaveLength(2);
      expect(page.meta.total).toBe(3);
      expect(page.meta.totalPages).toBe(2);
    });

    it('returns a page 2 that repeats nothing from page 1', async () => {
      const first = await users.listUsers(ROOT as UserId, { page: 1, limit: 2 });
      const second = await users.listUsers(ROOT as UserId, { page: 2, limit: 2 });

      expect(second.data).toHaveLength(1);
      const firstIds = first.data.map((user) => String(user.id));
      expect(firstIds).not.toContain(String(second.data[0].id));
    });

    it('narrows by the search filter rather than ignoring it', async () => {
      const page = await users.listUsers(ROOT as UserId, { page: 1, limit: 20, search: 'GRACE@' });

      // Case-insensitive, and over the address. An implementation that dropped
      // the filter returns three.
      expect(page.data.map((user) => String(user.id))).toEqual([GRACE]);
      expect(page.meta.total).toBe(1);
    });

    it('includes an account that has been deleted', async () => {
      await users.deleteAccount(ADA as UserId);

      const page = await users.listUsers(ROOT as UserId, { page: 1, limit: 20 });

      expect(page.data.map((user) => String(user.id))).toContain(ADA);
    });
  });

  describe('setStatus', () => {
    it('refuses somebody who may not operate the deployment', async () => {
      await expect(
        users.setStatus(ADA as UserId, GRACE as UserId, UserStatus.SUSPENDED),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(source.byId(UserRecord, GRACE)?.status).toBe(UserStatus.ACTIVE);
    });

    it('suspends an account so it can no longer authenticate', async () => {
      const suspended = await users.setStatus(
        ROOT as UserId,
        ADA as UserId,
        UserStatus.SUSPENDED,
      );

      expect(suspended.status).toBe(UserStatus.SUSPENDED);
      expect(suspended.canAuthenticate()).toBe(false);
    });

    it('ends the suspended account\'s sessions', async () => {
      await signIn(ADA);

      await users.setStatus(ROOT as UserId, ADA as UserId, UserStatus.SUSPENDED);

      // Suspension that left the sessions alive would take effect only when
      // every credential already issued had lapsed, which is most of a day.
      expect(liveSessions(ADA)).toHaveLength(0);
    });

    it('reinstates, and does not end sessions when it does', async () => {
      await users.setStatus(ROOT as UserId, ADA as UserId, UserStatus.SUSPENDED);
      await signIn(ADA);

      const reinstated = await users.setStatus(ROOT as UserId, ADA as UserId, UserStatus.ACTIVE);

      expect(reinstated.status).toBe(UserStatus.ACTIVE);
      expect(reinstated.canAuthenticate()).toBe(true);
      expect(liveSessions(ADA)).toHaveLength(1);
    });

    it('refuses an administrator suspending their own account', async () => {
      // They would be signed out by their own action and unable to sign back in
      // to undo it. It is not that it is wrong; it is that it is not undoable by
      // the person doing it.
      await expect(
        users.setStatus(ROOT as UserId, ROOT as UserId, UserStatus.SUSPENDED),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(source.byId(UserRecord, ROOT)?.status).toBe(UserStatus.ACTIVE);
    });

    it('lets an administrator reinstate their own account', async () => {
      // The refusal above is about suspension and not about acting on oneself.
      // Without this, a check written as "never touch your own status" would
      // pass the test above and be wrong.
      const same = await users.setStatus(ROOT as UserId, ROOT as UserId, UserStatus.ACTIVE);
      expect(same.status).toBe(UserStatus.ACTIVE);
    });

    it('rejects an id that does not exist', async () => {
      await expect(
        users.setStatus(ROOT as UserId, ABSENT, UserStatus.SUSPENDED),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });

    it('records the change with both standings', async () => {
      await users.setStatus(ROOT as UserId, ADA as UserId, UserStatus.SUSPENDED);

      const entry = recorded.find((w) => w.action === AuditAction.USER_STATUS_CHANGED);
      expect(entry).toBeDefined();
      // Both sides. "It was suspended" without "from what" cannot be told from a
      // suspension of an account that was already suspended.
      expect(entry!.metadata).toEqual({ from: UserStatus.ACTIVE, to: UserStatus.SUSPENDED });
      expect(entry!.actorId).toBe(ROOT);
      expect(entry!.resourceId).toBe(ADA);
    });
  });

  describe('setPlatformRole', () => {
    it('refuses somebody who may not operate the deployment', async () => {
      await expect(
        users.setPlatformRole(ADA as UserId, ADA as UserId, PlatformRole.PLATFORM_ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(source.byId(UserRecord, ADA)?.platformRole).toBe(PlatformRole.PLATFORM_USER);
    });

    it('grants platform administration, and a later read agrees', async () => {
      const promoted = await users.setPlatformRole(
        ROOT as UserId,
        ADA as UserId,
        PlatformRole.PLATFORM_ADMIN,
      );

      expect(promoted.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);
      expect((await users.getProfile(ROOT as UserId, ADA as UserId)).platformRole)
        .toBe(PlatformRole.PLATFORM_ADMIN);
    });

    it('withdraws it from somebody else', async () => {
      await users.setPlatformRole(ROOT as UserId, ADA as UserId, PlatformRole.PLATFORM_ADMIN);

      const demoted = await users.setPlatformRole(
        ROOT as UserId,
        ADA as UserId,
        PlatformRole.PLATFORM_USER,
      );

      expect(demoted.platformRole).toBe(PlatformRole.PLATFORM_USER);
    });

    it('refuses an administrator withdrawing their OWN standing', async () => {
      // The last one to do it orphans the deployment: nobody can grant it back,
      // and the account that could have fixed it is the one that just gave the
      // power up.
      await expect(
        users.setPlatformRole(ROOT as UserId, ROOT as UserId, PlatformRole.PLATFORM_USER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(source.byId(UserRecord, ROOT)?.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);
    });

    it('refuses it even while a second administrator exists', async () => {
      // The refusal is on identity, not on "would this leave none". A rule that
      // counted would pass every day there are two administrators and fail only
      // on the day it mattered, which is a rule nobody ever sees work.
      await users.setPlatformRole(ROOT as UserId, GRACE as UserId, PlatformRole.PLATFORM_ADMIN);

      await expect(
        users.setPlatformRole(ROOT as UserId, ROOT as UserId, PlatformRole.PLATFORM_USER),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets an administrator re-assert their own standing', async () => {
      // So the refusal above cannot be satisfied by "never act on yourself".
      const same = await users.setPlatformRole(
        ROOT as UserId,
        ROOT as UserId,
        PlatformRole.PLATFORM_ADMIN,
      );
      expect(same.platformRole).toBe(PlatformRole.PLATFORM_ADMIN);
    });

    it('rejects an id that does not exist', async () => {
      await expect(
        users.setPlatformRole(ROOT as UserId, ABSENT, PlatformRole.PLATFORM_ADMIN),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });

    it('records the change with both standings', async () => {
      await users.setPlatformRole(ROOT as UserId, ADA as UserId, PlatformRole.PLATFORM_ADMIN);

      const entry = recorded.find((w) => w.action === AuditAction.PLATFORM_ROLE_CHANGED);
      expect(entry).toBeDefined();
      expect(entry!.metadata).toEqual({
        from: PlatformRole.PLATFORM_USER,
        to: PlatformRole.PLATFORM_ADMIN,
      });
    });
  });

  describe('the wire shape every caller is given', () => {
    it('carries exactly the keys core defines, and nothing of its own', async () => {
      const profile = await users.getProfile(ADA as UserId, ADA as UserId);

      // The right-hand side is written out rather than derived from the value,
      // so a field added to `User` for convenience fails here rather than
      // shipping to a webapp whose reviver will drop it.
      expect(Object.keys(profile.toJSON()).sort().join(',')).toBe(
        'createdAt,deletedAt,displayName,email,emailVerifiedAt,id,platformRole,status,updatedAt',
      );
    });

    it('survives the reviver the webapp parses it with', async () => {
      const profile = await users.getProfile(ADA as UserId, ADA as UserId);
      expect(User.fromJSON(profile.toJSON())).toBeInstanceOf(User);
    });
  });
});
