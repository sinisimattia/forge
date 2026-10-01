import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  PostgresThrottlerStorage,
  RECORD_ONE_ATTEMPT,
  SWEEP_FINISHED_WINDOWS,
} from '../postgres-throttler.storage';

/**
 * # What a unit test can honestly say about this storage
 *
 * **This file is not the counting guarantee.** The whole decision — count,
 * reset, block, or leave a blocked subject alone — is one SQL statement
 * evaluated by Postgres. Jest has no Postgres, and the generated-project gate
 * that runs this suite has none either, so nothing here can execute that
 * statement. A double that re-implemented the decision in TypeScript would be
 * worse than no test: every assertion would be about the double, the SQL could
 * be rewritten to count every attempt as the first, and the suite would stay
 * green. That was measured — see the task report's falsification run.
 *
 * So this file asserts the two halves that are genuinely in TypeScript, and
 * the shape of what is sent:
 *
 * | Fault | Caught by |
 * |---|---|
 * | the sweep is dropped, or runs after the write, or is narrowed to the key in hand | `sweeps finished windows across the table, before it writes` |
 * | the units are converted on the way in, so Postgres is given seconds | `passes the window and the block to the database untouched, in milliseconds` |
 * | the retry values are returned in milliseconds | `reports the window and the block in SECONDS, not milliseconds` |
 * | `isBlocked` is read off the column's presence rather than its instant | `a block that has already lapsed is not a block` |
 * | a lapsed block still reports a retry delay | `reports no retry delay when nothing is blocked` |
 *
 * `FakeDataSource` is deliberately not used: it answers domain queries against
 * an in-memory table, and what is under test here is two literal SQL statements
 * and what is done with the row one of them returns.
 *
 * ## Where the rest lives
 *
 * The counting semantics — up to the limit without blocking, blocked on the
 * attempt after it, a blocked subject not counted further, separate subjects
 * separate, a fresh window after the old one ends — are asserted against a real
 * Postgres in `tests/integration/docker.test.mjs`, which executes
 * {@link RECORD_ONE_ATTEMPT} itself across **two independent connections**.
 * That is the one property no in-process double can demonstrate, because a
 * double shares the process it is supposed to be proving the counter does not
 * live in.
 */
describe('PostgresThrottlerStorage', () => {
  /** 5 attempts per 60s, blocked for 120s once exceeded. Milliseconds, as the library passes them. */
  const TTL = 60_000;
  const LIMIT = 5;
  const BLOCK = 120_000;

  /** A row as the statement returns it, with the two instants given relative to now. */
  const rowIn = (expiresInMs: number, blockedInMs: number | null, hits = 1, engaged = false) => ({
    hits,
    engaged,
    expires_at: new Date(Date.now() + expiresInMs),
    blocked_until: blockedInMs === null ? null : new Date(Date.now() + blockedInMs),
  });

  /** A data source answering the increment with `row`, recording every statement it was asked. */
  const stub = (
    row: ReturnType<typeof rowIn>,
    onBlocked: (key: string, retryAfterSeconds: number) => void | Promise<void> = () => undefined,
  ) => {
    const asked: { sql: string; params?: unknown[] }[] = [];
    const dataSource = {
      query: (sql: string, params?: unknown[]) => {
        asked.push({ sql, params });
        return Promise.resolve(sql.trimStart().startsWith('DELETE') ? [] : [row]);
      },
    } as unknown as DataSource;
    return { storage: new PostgresThrottlerStorage(dataSource, onBlocked), asked };
  };

  it('sweeps finished windows across the table, before it writes', async () => {
    const { storage, asked } = stub(rowIn(TTL, null));

    await storage.increment('k', TTL, LIMIT, BLOCK, 'default');

    expect(asked.map((one) => one.sql)).toEqual([SWEEP_FINISHED_WINDOWS, RECORD_ONE_ATTEMPT]);
    // No key among the sweep's parameters, and none interpolated into it. The
    // sweep runs on the write path, so a subject that stops being attempted is
    // never revisited by its own increment; narrowing it to the key in hand
    // would leave every abandoned window in the table for ever.
    expect(asked[0].params).toBeUndefined();
    expect(asked[0].sql).not.toContain('key');
  });

  it('passes the window and the block to the database untouched, in milliseconds', async () => {
    const { storage, asked } = stub(rowIn(TTL, null));

    await storage.increment('k', TTL, LIMIT, BLOCK, 'default');

    // The statement reads both as milliseconds. Dividing here would make every
    // window and every block a thousand times shorter than configured, and no
    // assertion about the returned record would notice.
    expect(asked[1].params).toEqual(['k', TTL, LIMIT, BLOCK]);
  });

  it('reports the window and the block in SECONDS, not milliseconds', async () => {
    const { storage } = stub(rowIn(TTL, BLOCK, LIMIT + 1));

    const record = await storage.increment('k', TTL, LIMIT, BLOCK, 'default');

    // 60 and 120, not 60000 and 120000. The guard builds its retry value from
    // these, so milliseconds out would tell every refused caller to wait a
    // thousand times too long — and nothing would fail.
    expect(record.timeToExpire).toBeLessThanOrEqual(TTL / 1000);
    expect(record.timeToExpire).toBeGreaterThan(TTL / 1000 - 5);
    expect(record.timeToBlockExpire).toBeLessThanOrEqual(BLOCK / 1000);
    expect(record.timeToBlockExpire).toBeGreaterThan(BLOCK / 1000 - 5);
    expect(record.totalHits).toBe(LIMIT + 1);
    expect(record.isBlocked).toBe(true);
  });

  it('a block that has already lapsed is not a block', async () => {
    // The column is set and the instant is past. Reading `blocked_until !== null`
    // as "blocked" would refuse a caller the database has already released.
    const { storage } = stub(rowIn(TTL, -1000));

    const record = await storage.increment('k', TTL, LIMIT, BLOCK, 'default');

    expect(record.isBlocked).toBe(false);
  });

  it('reports no retry delay when nothing is blocked', async () => {
    const { storage } = stub(rowIn(TTL, null));

    const record = await storage.increment('k', TTL, LIMIT, BLOCK, 'default');

    expect(record.isBlocked).toBe(false);
    expect(record.timeToBlockExpire).toBe(0);
  });

  it('reads a count the driver hands back as a string', async () => {
    // `integer` arrives as a number from `pg`, but a column widened to `bigint`
    // would arrive as a string, and `totalHits` is typed `number`. Coercion
    // here is what keeps a silent `"6" > 5` comparison out of the guard.
    const { storage } = stub({ ...rowIn(TTL, null), hits: '6' as unknown as number });

    const record = await storage.increment('k', TTL, LIMIT, BLOCK, 'default');

    expect(record.totalHits).toBe(6);
  });

  describe('reporting a block', () => {
    // What is in TypeScript is the half after the statement: that the reporter is
    // told when, and only when, the row says this call set the block. That the
    // statement says so once per block and never during one is a property of the
    // SQL, asserted against a real Postgres in `tests/integration/docker.test.mjs`.
    it('tells the reporter, with the key and the retry window in seconds, when the row says this call engaged the block', async () => {
      const reported: [string, number][] = [];
      const { storage } = stub(rowIn(TTL, BLOCK, LIMIT + 1, true), (key, seconds) => {
        reported.push([key, seconds]);
      });

      await storage.increment('k', TTL, LIMIT, BLOCK, 'default');

      expect(reported.map(([key]) => key)).toEqual(['k']);
      expect(reported[0][1]).toBeLessThanOrEqual(BLOCK / 1000);
      expect(reported[0][1]).toBeGreaterThan(BLOCK / 1000 - 5);
    });

    it('stays silent for a refusal during a block that an earlier call set', async () => {
      const reported: string[] = [];
      const { storage } = stub(rowIn(TTL, BLOCK, LIMIT + 1, false), (key) => {
        reported.push(key);
      });

      for (let attempt = 0; attempt <= LIMIT + 3; attempt += 1) {
        await storage.increment('k', TTL, LIMIT, BLOCK, 'default');
      }

      expect(reported).toEqual([]);
    });

    it('stays silent for an attempt inside the budget', async () => {
      const reported: string[] = [];
      const { storage } = stub(rowIn(TTL, null, 1, false), (key) => {
        reported.push(key);
      });

      await storage.increment('k', TTL, LIMIT, BLOCK, 'default');

      expect(reported).toEqual([]);
    });

    it('lets the request proceed when the block could not be recorded', async () => {
      const { storage } = stub(
        rowIn(TTL, BLOCK, LIMIT + 1, true),
        () => Promise.reject(new Error('audit unwritable')),
      );
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const record = await storage.increment('k', TTL, LIMIT, BLOCK, 'default');

      // The refusal is already correct; a failed entry must not become a 500.
      expect(record.isBlocked).toBe(true);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('audit unwritable'));
      logged.mockRestore();
    });
  });
});
