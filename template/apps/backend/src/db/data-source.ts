import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * The TypeORM CLI's data source — `migration:generate`, `migration:run`,
 * `migration:revert`. Never the running application, which builds its own
 * connection in `app.module.ts`.
 *
 * ## Why this one connects as the owner
 *
 * Migrations create tables, so they run as the role that owns the schema — the
 * one the Postgres image creates. The application connects as a second,
 * restricted role that owns nothing, which is what lets `audit_entries` have
 * `UPDATE` and `DELETE` revoked from it in a way the application cannot undo.
 * Two connection strings is how those two roles stay apart; see
 * `migrations/1758000000000-AppRoleAndDefaultPrivileges.ts` for the whole
 * argument, and discriminating test D13 for what it buys.
 *
 * The fallback to `DATABASE_URL` is deliberate. A deployment that has not
 * adopted two roles — an existing one, or someone trying the template out —
 * still runs its migrations; it simply runs them as whoever `DATABASE_URL` is,
 * and gets no D13 guarantee because the application and the migrator are then
 * the same role. A generated project that could not migrate at all would be the
 * worse failure. Nothing here warns about it, because a warning on every
 * migration run is a warning nobody reads; `compose.prod.yaml` closes the gap
 * where it matters by requiring `MIGRATION_DATABASE_URL` outright.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  // Resolved against this file, not against the working directory.
  //
  // These were `'src/**/*.entity.ts'` and `'src/db/migrations/*.ts'`, which are
  // relative to `process.cwd()` and only ever matched anything in development.
  // The production image ships `apps/backend/dist` and no `src/` at all, and
  // `migration:run:prod` loads this file from
  // `dist/apps/backend/src/db/data-source.js` — so those globs matched nothing,
  // and TypeORM printed `No migrations are pending` and exited 0. Reproduced:
  // with the old globs and `src/` removed, the `migrate` service reports
  // success, `backend` starts on `service_completed_successfully`, and the
  // database contains nothing but TypeORM's own ledger table. That was
  // invisible for exactly as long as there were no migrations to apply.
  //
  // `{.ts,.js}` is one path for both ts-node and plain node. It also matches
  // the `.d.ts` files `tsc` emits beside every module here, which turns out not
  // to matter: TypeORM's own directory loader discards anything ending in
  // `.d.ts` before requiring it. Checked, because the alternative — picking the
  // extension from `__filename` — is the kind of cleverness that survives in a
  // codebase long after the reason for it has been disproved.
  entities: [`${__dirname}/../**/*.entity{.ts,.js}`],
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],
  synchronize: false,
});
