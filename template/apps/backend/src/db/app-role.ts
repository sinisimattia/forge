/**
 * The application database role, as the migrations that name it read it.
 *
 * Two migrations need this value — the one that creates the role and the one
 * that revokes `UPDATE`/`DELETE` on `audit_entries` from it — and they must
 * agree on it exactly: a mismatch would create one role and harden another,
 * leaving the running application with unrestricted access to the audit table
 * and nothing failing to say so. Reading and validating it in one place is what
 * makes that disagreement impossible rather than unlikely.
 *
 * The usual objection to a migration importing shared code is that a migration
 * is a snapshot of history and shared code drifts underneath it. That applies
 * to schema-shaping helpers; it does not apply here. This module answers "which
 * role is this deployment's application role", which is a fact about the
 * deployment reading the migration, not about the day it was written — if the
 * answer changes, both migrations must change with it, which is the behaviour
 * this module produces and duplicated copies would not.
 */

/**
 * Role names this project is willing to put into SQL.
 *
 * Every identifier interpolation still goes through `format('%I')`, which
 * quotes and escapes correctly on its own, so this regex is not the injection
 * defence — it is the readable statement of what a role name may be, failing at
 * configuration-reading time with a message naming the variable rather than
 * somewhere deep in a Postgres syntax error.
 *
 * Hyphens are allowed because they are required: the generator's own project
 * names are `/^[a-z][a-z0-9-]*$/` (`tools/create/args.mjs`) and the compose
 * files name the application role after the project with an `-app` suffix — so
 * a project called `blog` has the role `blog-app`, and one called `my-app` has
 * `my-app-app`.
 * A rule without the hyphen — which is what this task was first given — rejects
 * every role name the template produces. The 63-character ceiling
 * is Postgres's own identifier limit — the generator puts no length cap on a
 * project name, and a longer one would be silently truncated by the server,
 * producing a role whose name is not the name anything else was configured with.
 */
const ROLE_NAME_RE = /^[a-z_][a-z0-9_-]{0,62}$/;

/** Reads a required environment variable, or throws naming it. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. The application connects as a restricted database role that the `
      + 'migrations create; both its name and its password must be supplied by the '
      + 'environment. See compose.yaml for the development values and .env.example for the '
      + 'full contract.',
    );
  }
  return value;
}

/**
 * The name of the restricted role the application connects as.
 *
 * @returns the configured role name
 * @throws Error when `APP_DB_ROLE` is unset, or is not a name this project will
 * interpolate into SQL
 */
export function requireAppRoleName(): string {
  const role = requireEnv('APP_DB_ROLE');
  if (!ROLE_NAME_RE.test(role)) {
    throw new Error(
      `APP_DB_ROLE ${JSON.stringify(role)} is not a usable role name. Use lowercase letters, `
      + 'digits, underscores and hyphens, starting with a letter or underscore, at most 63 '
      + 'characters (Postgres truncates anything longer).',
    );
  }
  return role;
}

/**
 * The password the application role is created with.
 *
 * Deliberately has no default. A default here would be a credential shipped in
 * every project generated from this template, known to everyone who has ever
 * read it — which is the failure ADR-0008 exists to prevent, arriving through
 * the database instead of through a third-party account.
 *
 * Not validated beyond being present, and that is safe only because of how the
 * one statement carrying it is built. `format('%L')` escapes any literal
 * correctly — a quote, a backslash, a newline — but only for the statement it
 * renders; it cannot escape anything *around* that statement. The `CREATE ROLE`
 * in `AppRoleAndDefaultPrivileges1758000000000` is therefore executed on its
 * own, with no enclosing dollar-quoted block, because a `$do$ … $do$` wrapper
 * ends at its tag regardless of the quoting inside it and a password containing
 * that tag broke out of it. **If a later migration ever puts a password back
 * inside a `DO` block or any other quoted wrapper, `%L` stops being enough and
 * this paragraph stops being true.**
 *
 * Given that, a rule about what a password may contain would only narrow the
 * set of good ones.
 *
 * @returns the configured password
 * @throws Error when `APP_DB_PASSWORD` is unset
 */
export function requireAppRolePassword(): string {
  return requireEnv('APP_DB_PASSWORD');
}
