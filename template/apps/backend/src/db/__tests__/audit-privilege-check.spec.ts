import { MODULE_METADATA } from '@nestjs/common/constants';
import type { DataSource } from 'typeorm';
import { AuditModule } from '../../audit/audit.module';
import {
  AUDIT_TABLE,
  AuditPrivilegeCheck,
  OVER_PRIVILEGED_MESSAGE,
} from '../audit-privilege-check';

/**
 * # The startup privilege guard
 *
 * D13 — the audit log is append-only to the application — is arranged by two
 * migrations and by which connection string each service is given. Both compose
 * files get that right. **A deployment that is neither of them can get it wrong
 * silently**: `db/data-source.ts` falls back to `DATABASE_URL` when
 * `MIGRATION_DATABASE_URL` is unset, the application role then owns the table it
 * was supposed to be restricted on, and an owner can grant itself back anything
 * a migration revoked. Nothing fails and nothing logs.
 *
 * {@link AuditPrivilegeCheck} turns that from a property of the deployment into a
 * property of the process. This spec is what makes it a guard rather than a hope
 * — every assertion below corresponds to a way the guard could be written such
 * that it never fires:
 *
 * | Fault | Caught by |
 * |---|---|
 * | it asks about the wrong table or privilege | `asks the database about this table and this privilege` |
 * | it asks only `has_table_privilege`, so a column grant boots | `refuses to start when only a column of the table is writable` |
 * | it is written `=== true`, so `'t'`/`1`/`undefined` boot | `refuses to start on %s, rather than reading it as all clear` |
 * | the guard is dropped from `AuditModule` | `is registered by AuditModule, or it never runs at all` |
 * | the message stops naming the variable an operator must set | `names MIGRATION_DATABASE_URL` |
 *
 * `FakeDataSource` is deliberately not used: it answers domain queries, and what
 * is under test here is one literal SQL statement and what is done with its
 * answer.
 */
describe('AuditPrivilegeCheck', () => {
  /** A data source answering the privilege question with `answer`, recording the ask. */
  const stub = (answer: unknown): { dataSource: DataSource; calls: unknown[][] } => {
    const calls: unknown[][] = [];
    const dataSource = {
      query: (sql: string, params?: unknown[]) => {
        calls.push([sql, params]);
        return Promise.resolve(answer);
      },
    } as unknown as DataSource;
    return { dataSource, calls };
  };

  it('starts when the connection cannot update the audit table', async () => {
    const { dataSource } = stub([{ granted: false, wholeTable: false }]);
    const check = new AuditPrivilegeCheck(dataSource);

    await expect(check.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('refuses to start when the whole audit table is writable', async () => {
    const { dataSource } = stub([{ granted: true, wholeTable: true }]);

    const failure = new AuditPrivilegeCheck(dataSource).onApplicationBootstrap();

    await expect(failure).rejects.toThrow(OVER_PRIVILEGED_MESSAGE);
    await expect(failure).rejects.toThrow(`the whole of ${AUDIT_TABLE} is writable`);
  });

  /**
   * The state this guard did not see until a review found it.
   *
   * `GRANT UPDATE (action) ON audit_entries TO <app>` leaves
   * `has_table_privilege` reporting `f` while the role can run
   * `UPDATE audit_entries SET action = 'TAMPERED'` — the literal statement
   * D13 is about. The old check read only `has_table_privilege`, so
   * the process booted. Nothing in this template issues a column grant, which is
   * exactly why nothing would have found this by accident.
   */
  it('refuses to start when only a column of the table is writable', async () => {
    const { dataSource } = stub([{ granted: true, wholeTable: false }]);

    const failure = new AuditPrivilegeCheck(dataSource).onApplicationBootstrap();

    await expect(failure).rejects.toThrow(OVER_PRIVILEGED_MESSAGE);
    await expect(failure).rejects.toThrow('column-level UPDATE grant');
  });

  it.each([
    ['an empty result', []],
    ['a row with no such column', [{}]],
    ['a string the driver did not coerce', [{ granted: 't' }]],
    ['a number the driver did not coerce', [{ granted: 1 }]],
  ])('refuses to start on %s, rather than reading it as all clear', async (_name, answer) => {
    const { dataSource } = stub(answer);

    await expect(new AuditPrivilegeCheck(dataSource).onApplicationBootstrap()).rejects.toThrow(
      OVER_PRIVILEGED_MESSAGE,
    );
  });

  it('asks the database about this table and this privilege, in one query', async () => {
    const { dataSource, calls } = stub([{ granted: false, wholeTable: false }]);

    await new AuditPrivilegeCheck(dataSource).onApplicationBootstrap();

    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0] as [string, unknown[]];
    // `has_any_column_privilege` is the one that decides; `has_table_privilege`
    // only tells the operator which mistake they made. Asserting both means a
    // silent swap back to the table-only question fails here.
    expect(sql).toContain('has_any_column_privilege');
    expect(sql).toContain('has_table_privilege');
    expect(sql).toContain('current_user');
    expect(sql).toContain('\'UPDATE\'');
    // The table arrives as a bind parameter, not spliced into the text.
    expect(params).toEqual([AUDIT_TABLE]);
    expect(AUDIT_TABLE).toBe('audit_entries');
  });

  it('names MIGRATION_DATABASE_URL, which is the variable an operator has to set', () => {
    expect(OVER_PRIVILEGED_MESSAGE).toContain('MIGRATION_DATABASE_URL');
  });

  it('is registered by AuditModule, or it never runs at all', () => {
    const providers: unknown[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuditModule) ?? [];

    expect(providers).toContain(AuditPrivilegeCheck);
  });
});
