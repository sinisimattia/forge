import { FindOperator } from 'typeorm';

/** A stored row. Plain data — no entity instance, no metadata, no decorators. */
type Row = Record<string, unknown>;

/** Anything a row can be matched against: a value, or one of TypeORM's operators. */
type Criteria = Record<string, unknown>;

/**
 * One criteria object, or several read as alternatives.
 *
 * TypeORM reads an array of `where` objects as a disjunction and a single object
 * as a conjunction, and this fake has to model both or a search filter written
 * as "this field OR that one" silently matches nothing here while working
 * against the real store.
 */
type Where = Criteria | Criteria[];

/** How a caller asks for a page: the same three options TypeORM takes. */
interface PageOptions {
  where?: Where;
  order?: Record<string, 'ASC' | 'DESC'>;
  skip?: number;
  take?: number;
}

/** The entity classes this fake is keyed by. */
type EntityClass = { name: string };

/**
 * An in-memory stand-in for a `DataSource`, **including its row-level locking**.
 *
 * ## Why a fake rather than a database
 *
 * The suite this exists for (`refresh-rotation.spec.ts`, D8) runs in the backend's
 * ordinary `jest` run, which is what the generated-project gate executes and what
 * a developer runs on a laptop. Neither has a Postgres. A suite that needed one
 * would be a suite that is skipped, and a skipped test asserting a security
 * property is worse than none, because the gate still reports green.
 *
 * ## What it models, and why that is the interesting part
 *
 * It would be easy to write a fake in which every operation is atomic, and such
 * a fake makes the concurrency assertion in D8 **unfailable**: with no way for
 * two transactions to interleave, two simultaneous rotations cannot both
 * succeed whether or not the implementation takes a lock. So this one models
 * exactly the two behaviours the real guarantee rests on:
 *
 * - **Reads yield.** Every `findOne`/`find` awaits a turn of the event loop
 *   before answering, so two concurrent transactions genuinely interleave. An
 *   implementation that reads a row, decides, and writes without holding a lock
 *   loses the race here just as it does in Postgres.
 * - **`pessimistic_write` is a real mutex, held to the end of the transaction,
 *   and the row is re-read after it is granted.** That is `SELECT ... FOR
 *   UPDATE` under `READ COMMITTED`: the waiter does not fail, it waits, and
 *   then sees what the winner committed.
 *
 * What it does **not** model is everything else a database does. It is not
 * evidence that Postgres behaves any particular way; the task report records a
 * separate run against a real Postgres 16 for that. It is evidence that *this
 * implementation asks for the lock*, which is the half a unit test can own.
 *
 * ## Properties this double CANNOT express
 *
 * Written out rather than left to be discovered, because the failure mode of an
 * undocumented limit is a test that passes for a reason its author never
 * intended — and a property asserted only here is a property nothing checks.
 * Anything in this list needs a real database (the docker end-to-end suite
 * stands one up); do not
 * reach for this fake to prove it.
 *
 * 1. **Isolation.** A concurrent reader sees this transaction's uncommitted
 *    writes — a dirty read, which no isolation level permits. "A reader never
 *    sees a half-done change" is unfalsifiable here.
 * 2. **Blocking.** Two writers to one row both proceed; Postgres makes the
 *    second wait. The rollback declines to overwrite a later writer (see
 *    `update`), which gets the outcome right and the mechanism wrong.
 * 3. **Audit immutability.** This fake will happily `update` and `delete` an
 *    `audit_entries` row. The revoked `UPDATE`/`DELETE` privilege is a grant in
 *    a migration, and it is the premise several comments in this backend lean on
 *    — including `changePasswordAndReissue`'s. **Nothing in this suite asserts
 *    it.** It is the most load-bearing item on this list.
 * 4. **Unique constraints.** None, anywhere. Duplicate registration under a race
 *    and one-password-identity-per-user cannot fail here; `register`'s
 *    `23505` branch is reached only by a test that throws the error itself.
 * 5. **Schema and column checking.** A property with no column behind it is
 *    stored and read back. Entity-versus-migration drift is invisible.
 * 6. **`ILIKE` semantics.** `%` is modelled; `_` is a single-character wildcard
 *    in SQL and a literal here. `UsersService.listUsers` passes a caller's text
 *    straight into `ILIKE '%…%'`, so a search containing `_` or `%` behaves
 *    differently in production than in every test on this fake.
 * 7. **`NOT NULL`, foreign keys, cascades and column defaults.** All absent. A
 *    row referencing a user that does not exist is fine here.
 * 8. **Tie ordering.** `sortRows` is a stable JS sort, so two audit entries
 *    sharing an instant page deterministically here while Postgres gives no
 *    order for a tie without a tie-break key. `AuditService.query` supplies one
 *    (`id DESC`); a future query that forgets to would look correct here.
 * 9. **An isolation level.** `transaction()` accepts one as an optional first
 *    argument — real `DataSource.transaction` does, and `OrganizationsService`
 *    passes `'SERIALIZABLE'` for the last-owner check — and this fake
 *    reads it only to discard it. Nothing here can make two concurrent
 *    transactions conflict the way Postgres does under `SERIALIZABLE`; a test
 *    that seeds two owners and demotes both concurrently would find both
 *    succeed on this double whatever isolation level was asked for, same
 *    reason as (1). What this fake *can* still show, single-threaded, is that
 *    the count is read and compared before the write commits — see
 *    `organizations.service.spec.ts`'s `LastOwnerError` cases.
 */
export class FakeDataSource {
  private readonly tables = new Map<string, Row[]>();

  /** Tail of the wait queue per locked row. Resolving it hands the lock on. */
  private readonly locks = new Map<string, Promise<void>>();

  private nextId = 1;

  /** Every `(entity, id)` a caller took a write lock on, in the order it took them. */
  public readonly lockedRows: string[] = [];

  /**
   * @param honourLocks - when `false`, `pessimistic_write` is accepted and then
   *   ignored: the read does not wait and does not re-read. That models a store
   *   that does not lock, and it is how a suite isolates whatever defence stands
   *   BEHIND the lock — two mechanisms that each hold a property on their own
   *   mean neither one is asserted by a test of the property alone.
   */
  public constructor(private readonly honourLocks = true) {}

  /** Whether `pessimistic_write` actually locks. See the constructor. */
  public get honoursLocks(): boolean {
    return this.honourLocks;
  }

  /** Puts rows in a table, as they would already exist when a test begins. */
  public seed(entity: EntityClass, rows: Row[]): void {
    this.tables.set(entity.name, [...(this.tables.get(entity.name) ?? []), ...rows]);
  }

  /** Every row in a table, for a test to assert against. */
  public all(entity: EntityClass): Row[] {
    return this.tables.get(entity.name) ?? [];
  }

  /** One row by id, or `undefined`. */
  public byId(entity: EntityClass, id: unknown): Row | undefined {
    return this.all(entity).find((row) => row.id === id);
  }

  /**
   * Runs `work` with a manager whose locks are released when it returns, and
   * **whose writes are undone if it throws**.
   *
   * Release happens in a `finally`, so a transaction that throws — which the
   * reuse branch does, every time it fires — does not leave the row locked for
   * ever and hang every later test in the file.
   *
   * ## Rollback, and why it is a journal rather than a snapshot
   *
   * Without rollback a fake cannot express atomicity at all, so "these two
   * writes happen together or not at all" is a property no test can fail —
   * which is how `AuthController.changePassword` came to replace a secret and
   * issue a session in two statements with nothing asserting that a failure
   * between them could not leave a caller both changed and signed out.
   *
   * The obvious implementation is a snapshot of every table before `work` and a
   * restore on throw, and it is wrong here: this fake runs transactions
   * concurrently on purpose (see the `honourLocks` constructor parameter), so a
   * loser restoring a snapshot it took before the winner committed would undo
   * the winner. A journal undoes only what *this* transaction wrote, in reverse,
   * which is what a real one does.
   *
   * What it does not model: isolation. A concurrent reader sees this
   * transaction's uncommitted writes, which no real isolation level permits.
   * That is the same limitation the lock modelling already has and is stated for
   * the same reason — the fake is evidence about what the implementation *asks
   * for*, never about what the database does.
   *
   * ## The isolation-level overload
   *
   * Mirrors `DataSource.transaction`'s two signatures so a caller can write
   * `dataSource.transaction('SERIALIZABLE', work)` against this fake exactly as
   * it would against the real one. The level is accepted and discarded — see
   * item 9 on this class's own list of what it cannot express.
   */
  public async transaction<T>(work: (manager: FakeEntityManager) => Promise<T>): Promise<T>;
  public async transaction<T>(
    isolationLevel: string,
    work: (manager: FakeEntityManager) => Promise<T>,
  ): Promise<T>;
  public async transaction<T>(
    isolationLevelOrWork: string | ((manager: FakeEntityManager) => Promise<T>),
    maybeWork?: (manager: FakeEntityManager) => Promise<T>,
  ): Promise<T> {
    const work = typeof isolationLevelOrWork === 'function' ? isolationLevelOrWork : maybeWork!;
    const held: (() => void)[] = [];
    const journal: (() => void)[] = [];
    try {
      return await work(new FakeEntityManager(this, held, journal));
    } catch (error) {
      for (const undo of journal.reverse()) undo();
      throw error;
    } finally {
      for (const release of held) release();
    }
  }

  /**
   * A stand-in for `Repository<T>` — the handle a service gets from
   * `@InjectRepository`, and what `DataSource.getRepository` answers with.
   *
   * Only the methods this backend actually calls exist. A fake that answered
   * every method of the real interface would be a fake nobody could tell had
   * drifted from what the code under test uses.
   */
  public getRepository(entity: EntityClass): FakeRepository {
    return {
      findOne: async (options) => {
        await yieldTurn();
        return detach(this.match(entity, options.where)[0] ?? null);
      },
      // Ordered, like `findAndCount` below and unlike this method as first
      // written. Dropping `order` here is not a harmless simplification: the
      // only caller that asks for one is `SessionService.listActive`, whose
      // whole promise is "newest first", and a fake that answered in insertion
      // order made that promise unfalsifiable — 392 tests passed over it. The
      // core conformance suite caught it on first contact, asserting that a
      // fresh sign-in comes back ahead of a session the world seeded earlier.
      find: async (options) => {
        await yieldTurn();
        const found = this.match(entity, options?.where ?? {});
        return sortRows(found, options?.order).map((one) => ({ ...one }));
      },
      findAndCount: async (options) => {
        await yieldTurn();
        // Ordered, then counted, then sliced — in that order, and every step
        // matters. Counting after the slice makes `meta.total` equal to the page
        // length, which is precisely the implementation bug a pagination test
        // exists to catch; a fake that ignored `skip`/`take` would return every
        // row on every page and make "page 2 is disjoint from page 1"
        // unfailable.
        const found = sortRows(this.match(entity, options?.where ?? {}), options?.order);
        const total = found.length;
        const from = options?.skip ?? 0;
        const to = options?.take === undefined ? undefined : from + options.take;
        return [found.slice(from, to).map((one) => ({ ...one })), total];
      },
      insert: async (values) => {
        await yieldTurn();
        return this.insert(entity, values);
      },
      update: async (criteria, patch) => {
        await yieldTurn();
        return { affected: this.update(entity, criteria, patch) };
      },
      delete: async (criteria) => {
        await yieldTurn();
        return { affected: this.delete(entity, criteria) };
      },
      create: (values) => ({ ...values }),
      save: async (values) => {
        await yieldTurn();
        return this.insert(entity, values).identifiers[0];
      },
    };
  }

  /**
   * Every row of `entity` matching `criteria`.
   *
   * An array of criteria is a disjunction, which is what TypeORM does with one.
   */
  public match(entity: EntityClass, criteria: Where): Row[] {
    const alternatives = Array.isArray(criteria) ? criteria : [criteria];
    return this.all(entity).filter((row) => alternatives.some((one) => matches(row, one)));
  }

  /**
   * Inserts a row, assigning an id, and answers the way TypeORM's `insert` does.
   *
   * @param journal - when a transaction is open, the undo for this write is
   *   appended to it. Absent outside one, exactly as a statement outside a
   *   transaction is not rolled back by anything.
   */
  public insert(
    entity: EntityClass,
    values: Row,
    journal?: (() => void)[],
  ): { identifiers: { id: string }[] } {
    const id = `fake-${entity.name}-${this.nextId++}`;
    const row: Row = { ...values, id };
    this.tables.set(entity.name, [...this.all(entity), row]);
    journal?.push(() => {
      this.tables.set(entity.name, this.all(entity).filter((held) => held !== row));
    });
    return { identifiers: [{ id }] };
  }

  /**
   * Applies `patch` to every row matching `criteria`; answers how many it changed.
   *
   * @param journal - see {@link FakeDataSource.insert}. The undo restores the
   *   previous value of exactly the keys this patch touched, on exactly the rows
   *   it matched, **and only where the current value is still the one this
   *   transaction wrote**.
   *
   *   That last condition is not fussiness. Without it a losing transaction's
   *   undo writes its own pre-transaction value over a key a *later* transaction
   *   has since set — so rolling back one transaction silently discards
   *   another's committed write. The journal was added to fix the whole-table
   *   form of exactly that bug and reproduced it at key granularity until this
   *   check was added; the doc here used to claim "a field another transaction
   *   changed is left alone", which was true only of a DIFFERENT key.
   *
   *   What this still is not: blocking. Postgres under READ COMMITTED makes the
   *   second writer wait for the first to finish; this fake lets both through
   *   and then declines to undo over the winner. The outcome for the shipped
   *   assertions is the same and the mechanism is not — see
   *   {@link FakeDataSource} for the full list of what this double cannot say.
   */
  public update(
    entity: EntityClass,
    criteria: Criteria,
    patch: Row,
    journal?: (() => void)[],
  ): number {
    let changed = 0;
    for (const row of this.all(entity)) {
      if (!matches(row, criteria)) continue;
      const before: Row = {};
      for (const key of Object.keys(patch)) before[key] = row[key];
      const written: Row = { ...patch };
      journal?.push(() => {
        for (const key of Object.keys(written)) {
          // Only where nothing has overwritten what this transaction wrote.
          if (row[key] === written[key]) row[key] = before[key];
        }
      });
      Object.assign(row, patch);
      changed += 1;
    }
    return changed;
  }

  /**
   * Removes every row matching `criteria`; answers how many it removed.
   *
   * Added for `OrganizationsService.removeMember`, whose write has to be the check-then-delete
   * half of the last-owner invariant, inside the same transaction as the owner
   * count — which is why this needed a journal at all: `getRepository().delete`
   * predates it and never ran inside a transaction.
   *
   * @param journal - see {@link FakeDataSource.insert}. The undo re-inserts
   *   exactly the rows this call removed, which is safe unconditionally (unlike
   *   {@link FakeDataSource.update}'s key-level check): nothing can have written
   *   to a row this transaction deleted, because a deleted row matches no
   *   `criteria` a later statement in the same run of this fake could supply.
   */
  public delete(entity: EntityClass, criteria: Criteria, journal?: (() => void)[]): number {
    const doomed = this.match(entity, criteria);
    this.tables.set(entity.name, this.all(entity).filter((row) => !doomed.includes(row)));
    journal?.push(() => {
      this.tables.set(entity.name, [...this.all(entity), ...doomed]);
    });
    return doomed.length;
  }

  /**
   * Takes the lock on one row, waiting behind whoever holds it.
   *
   * The queue is a promise chain: each waiter awaits the previous tail and
   * installs its own, so locks are granted in the order they were asked for and
   * a waiter is never skipped.
   */
  public async lockRow(key: string, held: (() => void)[]): Promise<void> {
    const ahead = this.locks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, ahead.then(() => mine));
    held.push(release);
    await ahead;
  }
}

/** The subset of `Repository<T>` this backend calls. See `FakeDataSource.getRepository`. */
export interface FakeRepository {
  findOne(options: { where: Where }): Promise<Row | null>;
  find(options?: { where?: Where; order?: Record<string, 'ASC' | 'DESC'> }): Promise<Row[]>;
  findAndCount(options?: PageOptions): Promise<[Row[], number]>;
  insert(values: Row): Promise<{ identifiers: { id: string }[] }>;
  update(criteria: Criteria, patch: Row): Promise<{ affected: number }>;
  delete(criteria: Criteria): Promise<{ affected: number }>;
  create(values: Row): Row;
  save(values: Row): Promise<{ id: string }>;
}

/** The manager handed to a transaction. Only the methods this backend calls exist. */
export class FakeEntityManager {
  public constructor(
    private readonly source: FakeDataSource,
    private readonly held: (() => void)[],
    private readonly journal: (() => void)[] = [],
  ) {}

  public async findOne(
    entity: EntityClass,
    options: { where: Criteria; lock?: { mode: string } },
  ): Promise<Row | null> {
    // Yield BEFORE reading. This is what lets a second transaction interleave,
    // and so what makes the concurrency assertion in D8 able to fail at all.
    await yieldTurn();

    const found = this.source.match(entity, options.where)[0] ?? null;
    if (options.lock?.mode !== 'pessimistic_write' || found === null) return detach(found);

    this.source.lockedRows.push(`${entity.name}:${String(found.id)}`);
    if (!this.source.honoursLocks) return found;

    await this.source.lockRow(`${entity.name}:${String(found.id)}`, this.held);

    // Re-read now the lock is ours. `SELECT ... FOR UPDATE` under READ COMMITTED
    // re-evaluates the row after the lock is granted, so the waiter sees what the
    // winner committed rather than the snapshot it took before waiting. A fake
    // that returned `found` here would hide exactly the bug the lock prevents.
    return detach(this.source.match(entity, options.where)[0] ?? null);
  }

  public async find(entity: EntityClass, options: { where: Where }): Promise<Row[]> {
    await yieldTurn();
    return this.source.match(entity, options.where).map((found) => ({ ...found }));
  }

  public async insert(
    entity: EntityClass,
    values: Row,
  ): Promise<{ identifiers: { id: string }[] }> {
    await yieldTurn();
    return this.source.insert(entity, values, this.journal);
  }

  public async update(
    entity: EntityClass,
    criteria: Criteria,
    patch: Row,
  ): Promise<{ affected: number }> {
    await yieldTurn();
    return { affected: this.source.update(entity, criteria, patch, this.journal) };
  }

  public async delete(
    entity: EntityClass,
    criteria: Criteria,
  ): Promise<{ affected: number }> {
    await yieldTurn();
    return { affected: this.source.delete(entity, criteria, this.journal) };
  }
}

/**
 * A copy of a stored row, which is what a read actually hands back.
 *
 * **A read returns a detached value, and modelling that is not pedantry.** The
 * stored rows are the objects `update` mutates in place, so a fake that handed
 * the live object to the code under test would let this sequence silently lie:
 *
 * ```
 * const before = await repo.findOne(...);   // the stored object itself
 * await repo.update(..., { status: NEW });  // mutates that same object
 * audit(before.status)                      // reads NEW — the value it recorded
 * ```
 *
 * against a real repository `before.status` is the old value, because the row
 * was hydrated into a separate object. That difference was found by a test that
 * asserted an audit entry carried both sides of a change: it failed here and
 * would have passed in production, which is the worst direction for a fake to be
 * wrong in.
 *
 * Shallow, because the rows this fake stores are flat. A nested value would be
 * shared, and the day one exists this needs to deepen.
 */
function detach(row: Row | null): Row | null {
  return row === null ? null : { ...row };
}

/** Whether one row satisfies every key of a criteria object. */
function matches(row: Row, criteria: Criteria): boolean {
  return Object.entries(criteria).every(([name, expected]) => {
    if (expected instanceof FindOperator) {
      const value = row[name];
      switch (expected.type) {
        case 'isNull':
          return value === null || value === undefined;
        case 'moreThan':
          return (value as Date).getTime() > (expected.value as Date).getTime();
        case 'lessThan':
          return (value as Date).getTime() < (expected.value as Date).getTime();
        case 'lessThanOrEqual':
          // Inclusive, which is what `AuditQuery.asOf` means: a bound taken from
          // an entry's own instant has to include that entry.
          return (value as Date).getTime() <= (expected.value as Date).getTime();
        case 'ilike': {
          // The real one is SQL `ILIKE`, whose only wildcards are `%` and `_`.
          // Only `%` is modelled, because only `%` is used; anything else would
          // be a fake that quietly accepts a pattern the database would not.
          const pattern = String(expected.value);
          const body = pattern.split('%').map(escapeForPattern).join('.*');
          return new RegExp(`^${body}$`, 'i').test(String(value));
        }
        case 'in':
          // `OrganizationsService.listOrganizations` reads `organizations`
          // narrowed to the ids a membership lookup produced — see that
          // method's own comment for why the narrowing is what makes the read
          // tenant-scoped. `[].includes` is the whole of SQL `IN (...)`'s
          // semantics for a plain value list, which is the only shape this
          // backend ever passes here.
          return (expected.value as unknown[]).includes(value);
        default:
          // Loudly, rather than by quietly matching everything: a criterion this
          // fake does not understand would otherwise silently widen a test's
          // world and make its assertions meaningless.
          throw new Error(`FakeDataSource does not model the "${expected.type}" operator`);
      }
    }
    return row[name] === expected;
  });
}

/** Escapes everything a regular expression would otherwise read as syntax. */
function escapeForPattern(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sorts a copy by the same multi-key order TypeORM takes.
 *
 * A copy, because the arrays this fake hands out are the stored rows themselves
 * and sorting in place would silently reorder the table for every later read.
 * Keys are applied in declaration order and the first difference wins, which is
 * what makes a tie-break key testable at all.
 */
function sortRows(rows: Row[], order?: Record<string, 'ASC' | 'DESC'>): Row[] {
  if (order === undefined) return rows;
  const keys = Object.entries(order);
  return [...rows].sort((left, right) => {
    for (const [key, direction] of keys) {
      const a = left[key];
      const b = right[key];
      const value = a instanceof Date && b instanceof Date
        ? a.getTime() - b.getTime()
        : String(a).localeCompare(String(b));
      if (value !== 0) return direction === 'DESC' ? -value : value;
    }
    return 0;
  });
}

/** One turn of the event loop, so concurrent callers actually interleave. */
function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
