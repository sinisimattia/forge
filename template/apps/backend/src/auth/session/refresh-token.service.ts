import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { SessionNotFoundError } from '__FORGE_SCOPE__/core/auth/errors';
import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditService } from '../../audit/audit.service';
import { hashOpaqueToken } from '../../common/crypto';
import { RefreshTokenRecord } from '../entities/refresh-token-record.entity';
import { SessionRecord } from '../entities/session-record.entity';
import { IssuedCredentials, SessionService } from './session.service';

/**
 * The placeholder identifier every renewal failure is reported with. See
 * {@link RefreshTokenService.rotate} for why no real value goes here.
 */
const NO_SESSION = '(none)';

/**
 * Renewal, and the detection of a renewal credential presented twice.
 *
 * ## Why this is not a method on `IAuthService`
 *
 * Core's contract says so itself, and the reason is worth having in front of
 * whoever changes this file: renewing needs the credential the caller
 * presented, and one implementation of that interface — the one running in a
 * browser — is structurally unable to read the credential, because it is kept
 * where script cannot reach it. A method both implementations had to have would
 * force that one to pretend. So renewal lives here, reached directly, and is
 * held to its own suite (`__tests__/refresh-rotation.spec.ts`, D8).
 *
 * ## The attack this is shaped by
 *
 * A renewal credential that has already been exchanged is presented again.
 * Either the legitimate client retried, or somebody copied it. **Nothing in the
 * request distinguishes the two**, and that is not a gap to be closed by looking
 * harder — the two requests are byte-identical. What follows is the only
 * response that is safe in both cases: end the session and every credential in
 * it. The legitimate holder is signed out and has to sign in again, which is a
 * real cost, paid because the alternative is leaving an account open to whoever
 * copied the credential.
 */
@Injectable()
export class RefreshTokenService {
  public constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Exchanges a renewal credential for a fresh pair.
   *
   * Every read and write below happens inside one transaction, and the row is
   * read **with a write lock** (`SELECT ... FOR UPDATE`). Both halves are
   * load-bearing and neither is decoration:
   *
   * - Without the transaction, the two statements that mark this credential
   *   spent and issue its successor can commit separately, so a crash between
   *   them leaves a session with no usable credential.
   * - Without the lock, two simultaneous presentations of the same valid
   *   credential both read `used_at IS NULL`, both proceed, and both are issued
   *   successors. That is reuse detection failing at the exact moment it is
   *   supposed to fire — the moment two parties hold the same credential.
   *
   * The lock is taken rather than raising the isolation level to `SERIALIZABLE`
   * deliberately. `SERIALIZABLE` would also be correct, but it answers the
   * losing transaction with a serialization failure that the caller must catch
   * and retry; a retry loop around a security-critical branch is a thing that
   * gets written wrong once and then trusted. Under the row lock the second
   * presentation does not fail — it waits, re-reads the row Postgres has just
   * let go of, sees `used_at` set, and takes the reuse branch, which is the
   * answer it should have had all along.
   *
   * @param presented - the credential exactly as its holder presented it
   * @param client - what could be told about where the presentation came from
   * @returns a fresh session view and a fresh pair of credentials
   * @throws SessionNotFoundError when the credential is unknown, spent, expired,
   *   or belongs to a session that has ended. One answer for all of them: a
   *   caller who presents a credential that does not work learns only that.
   */
  public async rotate(presented: string, client: ClientContext): Promise<IssuedCredentials> {
    const presentedHash = hashOpaqueToken(presented);
    const now = new Date();

    const rotated = await this.dataSource.transaction(async (manager) => {
      // The write lock: `SELECT ... FOR UPDATE` (verified against Postgres 16).
      // It is the primary mechanism, and the predicate on the spending statement
      // below is the backstop — two mechanisms, so removing either one on its own
      // leaves the outcome of a race unchanged. That is exactly why each has its
      // own assertion in `__tests__/refresh-rotation.spec.ts`; the one that
      // catches this line going missing is `reads the credential under a write
      // lock`.
      //
      // The lock also cannot be moved out of the transaction: TypeORM throws
      // `PessimisticLockTransactionRequiredError` when `pessimistic_write` is
      // asked for with no transaction active.
      const row = await manager.findOne(RefreshTokenRecord, {
        where: { tokenHash: presentedHash },
        lock: { mode: 'pessimistic_write' },
      });

      if (row === null) return null;

      if (row.usedAt !== null) {
        // Presented twice. See this class's own comment for why the whole family
        // goes, rather than only the credential in hand: an implementation that
        // rejected this one presentation and left the session alive would look
        // identical on every assertion but the family ones, and would leave
        // whoever copied the credential holding a working successor.
        await SessionService.endSession(manager, row.sessionId, now);
        return { reuse: true as const, sessionId: row.sessionId };
      }

      if (row.expiresAt.getTime() <= now.getTime()) return null;

      const session = await manager.findOne(SessionRecord, { where: { id: row.sessionId } });
      if (session === null || !SessionService.toEntity(session).isActive(now)) return null;

      // Spend the credential BEFORE issuing its successor, and only while
      // `used_at` is still null.
      //
      // The predicate is redundant while the row lock above is held — nobody else
      // can have spent this row in between — and it is here for what happens if
      // that lock is ever removed. Then two transactions can both read `used_at`
      // as null, and this `UPDATE` is what stops the second one from spending it
      // a second time: it matches no row, reports `affected: 0`, and the branch
      // below turns that into the reuse it is. Without reading `affected` the
      // statement detects the collision and the method carries on to issue a
      // fresh credential anyway, which is a silent double-spend. Measured: two
      // simultaneous read-then-spend transactions against Postgres 16, with no
      // row lock and a warm connection pool, both read `used_at` as null, the
      // first's `UPDATE` reported `affected: 1` and the second's `affected: 0`,
      // and both transactions committed.
      const spent = await manager.update(
        RefreshTokenRecord,
        { id: row.id, usedAt: IsNull() },
        { usedAt: now },
      );
      // `!== 1`, not `=== 0`: TypeORM types `affected` as
      // `number | null | undefined`, and on the postgres driver it is always a
      // number — but a driver that returned `undefined` would slip past an
      // equality with zero and skip this branch silently. The update is by
      // primary key, so exactly one is the only correct answer, and anything
      // else fails closed.
      if (spent.affected !== 1) {
        await SessionService.endSession(manager, row.sessionId, now);
        return { reuse: true as const, sessionId: row.sessionId };
      }

      const issued = await SessionService.issueRefreshToken(
        manager,
        session.id,
        // Never later than the session's own end. A successor that outlived its
        // session would be a credential with nothing to renew, and renewing it
        // would have to either fail confusingly or resurrect the session.
        session.expiresAt,
        now,
      );
      // The chain, written once the successor exists. `replaced_by_id` is what
      // lets a whole family be walked from any credential in it.
      await manager.update(RefreshTokenRecord, { id: row.id }, { replacedById: issued.id });
      await manager.update(SessionRecord, { id: session.id }, { lastUsedAt: now });

      return { reuse: false as const, session, refreshToken: issued.token };
    });

    // One answer for four different findings — unknown, spent, expired, and
    // belonging to a session that has ended. Telling them apart would say which
    // credentials were ever real, which is the whole of what a guesser wants to
    // know. The identifier is a fixed placeholder rather than the value
    // presented: this error's message is written to logs, and the value
    // presented is a live credential right up until this call decided it was not.
    if (rotated === null) throw new SessionNotFoundError(NO_SESSION);

    if (rotated.reuse) {
      await this.auditReuse(rotated.sessionId, client, now);
      throw new SessionNotFoundError(NO_SESSION);
    }

    const entity = SessionService.toEntity({ ...rotated.session, lastUsedAt: now });
    await this.audit.record({
      organizationId: null,
      actorId: entity.userId,
      action: AuditAction.SESSION_RENEWED,
      resourceType: 'session',
      resourceId: entity.id,
      metadata: {},
      clientAddress: client.address,
      clientLabel: client.label,
      occurredAt: now,
    });

    return {
      session: entity,
      accessToken: this.sessions.mintAccessToken(entity.userId, entity.id),
      refreshToken: rotated.refreshToken,
    };
  }

  /**
   * Records the reuse, outside the transaction that acted on it.
   *
   * Outside on purpose: the revocation must commit whether or not the audit
   * write succeeds. Inside the transaction, an audit table that refused the
   * insert would roll the revocation back and leave the session — and the
   * credential somebody copied — alive, which inverts what both mechanisms are
   * for.
   */
  private async auditReuse(sessionId: string, client: ClientContext, now: Date): Promise<void> {
    const session = await this.dataSource
      .getRepository(SessionRecord)
      .findOne({ where: { id: sessionId } });

    await this.audit.record({
      organizationId: null,
      actorId: session === null ? null : (session.userId as UserId),
      action: AuditAction.SESSION_REUSE_DETECTED,
      resourceType: 'session',
      resourceId: sessionId,
      // Nothing of the credential itself, not even a prefix: this table is the
      // most-read one in an incident and the least-protected in a backup.
      metadata: { revokedSession: true },
      clientAddress: client.address,
      clientLabel: client.label,
      occurredAt: now,
    });
  }
}
