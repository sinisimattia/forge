import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { SessionNotFoundError } from '__FORGE_SCOPE__/core/auth/errors';
import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import type { ClientContext, SessionId } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { generateOpaqueToken } from '../../common/crypto';
import { RefreshTokenRecord } from '../entities/refresh-token-record.entity';
import { SessionRecord } from '../entities/session-record.entity';

/**
 * How long an access credential stands on its own, in seconds.
 *
 * Short, and the shortness is the whole of one security property. Nothing is
 * looked up when an access credential is presented — the guard verifies a
 * signature and reads what the credential says, with no database round trip on
 * the request path. The cost of that is a window: a session revoked at 12:00 is
 * still presentable until the credential minted before it runs out. This number
 * IS that window, and it is the only thing bounding it.
 *
 * Renewal is what closes the window, not the guard: a renewal reads the session
 * row, and a revoked session cannot be renewed, so a revoked session survives at
 * most this long and then stops.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * How long a session lives from the moment it begins, in seconds.
 *
 * A hard ceiling rather than a sliding window: renewing does not push it out.
 * A sliding expiry means a session that is used regularly never ends, which
 * turns "sign in again every so often" — the one thing that reliably evicts a
 * credential somebody copied — into something that never happens to an active
 * account, which is exactly the account worth taking.
 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** What a successful sign-in or renewal hands back. */
export interface IssuedCredentials {
  /** The session the credentials belong to. */
  session: Session;
  /** The short-lived credential presented on ordinary requests. */
  accessToken: string;
  /** The long-lived credential presented only to renew or end the session. */
  refreshToken: string;
}

/**
 * What the signed access credential carries.
 *
 * Two claims and no more. Anything else — a display name, a role — would be a
 * copy of a database row that goes stale the moment the row changes, and stays
 * stale for as long as the credential lives, with nothing to notice.
 */
export interface AccessTokenClaims {
  /** The account the credential proves. */
  sub: UserId;
  /** The session it belongs to, so a renewal can find the row. */
  sid: SessionId;
}

/**
 * Sessions and the credentials that stand for them.
 *
 * Core models the session (`Session`) and deliberately models no credential at
 * all: how a caller demonstrates that it holds one is a transport concern, and
 * all of it lives here.
 */
@Injectable()
export class SessionService {
  public constructor(
    @InjectRepository(SessionRecord)
    private readonly sessions: Repository<SessionRecord>,
    @InjectRepository(RefreshTokenRecord)
    private readonly refreshTokens: Repository<RefreshTokenRecord>,
    private readonly jwt: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Begins a session and issues both credentials for it.
   *
   * The session row and its first renewal credential are written in one
   * transaction: a session with no credential cannot be renewed and cannot be
   * ended by its owner, so committing one without the other produces a row that
   * is neither usable nor reachable.
   *
   * @param userId - the account signing in
   * @param client - what could be told about where the attempt came from
   * @returns the session and the two credentials that stand for it
   */
  public async begin(userId: UserId, client: ClientContext): Promise<IssuedCredentials> {
    return this.dataSource.transaction((manager) => this.beginIn(manager, userId, client));
  }

  /**
   * Begins a session inside a transaction somebody else opened.
   *
   * The variant that exists so a caller can make beginning a session atomic with
   * something *else* — changing a password and re-issuing for the caller has to
   * be both or neither, or a failure in between leaves somebody whose password
   * changed and who is signed out of the account they changed it on. See
   * `AuthService.changePasswordAndReissue`, which is the reason this is
   * separable at all.
   *
   * @param manager - the caller's transaction
   * @param userId - the account signing in
   * @param client - what could be told about where the attempt came from
   * @returns the session and the two credentials that stand for it
   */
  public async beginIn(
    manager: EntityManager,
    userId: UserId,
    client: ClientContext,
  ): Promise<IssuedCredentials> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

    const { session, refreshToken } = await (async () => {
      const inserted = await manager.insert(SessionRecord, {
        userId,
        createdAt: now,
        lastUsedAt: now,
        expiresAt,
        revokedAt: null,
        clientAddress: client.address,
        clientLabel: client.label,
      });
      const id = inserted.identifiers[0].id as string;

      const issued = await SessionService.issueRefreshToken(manager, id, expiresAt, now);
      return {
        session: new Session({
          id: id as SessionId,
          userId,
          createdAt: now,
          lastUsedAt: now,
          expiresAt,
          revokedAt: null,
          clientAddress: client.address,
          clientLabel: client.label,
        }),
        refreshToken: issued.token,
      };
    })();

    return { session, accessToken: this.mintAccessToken(userId, session.id), refreshToken };
  }

  /**
   * Signs an access credential for a session.
   *
   * @param userId - the account it proves
   * @param sessionId - the session it belongs to
   * @returns the signed credential
   */
  public mintAccessToken(userId: UserId, sessionId: SessionId): string {
    const claims: AccessTokenClaims = { sub: userId, sid: sessionId };
    return this.jwt.sign(claims);
  }

  /**
   * Writes a new renewal credential for a session and returns the value to hand
   * to its holder.
   *
   * `static`, and taking the `manager` rather than reading a repository off an
   * instance, because both callers — beginning a session and rotating one — must
   * write inside a transaction somebody else opened. A version that used the
   * injected repository would silently write outside the caller's transaction,
   * which in the rotation case is precisely the row whose lock the whole
   * reuse-detection guarantee rests on.
   *
   * @param manager - the caller's transaction
   * @param sessionId - the session the credential renews
   * @param expiresAt - when it stops working; never later than the session's own end
   * @param now - the instant to record as its creation
   * @returns the credential to hand out, and the id of the row standing for it
   */
  public static async issueRefreshToken(
    manager: EntityManager,
    sessionId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<{ token: string; id: string }> {
    const generated = generateOpaqueToken();
    const inserted = await manager.insert(RefreshTokenRecord, {
      sessionId,
      tokenHash: generated.hash,
      replacedById: null,
      usedAt: null,
      expiresAt,
      createdAt: now,
    });
    return { token: generated.token, id: inserted.identifiers[0].id as string };
  }

  /**
   * Ends a session and kills every renewal credential in it, in the caller's
   * transaction.
   *
   * Both halves are necessary and neither is sufficient. Revoking the session
   * alone leaves rows whose `used_at` is null, so a later presentation of one
   * reads as a first use rather than as reuse and no `SESSION_REUSE_DETECTED`
   * entry is ever written for a credential that was in fact stolen. Killing the
   * credentials alone leaves a session that an access credential minted a minute
   * ago still names, and that a renewal would have been able to extend.
   *
   * @param manager - the caller's transaction
   * @param sessionId - the session to end
   * @param now - the instant to record
   */
  public static async endSession(
    manager: EntityManager,
    sessionId: string,
    now: Date,
  ): Promise<void> {
    await manager.update(SessionRecord, { id: sessionId, revokedAt: IsNull() }, { revokedAt: now });
    // Only the ones not already spent. Overwriting `used_at` on a credential that
    // was legitimately exchanged last week would rewrite when it happened, and
    // the chain of `used_at` instants is what an incident is reconstructed from.
    await manager.update(RefreshTokenRecord, { sessionId, usedAt: IsNull() }, { usedAt: now });
  }

  /**
   * The actor's own usable sessions, newest first.
   *
   * @param actorId - the user on whose behalf the call is made
   * @returns every session of theirs that is neither ended nor run out
   */
  public async listActive(actorId: UserId): Promise<Session[]> {
    const rows = await this.sessions.find({
      where: { userId: actorId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return rows.map((row) => SessionService.toEntity(row));
  }

  /**
   * Ends one of the actor's own sessions.
   *
   * The session is matched by id **and** owner in one statement. Reading it
   * first and comparing the owner afterwards would answer differently for a
   * session that exists but belongs to somebody else than for one that does not
   * exist, which is a way to test other people's session ids for existence —
   * hence the single indistinguishable {@link SessionNotFoundError}.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param sessionId - the session to end
   * @throws SessionNotFoundError when no usable session of theirs answers to it
   */
  public async revoke(actorId: UserId, sessionId: SessionId): Promise<void> {
    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(SessionRecord, {
        where: { id: sessionId, userId: actorId, revokedAt: IsNull() },
      });
      if (row === null) throw new SessionNotFoundError(sessionId);
      await SessionService.endSession(manager, row.id, now);
    });
  }

  /**
   * Ends every session the actor holds, including the one they are using.
   *
   * @param actorId - the user on whose behalf the call is made
   * @returns how many sessions were ended
   */
  public async revokeAll(actorId: UserId): Promise<number> {
    return this.dataSource.transaction((manager) => SessionService.revokeAllIn(manager, actorId));
  }

  /**
   * Ends every session the actor holds, inside a transaction somebody else
   * opened. See {@link SessionService.beginIn} for why the pair exists.
   *
   * @param manager - the caller's transaction
   * @param actorId - the user on whose behalf the call is made
   * @returns how many sessions were ended
   */
  public static async revokeAllIn(manager: EntityManager, actorId: UserId): Promise<number> {
    const now = new Date();
    const rows = await manager.find(SessionRecord, {
      where: { userId: actorId, revokedAt: IsNull() },
    });
    for (const row of rows) await SessionService.endSession(manager, row.id, now);
    return rows.length;
  }

  /** Deletes credentials whose session ended long ago. Not on any request path. */
  public async pruneExpired(before: Date): Promise<void> {
    await this.refreshTokens.delete({ expiresAt: LessThan(before) });
  }

  /** Row to entity, asserting the branded ids in one visible line. */
  public static toEntity(row: SessionRecord): Session {
    return new Session({
      id: row.id as SessionId,
      userId: row.userId as UserId,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      clientAddress: row.clientAddress,
      clientLabel: row.clientLabel,
    });
  }
}
