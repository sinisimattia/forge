import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AuditEntry } from '__FORGE_SCOPE__/core/audit/entities';
import type { AuditEntryId } from '__FORGE_SCOPE__/core/audit/types';
import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import type { ClientContext, SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditService } from '../../audit/audit.service';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { AuthService } from '../../auth/auth.service';
import { EmailVerificationTokenRecord } from '../../auth/entities/email-verification-token-record.entity';
import { PasswordResetTokenRecord } from '../../auth/entities/password-reset-token-record.entity';
import { RefreshTokenRecord } from '../../auth/entities/refresh-token-record.entity';
import { SessionRecord } from '../../auth/entities/session-record.entity';
import { SessionService } from '../../auth/session/session.service';
import { AuthIdentityRecord } from '../../identities/auth-identity-record.entity';
import { NoOpBreachedPasswordRegistry } from '../../identities/breached-passwords';
import { Argon2PasswordHasher } from '../../identities/hashing';
import { IdentitiesService } from '../../identities/identities.service';
import type { IMailer, OutboundMessage } from '../../mail';
import { UsersService } from '../../users/users.service';
import { UserRecord } from '../../users/user-record.entity';
import { FakeDataSource } from './fake-data-source';

/**
 * The whole identity backend, wired to one {@link FakeDataSource}, for the
 * conformance drivers to point core's suites at.
 *
 * ## What is real here and what is not
 *
 * **Every service is the real one.** `AuthService`, `UsersService`,
 * `IdentitiesService`, `SessionService` and `AuditService` are constructed
 * exactly as `AppModule` constructs them, including the real
 * `Argon2PasswordHasher` — a conformance run that swapped in a cheap hasher
 * would be proving things about a deployment nobody ships.
 *
 * What is **not** the real thing, in full rather than in summary: the store is
 * {@link FakeDataSource}; the mailer is an array; the breached-password registry
 * is the shipped no-op, which is what a generated project actually runs
 * (ADR-0008); and `ConfigService` and `JwtService` are the real classes handed
 * this harness's own values rather than a deployment's. The last two were
 * missing from an earlier version of this list, which said "only the three
 * things a unit test cannot have" and named three — a count that was wrong the
 * moment it was written, in a paragraph whose whole job is to be exhaustive.
 * There is no count here now, deliberately.
 *
 * That is the point of Task 13. Until it, core's suites had only ever been
 * satisfied by reference implementations written in the same file that asserts
 * them, which proves that the assertions are self-consistent and nothing about
 * whether they describe anything.
 *
 * ## What the store cannot express
 *
 * `FakeDataSource` carries a numbered inventory, on the class itself, of the
 * properties it cannot model. **Read that list rather than any summary of it**,
 * here or anywhere else.
 *
 * This paragraph deliberately does not reproduce it, or count it. An earlier
 * version opened "an inventory of nine properties" and then listed the nine
 * keywords — which is the staleness it was warning about, in the sentence doing
 * the warning: add a tenth item to the class and the sentence here is wrong,
 * silently, and the reader who trusts it is worse off than one who had no
 * summary at all. A pointer cannot go stale; a count and a copy both can.
 *
 * Two of them bear on what the conformance suites can and cannot establish here,
 * and are named at the drivers that depend on them rather than only in the
 * abstract:
 *
 * - **Audit immutability (item 3), the most load-bearing.** This store will
 *   happily `UPDATE` and `DELETE` an `audit_entries` row. The guarantee is a
 *   revoked privilege in `1758000002000-AuditAppendOnly`, and *nothing* driven
 *   from here can fail for want of it. Task 19 proves it against a live
 *   database; see `audit.conformance.spec.ts`.
 * - **Unique constraints (item 4).** There are none, so the losing half of a
 *   registration race — `AuthService.register`'s `23505` branch — is not reached
 *   by any conformance test.
 *
 * What this store *does* do, and what a hand-rolled in-memory repository would
 * not, is roll back: `transaction` journals every write and undoes it in reverse
 * on a throw, declining to overwrite a key a later transaction has since set. So
 * the atomicity `AuthService.changePasswordAndReissue` and `verifyEmail` rest on
 * is expressible here, if not the isolation underneath it.
 */
export interface IdentityWorld {
  /** The store every service below was built over. Seed and read it directly. */
  source: FakeDataSource;

  auth: AuthService;
  users: UsersService;
  identities: IdentitiesService;
  sessions: SessionService;
  audit: AuditService;

  /** Every message the mailer was handed, oldest first. */
  sent: OutboundMessage[];

  /**
   * Registers an account and proves its address, leaving one that can sign in.
   *
   * It drives the real `AuthService.register` and the real
   * `AuthService.verifyEmail`, rather than writing rows — so the world a suite
   * is handed was built through the code paths the application uses, and a
   * defect in either shows up as a world that cannot be built rather than as a
   * suite that silently tests a shape nothing produces.
   *
   * @param email - the address as a person would have typed it
   * @param displayName - the name to show
   * @param secret - the password to seed
   * @returns the new account's id
   */
  registerAndVerify(email: string, displayName: string, secret: string): Promise<UserId>;

  /**
   * Registers an account and leaves its address unproven.
   *
   * @param email - the address as a person would have typed it
   * @param displayName - the name to show
   * @param secret - the password to seed
   * @returns the new account's id and the verification credential that was mailed
   */
  registerOnly(
    email: string,
    displayName: string,
    secret: string,
  ): Promise<{ userId: UserId; verification: string }>;

  /** Pulls the single-use value out of whatever link was last mailed. */
  credentialFromLastLink(): string;

  /**
   * One stored user, as a domain entity, read straight from the store.
   *
   * Built here rather than through `UsersService`, because these entities are
   * the **right-hand side** of the suites' comparisons: a promised world read
   * back through the implementation under test would let that implementation
   * agree with itself, which is the tautology every one of core's suites is
   * written to avoid.
   *
   * @param userId - the account to read
   * @returns the same account as an entity
   */
  userEntity(userId: UserId): User;

  /** One stored session, as a domain entity. See {@link IdentityWorld.userEntity}. */
  sessionEntity(sessionId: SessionId): Session;

  /** One stored identity, as a domain entity. See {@link IdentityWorld.userEntity}. */
  identityEntity(identityId: AuthIdentityId): AuthIdentity;

  /** One stored audit entry, as a domain entity. See {@link IdentityWorld.userEntity}. */
  auditEntity(entryId: AuditEntryId): AuditEntry;

  /**
   * Writes columns onto a user row directly.
   *
   * The states the security suite needs — blocked, soft-deleted, an
   * administrator — are ones no caller of `IAuthService` can produce, which is
   * precisely why that suite is driven by an implementation that owns its store
   * (DEC-1). This is that ownership, used deliberately and in one named place
   * rather than by each driver reaching into the tables.
   *
   * @param userId - the account to change
   * @param patch - the columns to write
   */
  patchUser(userId: UserId, patch: Record<string, unknown>): void;
}

/** This harness's signing key. Not a credential: it signs nothing outside these specs. */
const SIGNING_KEY = 'conformance-harness-signing-key';

/** Where the harness pretends the webapp lives. */
const WEBAPP_URL = 'https://app.example.test';

/** What a sign-in the harness performs says about its client. */
export const HARNESS_CLIENT: ClientContext = { address: '203.0.113.9', label: 'conformance' };

/**
 * A fresh world: one empty store, and the whole identity backend over it.
 *
 * @returns the services, the store, and the helpers a driver needs to seed it
 */
export function makeIdentityWorld(): IdentityWorld {
  const source = new FakeDataSource();
  const sent: OutboundMessage[] = [];

  const mailer: IMailer = {
    send: async (message) => {
      sent.push(message);
    },
  };

  // The store holds plain rows, so it is handed over as the repository type each
  // service asks for. The cast is confined to this helper rather than repeated
  // at each of the call sites below.
  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  const audit = new AuditService(
    repo<AuditEntryRecord>(AuditEntryRecord),
    repo<UserRecord>(UserRecord),
  );

  const identities = new IdentitiesService(
    repo<AuthIdentityRecord>(AuthIdentityRecord),
    new Argon2PasswordHasher(),
    audit,
  );

  const sessions = new SessionService(
    repo<SessionRecord>(SessionRecord),
    repo<RefreshTokenRecord>(RefreshTokenRecord),
    new JwtService({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
    source as unknown as DataSource,
  );

  const auth = new AuthService(
    repo<UserRecord>(UserRecord),
    repo<EmailVerificationTokenRecord>(EmailVerificationTokenRecord),
    repo<PasswordResetTokenRecord>(PasswordResetTokenRecord),
    identities,
    sessions,
    audit,
    source as unknown as DataSource,
    mailer,
    new NoOpBreachedPasswordRegistry(),
    new ConfigService({ PUBLIC_WEBAPP_URL: WEBAPP_URL }),
  );

  const users = new UsersService(repo<UserRecord>(UserRecord), sessions, audit);

  const credentialFromLastLink = (): string => {
    const last = sent[sent.length - 1];
    if (last === undefined) throw new Error('nothing has been mailed');
    const match = /token=([A-Za-z0-9_-]+)/.exec(last.body);
    if (match === null) throw new Error(`no credential in the last message: ${last.body}`);
    return match[1];
  };

  const rowOf = (entity: { name: string }, id: unknown): Record<string, unknown> => {
    const row = source.byId(entity, id);
    // Loudly. A driver that named a row the store does not hold would otherwise
    // hand a suite an entity built from `undefined`, and the suite would report
    // whatever the entity's constructor made of that instead of the missing row.
    if (row === undefined) throw new Error(`${entity.name} ${String(id)} is not in the store`);
    return row;
  };

  const registerOnly = async (
    email: string,
    displayName: string,
    secret: string,
  ): Promise<{ userId: UserId; verification: string }> => {
    await auth.register({ email, displayName, secret });
    const verification = credentialFromLastLink();
    const identity = await identities.findPasswordIdentity(email);
    if (identity === null) throw new Error(`register left no password identity for ${email}`);
    return { userId: identity.userId as UserId, verification };
  };

  return {
    source,
    auth,
    users,
    identities,
    sessions,
    audit,
    sent,
    credentialFromLastLink,
    registerOnly,

    registerAndVerify: async (email, displayName, secret) => {
      const { userId, verification } = await registerOnly(email, displayName, secret);
      await auth.verifyEmail(verification);
      return userId;
    },

    userEntity: (userId) => {
      const row = rowOf(UserRecord, userId);
      return new User({
        id: row.id as UserId,
        email: row.email as string,
        displayName: row.displayName as string,
        status: row.status as User['status'],
        platformRole: row.platformRole as User['platformRole'],
        emailVerifiedAt: row.emailVerifiedAt as Date | null,
        createdAt: row.createdAt as Date,
        updatedAt: row.updatedAt as Date,
        deletedAt: row.deletedAt as Date | null,
      });
    },

    sessionEntity: (sessionId) => {
      const row = rowOf(SessionRecord, sessionId);
      return new Session({
        id: row.id as SessionId,
        userId: row.userId as UserId,
        createdAt: row.createdAt as Date,
        lastUsedAt: row.lastUsedAt as Date,
        expiresAt: row.expiresAt as Date,
        revokedAt: row.revokedAt as Date | null,
        clientAddress: row.clientAddress as string | null,
        clientLabel: row.clientLabel as string | null,
      });
    },

    identityEntity: (identityId) => {
      const row = rowOf(AuthIdentityRecord, identityId);
      return new AuthIdentity({
        id: row.id as AuthIdentityId,
        userId: row.userId as UserId,
        provider: row.provider as AuthIdentity['provider'],
        providerAccountId: row.providerAccountId as string,
        createdAt: row.createdAt as Date,
        lastUsedAt: row.lastUsedAt as Date | null,
      });
    },

    auditEntity: (entryId) => {
      const row = rowOf(AuditEntryRecord, entryId);
      return new AuditEntry({
        id: row.id as AuditEntryId,
        organizationId: row.organizationId as OrganizationId | null,
        actorId: row.actorUserId as UserId | null,
        action: row.action as AuditEntry['action'],
        resourceType: row.resourceType as string | null,
        resourceId: row.resourceId as string | null,
        metadata: row.metadata as Record<string, unknown>,
        clientAddress: row.clientAddress as string | null,
        clientLabel: row.clientLabel as string | null,
        occurredAt: row.occurredAt as Date,
      });
    },

    patchUser: (userId, patch) => {
      const changed = source.update(UserRecord, { id: userId }, patch);
      if (changed !== 1) throw new Error(`patchUser matched ${changed} rows for ${userId}`);
    },
  };
}
