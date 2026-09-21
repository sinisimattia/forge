# ADR-0009: Two Database Roles

- **Status:** Accepted
- **Date:** 2026-09-20
- **Relates to:** [ADR-0007](0007-tenancy-is-explicit-never-ambient.md)

## Context

`audit_entries` is the one table in this schema that nothing is allowed to correct. Every
other row in the database describes what is true now; an audit entry describes what
happened, and a record of what happened that can be edited afterwards is not a record, it
is a draft. Everything the audit log is for — reconstructing an incident, answering "who
changed this", surviving a dispute about it — rests on the entries being the ones that were
written.

An application can promise that in code. `AuditService` exposes `record` and `query` and
nothing else; no method anywhere updates or deletes an entry. But that promise holds only
for the code that exists today. A future handler, a migration, a repository method added in
a hurry, a `manager.update` aimed at the wrong entity, an ORM cascade nobody read — any of
these puts a statement in front of the database, and the database runs it. The promise is
worth exactly as much as the vigilance of everyone who ever touches the project.

A promise the database itself enforces is worth more, and it costs one extra role.

This is a Forge template default. Supersede it with a new ADR if this project needs
something different.

## Decision

**Migrations run as the schema owner. The application connects as a second role that owns
nothing, and `UPDATE` and `DELETE` on `audit_entries` are revoked from it.**

- `MIGRATION_DATABASE_URL` carries the owner. `DATABASE_URL` carries the application role.
  `src/db/data-source.ts` prefers the first and falls back to the second, so a deployment
  that has only one still migrates.
- The application role is created by the first migration, and
  `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES` gives it
  ordinary access to every table the owner creates afterwards.
- The audit migration then does the one thing that makes the guarantee:
  `REVOKE UPDATE, DELETE ON audit_entries FROM <the application role>`.
- A non-owner cannot grant a privilege back to itself, so this is not a rule the
  application can undo at runtime. It can still `INSERT` and `SELECT`, which is the whole
  of `IAuditService`.
- The backend refuses to serve over a connection that holds either privilege. That check is
  in `src/db/audit-privilege-check.ts` and it runs at start-up, so the guarantee is a
  property of the running process rather than of somebody's deployment configuration.

## What this ADR exists to stop you doing

Everything below was observed at PostgreSQL 16, not reasoned about. Each is a way to make
the revoke decorative while every test stays green and the schema still looks right.

### Never put a foreign key on `audit_entries`

Not "not `CASCADE`" — none at all. **A referential action executes with the table owner's
privileges, not the privileges of whoever ran the statement that triggered it.** So a
foreign key hands the application a route into the table through the *other* end of the
relationship:

| Foreign key on `actor_user_id` | What the application role could do |
|---|---|
| `ON DELETE CASCADE` | `UPDATE audit_entries` → `permission denied`. `DELETE FROM users` → the audit rows went with it. Count after: **0**. |
| `ON DELETE SET NULL` | Same refusal on the direct `UPDATE`; then deleting the user rewrote `actor_user_id` to `NULL` on the surviving row. Who did it is gone. |
| `NO ACTION` / `RESTRICT` | No rewrite — but now no account can ever be deleted while any entry names it, which makes erasing a person's data impossible. |
| none | The row survives the deletion with the id intact. |

So the column holds a user id that may name nobody, and readers treat a missing user as
expected rather than as corruption. `migration-sql.spec.ts` asserts that no statement in any
migration gives this table a foreign key, however the key is written, and that
`AuditEntryRecord` declares no relation for `migration:generate` to emit one from.

That spec is a *text* guard: it reads the string written at the `query()` call, reduces it
to a canonical form and refuses statements against that. Two things follow, and both are
load-bearing rather than incidental.

Its lexer **fails closed**. It recognises a fixed list of SQL token starts and refuses any
argument containing anything else, rather than modelling constructs one at a time — five
rounds of closing individual spellings, and then two constructs (`E'…'` escape strings and
a `$` abutting an identifier) that slipped past the canonical form itself, are why. A
migration that trips it gets a red test naming the construct, not a silent pass.

And a text guard can only read text it is shown, so two ESLint rules in
`apps/backend/eslint-rules/migration-sql.mjs`, scoped to the migrations directory, make sure
it is shown everything: migration SQL must be a **string literal at the call site** (no
hoisted `const`, no concatenation, no `${}` interpolation), and the only permitted method on
the query runner is `query()` — TypeORM's `createForeignKey('audit_entries', …)` and its
siblings would add exactly the foreign key this section forbids and leave no SQL text
anywhere. Neither mechanism substitutes for the other: an `E'…'` *is* a string literal at
the call, and a hoisted `const` defeats the lexer however much the lexer models.

### `TRUNCATE` is not `DELETE`

They are separate privileges, and revoking one says nothing about the other. Measured: with
`GRANT TRUNCATE ON audit_entries` present, the application role's `DELETE FROM
audit_entries` is still refused with `permission denied for table audit_entries` — and its
`TRUNCATE audit_entries` succeeds and leaves **0 rows**. Keep `TRUNCATE` out of the
default-privileges grant list; it is not there today and there is no reason to add it.

### `ALTER DEFAULT PRIVILEGES` is standing configuration, not a one-time grant

It applies to tables created *after* it, forever. So re-creating `audit_entries` in a later
migration silently restores `UPDATE` and `DELETE` to the application role — no grant is
written anywhere, and nothing warns. Measured on a table whose privileges read
`UPDATE = f` before the rebuild:

```
after_rebuild_no_grant_written | delete_too
--------------------------------+------------
 t                              | t
```

If a migration ever has to rebuild this table, the `REVOKE` has to be re-issued in the same
migration. `migration-sql.spec.ts` asserts the table is created by exactly one migration and
dropped by no other, because the textual guard is cheaper than remembering.

### A column-level grant defeats a table-level check

`has_table_privilege(role, 'audit_entries', 'UPDATE')` answers `f` while
`GRANT UPDATE (action) ON audit_entries` is in force — and the role can then run
`UPDATE audit_entries SET action = 'TAMPERED'` and it succeeds:

```
 table_level_says | any_column_says | on_action
------------------+-----------------+-----------
 f                | t               | t
```

The start-up check therefore reads `has_any_column_privilege`, not `has_table_privilege`.
Its first version read the table level only and its own docstring said there was no third
state; with a column grant present, the process booted, served `/health`, and logged
"audit_entries is append-only to this connection" — a false claim printed by the guard
itself.

### The whole guarantee is void if the application connects as the owner

A table's owner is not subject to its own `REVOKE`. Connected as the owner,
`has_table_privilege(…, 'UPDATE')` is `t` and `UPDATE audit_entries SET action = …`
rewrites the row. So a deployment that points `DATABASE_URL` at the owner — the natural
thing to do when someone is "just getting it running" — loses everything in this ADR and
nothing about the schema looks different. That is precisely why the start-up check exists,
and why it refuses to start rather than logging a warning: a warning on every request of a
misconfigured deployment is noise, and noise is read as normal.

A related non-signal worth knowing: the application role attempting to grant the privilege
back to itself does **not** raise an error. Postgres emits `WARNING: no privileges were
granted for "audit_entries"`, reports `GRANT`, and exits 0. Nothing is actually granted. A
test written as "the GRANT fails" would therefore pass today for the wrong reason, and would
keep passing if the privilege were genuinely regranted — so the end-to-end proof asserts
that the *privilege is unchanged*, never that the statement failed.

## Consequences

### Positive

- Append-only is a property of the database, so it survives every future handler, migration
  and ORM cascade written by somebody who has not read this file.
- The failure mode is loud and immediate: a statement that would rewrite history raises
  `permission denied` in development, long before production.
- The application cannot undo it at runtime. A non-owner cannot grant itself the privilege
  back, and the process will not start if it somehow holds it.
- The two-role split is the natural place to hang any later least-privilege work; the
  machinery already exists.

### Negative

- **Two credentials to configure instead of one**, and the failure when the second is
  missing is a role that does not exist rather than an obvious message. The dev and
  production compose files both carry the pair, and `.env.example` documents them.
- **`audit_entries` has no referential integrity on `actor_user_id`.** Readers must treat a
  user id that names nobody as an ordinary case. This is a deliberate trade, not an
  oversight — see the table above.
- **Nothing can delete an audit entry, including a retention policy.** The table grows
  without bound and the application cannot prune it. Retention against an append-only table
  is a real design question (partitioning, a separate retention role, time-bounded
  partitions dropped by the owner) and this ADR does not answer it.
- **One more thing that can be misconfigured into meaninglessness.** Every hazard listed
  above leaves a schema that looks correct. The tests and the start-up check are what make
  them visible; without those, this ADR is a document describing a guarantee that may or may
  not still exist.
