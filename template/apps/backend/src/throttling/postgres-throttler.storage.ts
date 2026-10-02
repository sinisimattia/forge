import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * What the library's one method promises to answer with.
 *
 * `@nestjs/throttler`'s entry point re-exports `ThrottlerStorage` but not the
 * record type that interface returns, so there is no name to import. Derived
 * from the interface rather than deep-imported from the published `dist`: the
 * alias then cannot drift from what the library actually requires, and nothing
 * here depends on the shape of a build directory.
 */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Finished windows, across the table and not merely the key in hand.
 *
 * The sweep runs on the write path, so a subject that stops being attempted is
 * never revisited by its own increment; a sweep narrowed to the key being
 * written would leave every abandoned window in the table for ever. Cheap
 * because of `ix_rate_limit_counters_expires_at`. A sweep on a path nothing
 * calls is a sweep nobody notices has stopped, which is why it is here rather
 * than on a schedule.
 *
 * A row whose window has ended but whose block has not is left alone: deleting
 * it would release the subject early, which is the opposite of what the block
 * is for.
 *
 * Exported so that anything asserting this behaviour against a real Postgres
 * executes this exact text rather than a retyped copy of it — a copy would be a
 * second place the behaviour lives, and the test would stay green while this
 * one changed.
 */
export const SWEEP_FINISHED_WINDOWS = `DELETE FROM rate_limit_counters
      WHERE expires_at <= now()
        AND (blocked_until IS NULL OR blocked_until <= now())`;

/**
 * One attempt against one subject, decided in one statement.
 *
 * Two processes arriving together cannot both read a stale count and both
 * decide they are under the limit: the second `ON CONFLICT` update sees the
 * first one's row. A read followed by a write would have exactly that race, and
 * it would open only under the concurrency an attacker is the most likely party
 * to produce.
 *
 * The `CASE` arms are ordered, and the order is the behaviour. Every one of the
 * three columns asks "is this subject blocked right now" **before** it asks
 * "has the window ended", so a block outlives the window it was set in. An
 * earlier draft led with the window, and wherever a block is configured no
 * longer than its window — which is the ordinary shape of a sign-in budget — a
 * subject that tripped the limit late in a window had the refusal erased moments
 * later by the rollover: the rate bound survived, since a fresh window still
 * permits only the limit, but `blockDuration` was decorative and any promise of
 * a retry window was false. **Nothing in this repository would catch a
 * reordering back:** the arms are evaluated by Postgres, and
 * `__tests__/postgres-throttler.storage.spec.ts` sets out in its own header why
 * no in-process double can stand in for one. Keep the order.
 *
 * `engaged` is true on the one call that set the block. A block is only ever
 * written by the final arm of `blocked_until`, as `now() + $4`, and `now()` is
 * the transaction's start — the same instant for every expression in this
 * statement — so a row carrying exactly that value was written by this call. An
 * attempt that finds a block already running leaves the stored instant alone,
 * which is an earlier one. No second read, and no comparison made in this
 * process after the fact, is needed to tell the two apart; either would be a
 * race between two replicas.
 *
 * `$2` and `$4` are milliseconds, which is the unit the library passes and the
 * unit `interval '1 millisecond'` multiplies.
 *
 * Exported for the same reason as {@link SWEEP_FINISHED_WINDOWS}.
 */
export const RECORD_ONE_ATTEMPT = `INSERT INTO rate_limit_counters AS c (key, hits, expires_at, blocked_until)
       VALUES ($1, 1, now() + $2::double precision * interval '1 millisecond', NULL)
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE
           WHEN c.blocked_until IS NOT NULL AND c.blocked_until >  now() THEN c.hits
           WHEN c.blocked_until IS NOT NULL AND c.blocked_until <= now() THEN 1
           WHEN c.expires_at <= now() THEN 1
           ELSE c.hits + 1
         END,
         expires_at = CASE
           WHEN c.blocked_until IS NOT NULL AND c.blocked_until >  now() THEN c.expires_at
           WHEN c.blocked_until IS NOT NULL AND c.blocked_until <= now()
             THEN now() + $2::double precision * interval '1 millisecond'
           WHEN c.expires_at <= now()
             THEN now() + $2::double precision * interval '1 millisecond'
           ELSE c.expires_at
         END,
         blocked_until = CASE
           WHEN c.blocked_until IS NOT NULL AND c.blocked_until >  now() THEN c.blocked_until
           WHEN c.blocked_until IS NOT NULL AND c.blocked_until <= now() THEN NULL
           WHEN c.expires_at <= now() THEN NULL
           WHEN c.hits + 1 > $3
             THEN now() + $4::double precision * interval '1 millisecond'
           ELSE NULL
         END
       RETURNING hits, expires_at, blocked_until,
         (c.blocked_until IS NOT NULL
           AND c.blocked_until > now()
           AND c.blocked_until = now() + $4::double precision * interval '1 millisecond') AS engaged`;

/**
 * Told, once per block, that a subject has just been blocked.
 *
 * Passed to the storage rather than read back from it afterwards: a value left
 * on the instance and read after an `await` would belong to whichever call
 * finished last, and this class exists for several processes calling it at once.
 *
 * @param key - the counter key the block was set on, as the storage was given it
 * @param retryAfterSeconds - how long the block lasts, in seconds
 */
export type ThrottleBlockReporter
  = (key: string, retryAfterSeconds: number) => void | Promise<void>;

/** Injection token for the {@link ThrottleBlockReporter} a deployment wires in. */
export const THROTTLE_BLOCK_REPORTER = Symbol('THROTTLE_BLOCK_REPORTER');

/**
 * The throttler's counters, in the database rather than in this process.
 *
 * ## Why the bundled store is not used
 *
 * It is a map in the process. With one instance it is correct. With several,
 * each keeps its own counters, so the effective limit becomes the configured
 * one multiplied by the number of instances — and nothing reports it, because a
 * single-process test suite cannot observe a disagreement between processes. A
 * limit that quietly is not the limit is the whole reason this class exists,
 * and it is why the test that matters most for it opens two connections rather
 * than calling this class twice.
 *
 * ## One deliberate difference from the bundled store
 *
 * The bundled store gives every hit its own expiry, which makes it a sliding
 * window. This one expires a subject's hits together: a fixed window. The cost
 * is a burst across a window boundary, bounded above by twice the limit, which
 * is nothing against the kind of guessing these budgets exist to stop. The gain
 * is one row and one statement per subject rather than a row per attempt.
 * Recorded here because somebody reading the library's documentation alongside
 * this class will otherwise read the difference as a defect.
 *
 * A block is **not** such a difference: it survives the rollover of the window
 * it was set in, as it does in the bundled store, whose own eviction skips a
 * record whose block has not expired. {@link RECORD_ONE_ATTEMPT} says what the
 * `CASE` ordering that arranges that is holding up.
 *
 * ## Units, which are not what the parameter names suggest
 *
 * `ttl` and `blockDuration` arrive in **milliseconds**. `timeToExpire` and
 * `timeToBlockExpire` are returned in **seconds** — the bundled store divides
 * and rounds up, and the guard's retry header is built from them. Returning
 * milliseconds would tell every refused caller to wait a thousand times too
 * long, and no test of this class's own arithmetic would notice.
 *
 * ## No repository, on purpose
 *
 * `RateLimitCounterRecord` maps the table so `app.module.ts`'s entity list stays
 * the whole truth, but nothing here injects a repository: the decision has to be
 * one statement,
 * and the entity API has no form for an upsert whose update reads the row it is
 * updating. Adding a `TypeOrmModule.forFeature` for that record would be wiring
 * nothing reads.
 */
@Injectable()
export class PostgresThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(PostgresThrottlerStorage.name);

  public constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(THROTTLE_BLOCK_REPORTER) private readonly onBlocked: ThrottleBlockReporter,
  ) {}

  /**
   * Records one attempt against `key` and says where that leaves it.
   *
   * A subject that is currently blocked is not counted further, matching the
   * bundled store: the block is the refusal, and counting during it would make
   * the recorded total a measure of the attacker's persistence rather than of
   * the budget.
   *
   * ## The reporter's rejection is swallowed, deliberately
   *
   * The reporter is told only on the call that sets the block, never on the calls
   * refused during it. It is awaited so that a rejection can be caught here, and
   * a rejection is logged and **not** propagated. The block is already stored
   * when the reporter runs, so the refusal is already correct; rethrowing would
   * turn a rightly refused request into a server error for the person being told
   * to wait, and would protect nothing further. A lost entry is the accepted
   * cost, and it is permanent, since a later attempt is not a transition. Do not
   * "fix" that by rethrowing.
   *
   * **This is the one place that catches an audit write and continues, and
   * `AuditService.record`'s own doc names it as the exception rather than
   * leaving the two to be reconciled by whoever reads only one.** The rule there
   * holds everywhere the entry and the action it describes are still bound
   * together; here the action is already taken, and taken the safe way.
   *
   * @param key - bucket and subject, composed by the guard's tracker and opaque here
   * @param ttl - the window, in milliseconds
   * @param limit - attempts permitted in a window; the block is set on the attempt after it
   * @param blockDuration - how long a refusal is meant to last, in milliseconds
   * @param _throttlerName - which configured throttler asked; deliberately unread, because
   *   the bucket's identity is already inside `key` and reading it here would be a second,
   *   disagreeable opinion about what distinguishes one counter from another
   * @returns the library's record, with both durations in **seconds**
   */
  public async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- deliberately unread; see the `@param`
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    await this.dataSource.query(SWEEP_FINISHED_WINDOWS);

    const rows: { hits: number; expires_at: Date; blocked_until: Date | null; engaged: boolean }[]
      = await this.dataSource.query(RECORD_ONE_ATTEMPT, [key, ttl, limit, blockDuration]);

    const [row] = rows;
    // One instant for the whole record, read after the statement returned, so
    // the two durations below cannot disagree about when "now" was.
    const now = Date.now();
    const blockedUntil = row.blocked_until === null ? null : new Date(row.blocked_until).getTime();
    // The instant decides, not the column's presence: a row can carry a
    // `blocked_until` the database has already passed.
    const isBlocked = blockedUntil !== null && blockedUntil > now;
    const timeToBlockExpire = isBlocked ? Math.ceil((blockedUntil - now) / 1000) : 0;
    // Strictly `true`: a driver that handed back anything else is not a
    // statement from the database that this call set a block.
    if (row.engaged === true) {
      try {
        await this.onBlocked(key, timeToBlockExpire);
      } catch (error) {
        // The key is a digest of the bucket and the subject together; the
        // message is the cause only.
        this.logger.error(
          `A throttle block was set but could not be reported: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return {
      totalHits: Number(row.hits),
      timeToExpire: Math.ceil((new Date(row.expires_at).getTime() - now) / 1000),
      isBlocked,
      timeToBlockExpire,
    };
  }
}
