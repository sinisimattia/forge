import { LessThan } from 'typeorm';
import { FakeDataSource } from '../fake-data-source';

/**
 * The fake's own rollback, which nothing else can test.
 *
 * Every other spec in this backend uses `FakeDataSource` to assert something
 * about the code under test. This one asserts something about the fake, and it
 * exists because a fake that is *wrong* is worse than one that is merely
 * limited: a limitation shows up as a property nobody can assert, while a wrong
 * behaviour shows up as a real defect passing straight through a green suite.
 *
 * It was wrong in exactly that way. The undo restored a losing transaction's
 * pre-transaction value unconditionally, so rolling one transaction back
 * discarded a *later* transaction's committed write to the same key — the
 * whole-table form of that bug is what the journal was added to fix, and it
 * survived at key granularity.
 *
 * The limits this fake genuinely cannot express are listed on the class itself
 * and are not tested here, because they cannot be. They need a real database.
 */

/** A table with one row, which every test here perturbs. */
const ROWS = { name: 'Perturbable' };

describe('FakeDataSource rollback', () => {
  let source: FakeDataSource;

  beforeEach(() => {
    source = new FakeDataSource();
    source.seed(ROWS, [{ id: 'r1', a: 'A0', b: 'B0' }]);
  });

  const row = (): Record<string, unknown> => source.byId(ROWS, 'r1')!;

  it('undoes what a failed transaction wrote', async () => {
    await expect(
      source.transaction(async (manager) => {
        await manager.update(ROWS, { id: 'r1' }, { a: 'A_MINE' });
        throw new Error('this transaction fails after writing');
      }),
    ).rejects.toThrow();

    expect(row().a).toBe('A0');
  });

  it('keeps what a successful transaction wrote', async () => {
    // The other direction, so "undo everything always" cannot satisfy the test
    // above.
    await source.transaction(async (manager) => {
      await manager.update(ROWS, { id: 'r1' }, { a: 'A_MINE' });
    });

    expect(row().a).toBe('A_MINE');
  });

  it('removes a row a failed transaction inserted', async () => {
    await expect(
      source.transaction(async (manager) => {
        await manager.insert(ROWS, { a: 'inserted' });
        throw new Error('this transaction fails after inserting');
      }),
    ).rejects.toThrow();

    expect(source.all(ROWS)).toHaveLength(1);
  });

  // `OrganizationsService.removeMember` needs `manager.delete` inside a
  // transaction — the one thing this fake compile-errored on before, by design (see
  // this class's own "what this double cannot express" list). Adding it
  // without a test of its OWN rollback would repeat exactly the mistake this
  // file's header describes: `update`'s undo was wrong at key granularity for
  // a long time because nothing threw AFTER a write inside a transaction that
  // also had another transaction committing around it, and in `removeMember`
  // itself the only throw point (`LastOwnerError`) always precedes the delete
  // — so no test anywhere else in this backend ever throws after a delete
  // inside a transaction. This is the one that does.
  it('restores a row a failed transaction deleted', async () => {
    await expect(
      source.transaction(async (manager) => {
        await manager.delete(ROWS, { id: 'r1' });
        throw new Error('this transaction fails after deleting');
      }),
    ).rejects.toThrow();

    // Not just present — restored WHOLE. An undo that re-inserted a row with
    // only its id, or with a stale copy from before some other change, would
    // satisfy a weaker assertion than this one while still being wrong.
    expect(row()).toEqual({ id: 'r1', a: 'A0', b: 'B0' });
  });

  it('keeps a row a successful transaction deleted', async () => {
    // The other direction, so "undo every delete always" cannot satisfy the
    // test above.
    await source.transaction(async (manager) => {
      await manager.delete(ROWS, { id: 'r1' });
    });

    expect(source.byId(ROWS, 'r1')).toBeUndefined();
  });

  it('leaves a key another transaction changed alone', async () => {
    // A DIFFERENT key. This was always correct and is kept so the same-key case
    // below is visibly the interesting one rather than the only one.
    await expect(
      source.transaction(async (manager) => {
        await manager.update(ROWS, { id: 'r1' }, { a: 'A_MINE' });
        await source.transaction(async (other) => {
          await other.update(ROWS, { id: 'r1' }, { b: 'B_WINNER' });
        });
        throw new Error('this transaction fails');
      }),
    ).rejects.toThrow();

    expect(row()).toMatchObject({ a: 'A0', b: 'B_WINNER' });
  });

  it('does not overwrite a LATER writer to the same key when it rolls back', async () => {
    // The bug. The loser's undo used to restore its own pre-transaction value
    // over a key somebody else had since committed, so rolling back one
    // transaction discarded another's write — the fake reporting a state no
    // database would produce, in the direction most likely to hide a defect.
    await expect(
      source.transaction(async (manager) => {
        await manager.update(ROWS, { id: 'r1' }, { a: 'A_LOSER' });
        await source.transaction(async (other) => {
          await other.update(ROWS, { id: 'r1' }, { a: 'A_WINNER' });
        });
        throw new Error('this transaction fails after somebody else committed');
      }),
    ).rejects.toThrow();

    // The winner's value survives. Postgres would have made the winner wait
    // rather than letting both through — the mechanism differs and the outcome
    // does not, which is the most this double can honestly claim.
    expect(row().a).toBe('A_WINNER');
  });

  it('undoes writes in reverse, so two writes to one key restore the original', async () => {
    await expect(
      source.transaction(async (manager) => {
        await manager.update(ROWS, { id: 'r1' }, { a: 'A_FIRST' });
        await manager.update(ROWS, { id: 'r1' }, { a: 'A_SECOND' });
        throw new Error('this transaction fails after writing twice');
      }),
    ).rejects.toThrow();

    expect(row().a).toBe('A0');
  });

  it('does not journal a write made through a repository rather than the manager', async () => {
    // Faithful rather than an oversight: a repository taken from the DataSource
    // runs on its own query runner in real TypeORM and is not part of a
    // transaction somebody else opened. Pinned so that the day it stops being
    // true, it is a decision and not a surprise.
    const repo = source.getRepository(ROWS);

    await expect(
      source.transaction(async () => {
        await repo.update({ id: 'r1' }, { a: 'A_OUTSIDE' });
        throw new Error('this transaction fails');
      }),
    ).rejects.toThrow();

    expect(row().a).toBe('A_OUTSIDE');
  });
});

/**
 * `LessThan`, which the double models for three kinds of column.
 *
 * - A `Date`, which is what the sessions, challenges and OAuth requests compare.
 * - A `bigint`, which the Postgres driver returns as a **string** and SQL
 *   compares as a number — `'9' < '10'` is false as text and true as a number.
 *   `mfa_methods.totp_last_step` is one.
 * - A `NULL`, which is neither less nor greater than anything: `NULL < x` is not
 *   true, so a row holding one never matches.
 *
 * The NULL case is **not reachable from any caller today**: the one caller that
 * compares a nullable column, `MfaVerificationService.claimStep`, runs its
 * `IsNull()` statement first and only reaches `LessThan` for rows that are not
 * null. The branch exists so that the next caller does not inherit a double
 * that answers `NULL < x` with a `TypeError` or, worse, with `0 < x` — and it is
 * tested for the same reason, because an unexercised branch in the double every
 * backend spec leans on is an accident waiting for a caller.
 */
describe('FakeDataSource LessThan', () => {
  const TABLE = { name: 'Comparable' };
  let source: FakeDataSource;

  beforeEach(() => {
    source = new FakeDataSource();
  });

  const idsBelow = (column: string, bound: unknown): string[] =>
    source.match(TABLE, { [column]: LessThan(bound) }).map((row) => String(row.id));

  it('compares a bigint held as a string as a number, not as text', () => {
    source.seed(TABLE, [
      { id: 'nine', step: '9' },
      { id: 'ten', step: '10' },
      { id: 'hundred', step: '100' },
    ]);

    // As text '10' < '9', so a text comparison would answer differently here.
    expect(idsBelow('step', '10')).toEqual(['nine']);
    expect(idsBelow('step', '101')).toEqual(['nine', 'ten', 'hundred']);
    expect(idsBelow('step', '9')).toEqual([]);
  });

  it('never matches a NULL, or a missing value', () => {
    source.seed(TABLE, [
      { id: 'null', step: null },
      { id: 'missing' },
      { id: 'three', step: '3' },
    ]);

    expect(idsBelow('step', '1000')).toEqual(['three']);
  });

  it('compares Dates by instant', () => {
    source.seed(TABLE, [
      { id: 'early', at: new Date('2026-01-01T00:00:00Z') },
      { id: 'late', at: new Date('2026-03-01T00:00:00Z') },
    ]);

    expect(idsBelow('at', new Date('2026-02-01T00:00:00Z'))).toEqual(['early']);
    expect(idsBelow('at', new Date('2026-01-01T00:00:00Z'))).toEqual([]);
  });
});
