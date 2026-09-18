import type { IAuthService } from '__FORGE_SCOPE__/core/auth/contracts';
import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import {
  AuthenticationRejectionReason,
  AuthenticationStatus,
} from '__FORGE_SCOPE__/core/auth/enums';
import {
  ConsumedTokenError,
  ExpiredTokenError,
  InvalidCredentialsError,
  SessionNotFoundError,
} from '__FORGE_SCOPE__/core/auth/errors';
import type {
  AuthenticationAttempt,
  AuthenticationOutcome,
  ClientContext,
  RegisterInput,
  SessionId,
  SessionJSON,
} from '__FORGE_SCOPE__/core/auth/types';
import { WeakPasswordError } from '__FORGE_SCOPE__/core/identities/errors';
import {
  DEFAULT_PASSWORD_POLICY,
  evaluatePassword,
} from '__FORGE_SCOPE__/core/identities/policies';
import { normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';

/** Which single-use value a stored grant is. */
export type GrantKind = 'VERIFICATION' | 'RESET';

/** A single-use value the service issued, as its store would hold it. */
export interface StoredGrant {
  /** The value presented back to the service. */
  value: string;
  /** Whose account it acts on. */
  userId: UserId;
  /** What presenting it does. */
  kind: GrantKind;
  /** When it stops being usable, ISO-8601. */
  expiresAt: string;
  /** When it was used, ISO-8601, or `null` if it has not been. */
  consumedAt: string | null;
}

const A_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * A reference implementation over Maps of wire rows.
 *
 * It stores rows rather than entities on purpose: that is the shape a real
 * implementation has to map back into an entity on every read, so both suites are
 * driven through the same rehydration a real one performs — and it is what makes the
 * wire-shape assertion able to fail, since a row seeded in a form the entity would
 * rewrite stays in that form until something rebuilds the entity from it.
 *
 * Writing it is also the cheapest possible proof that the contract is implementable at
 * all, which is the reason it exists rather than a stub that resolves everything.
 */
export class InMemoryAuthService implements IAuthService {
  private readonly users = new Map<string, UserJSON>();
  private readonly phrases = new Map<string, string>();
  private readonly sessions = new Map<string, SessionJSON>();
  private readonly grants = new Map<string, StoredGrant>();
  private issued = 0;

  /** Puts an account into the world with the secret it answers to. */
  seedUser(row: UserJSON, phrase: string): void {
    this.users.set(row.id, row);
    this.phrases.set(row.id, phrase);
  }

  /** Puts a session row into the world exactly as given, without rebuilding it. */
  seedSession(row: SessionJSON): void {
    this.sessions.set(row.id, row);
  }

  /** Puts a single-use value into the world. */
  seedGrant(grant: StoredGrant): void {
    this.grants.set(grant.value, grant);
  }

  async register(input: RegisterInput): Promise<void> {
    // Judged first, and independently of the address: a published rule of the
    // deployment reveals nothing about who holds an account.
    this.enforcePolicy(input.secret);

    const email = normalizeEmail(input.email);
    if (this.findByEmail(email) !== undefined) return;

    const id = this.nextId('user') as UserId;
    const now = new Date().toISOString();
    this.seedUser({
      id,
      email: input.email,
      displayName: input.displayName,
      status: UserStatus.ACTIVE,
      platformRole: PlatformRole.PLATFORM_USER,
      emailVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }, input.secret);
    this.issueGrant(id, 'VERIFICATION');
  }

  async verifyEmail(token: string): Promise<void> {
    const grant = this.spend(token, 'VERIFICATION');
    const row = this.userRow(grant.userId);
    this.users.set(row.id, { ...row, emailVerifiedAt: new Date().toISOString() });
  }

  async resendVerification(email: string): Promise<void> {
    const row = this.findByEmail(normalizeEmail(email));
    if (row !== undefined) this.issueGrant(row.id, 'VERIFICATION');
  }

  async authenticate(attempt: AuthenticationAttempt): Promise<AuthenticationOutcome> {
    const row = this.findByEmail(normalizeEmail(attempt.email));
    if (row === undefined) {
      return {
        status: AuthenticationStatus.REJECTED,
        reason: AuthenticationRejectionReason.UNKNOWN_ACCOUNT,
      };
    }
    // The secret is checked before the account's state, so that somebody who does
    // not know it learns nothing about the account they were guessing at.
    if (this.phrases.get(row.id) !== attempt.secret) {
      return {
        status: AuthenticationStatus.REJECTED,
        reason: AuthenticationRejectionReason.INVALID_SECRET,
      };
    }

    const user = User.fromJSON(row);
    if (user.isDeleted) {
      return {
        status: AuthenticationStatus.REJECTED,
        reason: AuthenticationRejectionReason.ACCOUNT_DELETED,
      };
    }
    if (user.status !== UserStatus.ACTIVE) {
      return {
        status: AuthenticationStatus.REJECTED,
        reason: AuthenticationRejectionReason.ACCOUNT_SUSPENDED,
      };
    }
    if (!user.isEmailVerified) {
      return {
        status: AuthenticationStatus.REJECTED,
        reason: AuthenticationRejectionReason.EMAIL_NOT_VERIFIED,
      };
    }

    return {
      status: AuthenticationStatus.AUTHENTICATED,
      user,
      session: this.openSession(user.id, attempt.client),
    };
  }

  async requestPasswordReset(email: string): Promise<void> {
    const row = this.findByEmail(normalizeEmail(email));
    if (row !== undefined) this.issueGrant(row.id, 'RESET');
  }

  async resetPassword(token: string, newSecret: string): Promise<void> {
    this.enforcePolicy(newSecret);
    const grant = this.spend(token, 'RESET');
    this.phrases.set(grant.userId, newSecret);
    this.endEverySession(grant.userId);
  }

  async changePassword(
    actorId: UserId,
    currentSecret: string,
    newSecret: string,
  ): Promise<void> {
    if (this.phrases.get(actorId) !== currentSecret) throw new InvalidCredentialsError();
    this.enforcePolicy(newSecret);
    this.phrases.set(actorId, newSecret);
    // This implementation has no way to know which session the caller is using, so
    // it ends all of them — which satisfies "every other one" and is the stricter
    // of the two readings the contract allows.
    this.endEverySession(actorId);
  }

  async listSessions(actorId: UserId): Promise<Session[]> {
    const now = new Date();
    return [...this.sessions.values()]
      .filter((row) => row.userId === actorId)
      .map((row) => Session.fromJSON(row))
      .filter((session) => session.isActive(now))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async revokeSession(actorId: UserId, sessionId: SessionId): Promise<void> {
    const owned = await this.listSessions(actorId);
    const target = owned.filter((session) => session.id === sessionId)[0];
    if (target === undefined) throw new SessionNotFoundError(sessionId);
    this.endSession(sessionId);
  }

  async revokeAllSessions(actorId: UserId): Promise<void> {
    this.endEverySession(actorId);
  }

  private enforcePolicy(phrase: string): void {
    const violations = evaluatePassword(phrase, DEFAULT_PASSWORD_POLICY);
    if (violations.length > 0) throw new WeakPasswordError(violations);
  }

  private findByEmail(email: string): UserJSON | undefined {
    return [...this.users.values()].filter((row) => normalizeEmail(row.email) === email)[0];
  }

  private userRow(id: UserId): UserJSON {
    const row = this.users.get(id);
    if (row === undefined) throw new Error(`no user ${id}`);
    return row;
  }

  private nextId(prefix: string): string {
    this.issued += 1;
    return `${prefix}-${this.issued}`;
  }

  private issueGrant(userId: UserId, kind: GrantKind): void {
    this.seedGrant({
      value: this.nextId(kind.toLowerCase()),
      userId,
      kind,
      expiresAt: new Date(Date.now() + A_WEEK).toISOString(),
      consumedAt: null,
    });
  }

  /**
   * Uses a single-use value up.
   *
   * An unknown value and one that has aged out are the same answer on purpose: a
   * value nobody issued must not be distinguishable from one that was.
   */
  private spend(value: string, kind: GrantKind): StoredGrant {
    const grant = this.grants.get(value);
    if (grant === undefined || grant.kind !== kind) throw new ExpiredTokenError();
    if (grant.consumedAt !== null) throw new ConsumedTokenError();
    if (new Date(grant.expiresAt).getTime() <= Date.now()) throw new ExpiredTokenError();
    this.grants.set(value, { ...grant, consumedAt: new Date().toISOString() });
    return grant;
  }

  private openSession(userId: UserId, client: ClientContext): Session {
    const now = new Date();
    const row: SessionJSON = {
      id: this.nextId('session') as SessionId,
      userId,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + A_WEEK).toISOString(),
      revokedAt: null,
      clientAddress: client.address,
      clientLabel: client.label,
    };
    this.seedSession(row);
    return Session.fromJSON(row);
  }

  private endSession(sessionId: SessionId): void {
    const row = this.sessions.get(sessionId);
    if (row === undefined) return;
    this.sessions.set(sessionId, { ...row, revokedAt: new Date().toISOString() });
  }

  private endEverySession(userId: UserId): void {
    for (const row of [...this.sessions.values()]) {
      if (row.userId === userId && row.revokedAt === null) this.endSession(row.id);
    }
  }
}
