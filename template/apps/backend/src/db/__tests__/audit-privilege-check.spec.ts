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
 * | the check asks about the wrong table or privilege | `asks the database exactly one question` |
 * | it is written `=== true` and a driver answers `'t'`/`1` | `refuses to start on …` |
 * | the guard is deleted from `AuditModule` | `AuditModule registers it` |
 * | the message stops naming the variable an operator has to set | `names MIGRATION_DATABASE_URL` |
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
    const { dataSource } = stub([{ granted: false }]);
    const check = new AuditPrivilegeCheck(dataSource);

    await expect(check.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('refuses to start when the connection can update the audit table', async () => {
    const { dataSource } = stub([{ granted: true }]);

    await expect(new AuditPrivilegeCheck(dataSource).onApplicationBootstrap()).rejects.toThrow(
      OVER_PRIVILEGED_MESSAGE,
    );
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

  it('asks the database exactly one question, about this table and this privilege', async () => {
    const { dataSource, calls } = stub([{ granted: false }]);

    await new AuditPrivilegeCheck(dataSource).onApplicationBootstrap();

    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0] as [string, unknown[]];
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
