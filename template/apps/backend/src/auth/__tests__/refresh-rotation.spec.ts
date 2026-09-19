import { JwtService } from '@nestjs/jwt';
import type { DataSource } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { RecordAuditEntryInput } from '__FORGE_SCOPE__/core/audit/types';
import { SessionNotFoundError } from '__FORGE_SCOPE__/core/auth/errors';
import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import type { AuditService } from '../../audit/audit.service';
import { generateOpaqueToken, hashOpaqueToken } from '../../common/crypto';
import { RefreshTokenRecord } from '../entities/refresh-token-record.entity';
import { SessionRecord } from '../entities/session-record.entity';
import { RefreshTokenService } from '../session/refresh-token.service';
import { SessionService } from '../session/session.service';
import { FakeDataSource } from '../../common/testing';

/**
 * # D8 — a renewal credential presented twice revokes the whole family
 *
 * The attack: somebody copies a renewal credential. Sooner or later both they
 * and its rightful holder present it, and the server sees one credential
 * presented twice. Nothing in either request distinguishes the two parties.
 *
 * **Why the "is rejected" assertion is not enough on its own, which is the
 * whole point of this file.** An implementation that refused the presented
 * credential and left everything else alone would satisfy it — and would leave
 * whoever copied the credential holding the *successor* it was exchanged for,
 * which still works. The family assertions below are what tell the two
 * implementations apart, and the assertion that the ROTATED-TO credential is
 * dead is the one an implementation that kills only the presented credential
 * cannot pass. It is stated separately and deliberately, because on every other
 * assertion the two look identical.
 *
 * Watched failing (Step 6 of the task): with the reuse branch changed to reject
 * the presented credential without ending the session, "is rejected" passes and
 * every family assertion fails.
 */

/** This suite's signing key. Not a credential: it signs nothing outside this file. */
const SIGNING_KEY = 'refresh-rotation-spec-signing-key';

const CLIENT: ClientContext = { address: '203.0.113.7', label: 'spec' };

const SESSION_ID = 'session-under-test';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';

/** Everything one isolated world holds, so a test can build a second one. */
interface World {
  source: FakeDataSource;
  rotation: RefreshTokenService;
  recorded: RecordAuditEntryInput[];
  original: string;
  current: string;
  spentEarlier: string;
  spentEarlierUsedAt: Date;
}

describe('D8: renewal, and a credential presented twice', () => {
  let source: FakeDataSource;
  let rotation: RefreshTokenService;
  let recorded: RecordAuditEntryInput[];

  /** The credential the session started with, and the one it was exchanged for. */
  let original: string;
  let current: string;

  /** A credential that was spent legitimately, long before any of this. */
  let spentEarlier: string;
  let spentEarlierUsedAt: Date;

  /**
   * One isolated world: a session that has already rotated once, so what every
   * test acts on is a credential that has been exchanged.
   *
   * @param honourLocks - `false` builds a store that accepts `pessimistic_write`
   *   and ignores it, which is how the predicate standing behind the lock gets
   *   an assertion of its own.
   */
  const buildWorld = async (honourLocks = true): Promise<World> => {
    const store = new FakeDataSource(honourLocks);
    const entries: RecordAuditEntryInput[] = [];

    const at = new Date('2026-09-18T10:00:00.000Z');
    const lifetime = 30 * 24 * 60 * 60 * 1000;

    store.seed(SessionRecord, [
      {
        id: SESSION_ID,
        userId: OWNER_ID,
        createdAt: new Date(at.getTime() - 60_000),
        lastUsedAt: new Date(at.getTime() - 60_000),
        expiresAt: new Date(at.getTime() + lifetime),
        revokedAt: null,
        clientAddress: null,
        clientLabel: null,
      },
    ]);

    // A credential this session spent legitimately a while ago. It is here so the
    // family sweep has something already-used to leave alone: `used_at` is the
    // record of WHEN a credential was exchanged, and a sweep that overwrote it
    // would destroy the chain an incident is reconstructed from.
    const earlierUsedAt = new Date(at.getTime() - 30_000);
    const earlier = generateOpaqueToken();
    const first = generateOpaqueToken();

    store.seed(RefreshTokenRecord, [
      {
        id: 'credential-spent-earlier',
        sessionId: SESSION_ID,
        tokenHash: earlier.hash,
        replacedById: null,
        usedAt: earlierUsedAt,
        expiresAt: new Date(at.getTime() + lifetime),
        createdAt: new Date(at.getTime() - 60_000),
      },
      {
        id: 'credential-original',
        sessionId: SESSION_ID,
        tokenHash: first.hash,
        replacedById: null,
        usedAt: null,
        expiresAt: new Date(at.getTime() + lifetime),
        createdAt: new Date(at.getTime() - 30_000),
      },
    ]);

    const audit = {
      record: async (input: RecordAuditEntryInput) => {
        entries.push(input);
      },
    } as unknown as AuditService;

    const sessions = new SessionService(
      null as never,
      null as never,
      new JwtService({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      store as unknown as DataSource,
    );

    const service = new RefreshTokenService(store as unknown as DataSource, sessions, audit);

    // Every test begins AFTER one legitimate rotation, because the thing under
    // test is what happens to a credential that has already been exchanged.
    const issued = (await service.rotate(first.token, CLIENT)).refreshToken;
    entries.length = 0;

    return {
      source: store,
      rotation: service,
      recorded: entries,
      original: first.token,
      current: issued,
      spentEarlier: earlier.token,
      spentEarlierUsedAt: earlierUsedAt,
    };
  };

  beforeEach(async () => {
    const world = await buildWorld();
    source = world.source;
    rotation = world.rotation;
    recorded = world.recorded;
    original = world.original;
    current = world.current;
    spentEarlier = world.spentEarlier;
    spentEarlierUsedAt = world.spentEarlierUsedAt;
  });

  describe('rotating a valid credential', () => {
    it('returns a new credential, and not the one presented', () => {
      expect(current).not.toBe(original);
      expect(current.length).toBeGreaterThan(0);
    });

    it('marks the presented credential spent and points it at its successor', () => {
      const presented = source.byId(RefreshTokenRecord, 'credential-original');

      expect(presented?.usedAt).toBeInstanceOf(Date);
      // Not merely "something was written": the successor must be findable from
      // the spent credential, because walking that chain is how a whole family is
      // revoked when reuse is detected later.
      expect(presented?.replacedById).toEqual(
        source.all(RefreshTokenRecord).find((row) => row.usedAt === null)?.id,
      );
    });

    it('issues a successor that dies no later than the session does', () => {
      // `issueRefreshToken` takes the expiry as a PARAMETER, so the bound its
      // caller's comment claims ("never later than the session's own end") is a
      // property of the call site and not of the helper. A successor that
      // outlived its session would be a credential with nothing to renew.
      const successor = source
        .all(RefreshTokenRecord)
        .find((row) => row.tokenHash === hashOpaqueToken(current));
      const session = source.byId(SessionRecord, SESSION_ID);

      expect((successor?.expiresAt as Date).getTime()).toBeLessThanOrEqual(
        (session?.expiresAt as Date).getTime(),
      );
    });

    it('leaves the session usable and bumps when it was last used', () => {
      const session = source.byId(SessionRecord, SESSION_ID);

      expect(session?.revokedAt).toBeNull();
      expect((session?.lastUsedAt as Date).getTime()).toBeGreaterThan(
        (session?.createdAt as Date).getTime(),
      );
    });

    it('lets the credential it issued be rotated in its turn', async () => {
      await expect(rotation.rotate(current, CLIENT)).resolves.toMatchObject({
        refreshToken: expect.any(String),
      });
    });
  });

  describe('presenting the OLD credential after a rotation', () => {
    /** The rejection every test in this block acts on. */
    let rejection: unknown;

    beforeEach(async () => {
      rejection = await rotation.rotate(original, CLIENT).then(
        () => null,
        (error: unknown) => error,
      );
    });

    // D8. On its own this would also pass against an implementation that
    // rejected the presented credential and did nothing else — see the block
    // below for why that implementation is the dangerous one.
    it('is rejected', () => {
      expect(rejection).toBeInstanceOf(SessionNotFoundError);
    });

    // D8.
    it('revokes the session', () => {
      expect(source.byId(SessionRecord, SESSION_ID)?.revokedAt).toBeInstanceOf(Date);
    });

    // D8.
    it('revokes every other renewal credential in that session', () => {
      const live = source
        .all(RefreshTokenRecord)
        .filter((row) => row.sessionId === SESSION_ID && row.usedAt === null);

      expect(live).toEqual([]);
    });

    it('does not rewrite when an already-spent credential was spent', () => {
      // The sweep marks the unused ones. A sweep written without that predicate
      // passes the assertion above just as well, and silently rewrites the
      // history of every credential the session ever legitimately exchanged.
      expect(source.byId(RefreshTokenRecord, 'credential-spent-earlier')?.usedAt).toEqual(
        spentEarlierUsedAt,
      );
    });

    it('writes a SESSION_REUSE_DETECTED entry naming the session and its owner', () => {
      const entries = recorded.filter((e) => e.action === AuditAction.SESSION_REUSE_DETECTED);

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: OWNER_ID,
        resourceId: SESSION_ID,
        clientAddress: CLIENT.address,
      });
    });

    it('writes no renewal entry for the presentation it refused', () => {
      expect(recorded.map((e) => e.action)).not.toContain(AuditAction.SESSION_RENEWED);
    });

    // D8, and the assertion the whole block exists for. An implementation that
    // kills only the credential presented looks identical on every assertion
    // above: the presented one is spent already, so "is rejected" passes, and a
    // session it never touched is one a reader of the other assertions could
    // easily believe it had. This is the one it cannot pass — the credential the
    // legitimate holder is actually using right now must be dead too, because
    // whoever copied the old one has been handed it.
    it('kills the ROTATED-TO credential as well', async () => {
      expect(source.all(RefreshTokenRecord).find((row) => row.usedAt === null)).toBeUndefined();

      await expect(rotation.rotate(current, CLIENT)).rejects.toBeInstanceOf(SessionNotFoundError);
    });
  });

  describe('two simultaneous presentations of the same valid credential', () => {
    // Two independent mechanisms hold this property: the write lock on the
    // credential's row, and the `used_at IS NULL` predicate on the statement
    // that spends it. Either one alone is enough, which is exactly why the
    // outcome assertion below is NOT evidence that both are still there —
    // removing either leaves it green. Each therefore gets an assertion of its
    // own.
    it('lets exactly one of them succeed', async () => {
      const outcomes = await Promise.allSettled([
        rotation.rotate(current, CLIENT),
        rotation.rotate(current, CLIENT),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    });

    it('reads the credential under a write lock', async () => {
      source.lockedRows.length = 0;

      await rotation.rotate(current, CLIENT);

      // The first mechanism, asserted directly. Against Postgres 16 this is what
      // `SELECT ... FOR UPDATE` becomes, and with the predicate below removed it
      // is the only thing standing between two concurrent presentations and two
      // working successors.
      const successor = source
        .all(RefreshTokenRecord)
        .find((row) => row.tokenHash === hashOpaqueToken(current));

      expect(source.lockedRows).toEqual([`RefreshTokenRecord:${String(successor?.id)}`]);
    });

    it('still lets only one succeed against a store that ignores the lock', async () => {
      // The second mechanism, isolated: this world accepts the lock request and
      // does nothing with it, so both callers read `used_at` as null and the
      // `used_at IS NULL` predicate on the spending statement is all that is
      // left. Without it, the loser's `UPDATE` matches no row, the method
      // ignores that and returns a fresh credential anyway — two live
      // successors from one credential, which is precisely the double-spend
      // measured against Postgres 16 before that branch existed.
      const unlocked = await buildWorld(false);

      const outcomes = await Promise.allSettled([
        unlocked.rotation.rotate(unlocked.current, CLIENT),
        unlocked.rotation.rotate(unlocked.current, CLIENT),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    });
  });

  it('rejects a credential nobody was ever issued', async () => {
    await expect(rotation.rotate(generateOpaqueToken().token, CLIENT)).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
  });

  it('rejects a credential whose session has already ended', async () => {
    source.update(SessionRecord, { id: SESSION_ID }, { revokedAt: new Date() });

    await expect(rotation.rotate(current, CLIENT)).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it('rejects a credential that has run out', async () => {
    source.update(
      RefreshTokenRecord,
      { usedAt: null },
      { expiresAt: new Date('2020-01-01T00:00:00.000Z') },
    );

    await expect(rotation.rotate(current, CLIENT)).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it('never hands the credential, or any part of it, to the audit log', async () => {
    // Both paths that write an entry: a successful renewal, and a detected reuse.
    const next = (await rotation.rotate(current, CLIENT)).refreshToken;
    await rotation.rotate(original, CLIENT).catch(() => undefined);

    const written = JSON.stringify(recorded);
    // Every credential this suite has held, including the prefixes of each: a
    // truncated credential in an audit row is still a credential in a backup.
    for (const credential of [original, current, next, spentEarlier]) {
      expect(written).not.toContain(credential);
      expect(written).not.toContain(credential.slice(0, 8));
    }
  });
});
