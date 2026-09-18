import { FindOperator } from 'typeorm';

/** A stored row. Plain data — no entity instance, no metadata, no decorators. */
type Row = Record<string, unknown>;

/** Anything a row can be matched against: a value, or one of TypeORM's operators. */
type Criteria = Record<string, unknown>;

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
 * What it does **not** model is everything else a database does — no SQL, no
 * constraints, no isolation beyond the row lock. It is not evidence that
 * Postgres behaves this way; the task report records a separate run against a
 * real Postgres 16 for that. It is evidence that *this implementation asks for
 * the lock*, which is the half a unit test can own.
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
   * Runs `work` with a manager whose locks are released when it returns.
   *
   * Release happens in a `finally`, so a transaction that throws — which the
   * reuse branch does, every time it fires — does not leave the row locked for
   * ever and hang every later test in the file.
   */
  public async transaction<T>(work: (manager: FakeEntityManager) => Promise<T>): Promise<T> {
    const held: (() => void)[] = [];
    try {
      return await work(new FakeEntityManager(this, held));
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
        return this.match(entity, options.where)[0] ?? null;
      },
      find: async (options) => {
        await yieldTurn();
        return this.match(entity, options?.where ?? {});
      },
      findAndCount: async (options) => {
        await yieldTurn();
        const found = this.match(entity, options?.where ?? {});
        return [found, found.length];
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
        const doomed = this.match(entity, criteria);
        this.tables.set(entity.name, this.all(entity).filter((row) => !doomed.includes(row)));
        return { affected: doomed.length };
      },
      create: (values) => ({ ...values }),
      save: async (values) => {
        await yieldTurn();
        return this.insert(entity, values).identifiers[0];
      },
    };
  }

  /** Every row of `entity` matching `criteria`. */
  public match(entity: EntityClass, criteria: Criteria): Row[] {
    return this.all(entity).filter((row) => matches(row, criteria));
  }

  /** Inserts a row, assigning an id, and answers the way TypeORM's `insert` does. */
  public insert(entity: EntityClass, values: Row): { identifiers: { id: string }[] } {
    const id = `fake-${entity.name}-${this.nextId++}`;
    const row: Row = { ...values, id };
    this.tables.set(entity.name, [...this.all(entity), row]);
    return { identifiers: [{ id }] };
  }

  /** Applies `patch` to every row matching `criteria`; answers how many it changed. */
  public update(entity: EntityClass, criteria: Criteria, patch: Row): number {
    let changed = 0;
    for (const row of this.all(entity)) {
      if (!matches(row, criteria)) continue;
      Object.assign(row, patch);
      changed += 1;
    }
    return changed;
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
  findOne(options: { where: Criteria }): Promise<Row | null>;
  find(options?: { where?: Criteria }): Promise<Row[]>;
  findAndCount(options?: { where?: Criteria }): Promise<[Row[], number]>;
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
  ) {}

  public async findOne(
    entity: EntityClass,
    options: { where: Criteria; lock?: { mode: string } },
  ): Promise<Row | null> {
    // Yield BEFORE reading. This is what lets a second transaction interleave,
    // and so what makes the concurrency assertion in D8 able to fail at all.
    await yieldTurn();

    const found = this.source.match(entity, options.where)[0] ?? null;
    if (options.lock?.mode !== 'pessimistic_write' || found === null) return found;

    this.source.lockedRows.push(`${entity.name}:${String(found.id)}`);
    if (!this.source.honoursLocks) return found;

    await this.source.lockRow(`${entity.name}:${String(found.id)}`, this.held);

    // Re-read now the lock is ours. `SELECT ... FOR UPDATE` under READ COMMITTED
    // re-evaluates the row after the lock is granted, so the waiter sees what the
    // winner committed rather than the snapshot it took before waiting. A fake
    // that returned `found` here would hide exactly the bug the lock prevents.
    return this.source.match(entity, options.where)[0] ?? null;
  }

  public async find(entity: EntityClass, options: { where: Criteria }): Promise<Row[]> {
    await yieldTurn();
    return this.source.match(entity, options.where);
  }

  public async insert(
    entity: EntityClass,
    values: Row,
  ): Promise<{ identifiers: { id: string }[] }> {
    await yieldTurn();
    return this.source.insert(entity, values);
  }

  public async update(
    entity: EntityClass,
    criteria: Criteria,
    patch: Row,
  ): Promise<{ affected: number }> {
    await yieldTurn();
    return { affected: this.source.update(entity, criteria, patch) };
  }
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

/** One turn of the event loop, so concurrent callers actually interleave. */
function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
