// @ts-check
/**
 * Two rules that hold migration SQL where a text guard can read it.
 *
 * ## Why a lint rule, and why it is not the same fix as the canonical form
 *
 * `src/db/__tests__/migration-sql.spec.ts` guards the append-only property of
 * `audit_entries` (discriminating test D13, `docs/adrs/0009-two-database-roles.md`)
 * by reading the migrations as *text*: it extracts the string written at
 * `queryRunner.query(…)` / `exec(queryRunner, …)`, reduces it to a canonical
 * form, and refuses any statement that would void the guarantee — a foreign key
 * in either direction, a change of the table's ownership, a grant handing the
 * revoked privileges back.
 *
 * That file spent five rounds of review closing successive *spellings* of a
 * table reference, and closed the last of them by canonicalizing rather than by
 * matching. But two gaps in it were never about spelling at all, and no smarter
 * extractor can close them, because the statement never reaches the extractor:
 *
 * - **SQL that is not a string literal at the call site.** A hoisted
 *   `const sql = '…'; await queryRunner.query(sql)` yields nothing;
 *   `'ALTER TABLE ' + table + ' OWNER TO app'` yields only the first fragment;
 *   a `${}` interpolation yields text with a variable's name where the table's
 *   name should be. All three pass every "no statement does X" assertion in
 *   that file, silently.
 * - **Schema changes made through TypeORM's `QueryRunner` API rather than SQL.**
 *   `queryRunner.createForeignKey('audit_entries', …)` adds exactly the foreign
 *   key that file exists to forbid, and leaves no SQL text anywhere.
 *
 * Both are unbounded *extraction* problems. Pinned at the call site they become
 * bounded *syntactic* ones, which is what these rules do — and they fail at
 * authoring time, in the editor, rather than at review time or not at all.
 *
 * **These rules do not replace the canonical form, and the canonical form does
 * not replace them.** It is worth being exact about this, because the two fixes
 * look interchangeable and are not. `E'\''` and a `$` abutting an identifier —
 * the two shapes that reached a real Postgres past the canonical form — *are*
 * string literals at the call site. This rule accepts them without a word. They
 * are closed by the lexer refusing constructs it does not model. Conversely, a
 * `const` hoist defeats the lexer completely, whatever the lexer models,
 * because the lexer is never shown the string. Neither item substitutes for the
 * other; both are needed, and removing either reopens a class of its own.
 *
 * ## Scope
 *
 * Migration files only. Everywhere else in this backend, SQL is built by
 * TypeORM's query builder and repositories, where none of this applies and
 * where a rule this blunt would be noise.
 */

/**
 * Where the SQL sits in a call this codebase's extractor reads.
 *
 * Deliberately the same two shapes as `sqlStatements`'s regex in
 * `migration-sql.spec.ts` — `queryRunner.query(…)` and `exec(queryRunner, …)`.
 * If one grows a shape the other does not have, the rule stops pinning what the
 * guard reads, and the two are meant to be read side by side for exactly that
 * reason.
 *
 * @param {import('estree').CallExpression} node - the call being examined
 * @returns {import('estree').Node | undefined | null} the SQL argument, `undefined`
 *   when the call takes none, or `null` when this is not such a call
 */
function sqlArgument(node) {
  const callee = node.callee;
  if (
    callee.type === 'MemberExpression'
    && !callee.computed
    && callee.property.type === 'Identifier'
    && callee.property.name === 'query'
  ) {
    return node.arguments[0];
  }
  if (callee.type === 'Identifier' && callee.name === 'exec') {
    const first = node.arguments[0];
    const passesRunner = first !== undefined
      && first.type === 'Identifier'
      && first.name === 'queryRunner';
    return passesRunner ? node.arguments[1] : node.arguments[0];
  }
  return null;
}

/**
 * The property path of a call made on the `queryRunner` binding, if it is one.
 *
 * `opaque` records that some link in the chain was computed or otherwise not a
 * plain identifier — `queryRunner['createForeignKey'](…)`. Such a call is
 * reported rather than skipped: a rule that allowed what it could not name
 * would have a bypass consisting of two square brackets.
 *
 * @param {import('estree').Node} callee - the call's callee
 * @returns {{ path: string[], opaque: boolean } | null} the path, or `null` when
 *   the call is not rooted at `queryRunner`
 */
function queryRunnerPath(callee) {
  /** @type {string[]} */
  const path = [];
  let opaque = false;
  let current = callee;
  while (current.type === 'MemberExpression') {
    if (!current.computed && current.property.type === 'Identifier') {
      path.unshift(current.property.name);
    } else {
      opaque = true;
      path.unshift('[…]');
    }
    current = current.object;
  }
  if (current.type !== 'Identifier' || current.name !== 'queryRunner') return null;
  return { path, opaque };
}

/**
 * The only method a migration may call on its query runner.
 *
 * An allow-list of one, for the same reason `PERMITTED_ALTERS` in
 * `migration-sql.spec.ts` is an allow-list: the dangerous members of
 * `QueryRunner` cannot be enumerated. `createForeignKey` is the one this
 * repository has a name for, but `createTable`, `addColumn`, `changeColumn`,
 * `dropConstraint`, `createPrimaryKey` and `manager.query` are all equally
 * invisible to a text guard, and the interface is TypeORM's to extend. Listing
 * what is allowed changes only when somebody wants to write a migration a
 * different way, which is exactly the moment a person should look.
 */
const PERMITTED_QUERY_RUNNER_CALLS = ['query'];

/** @type {import('eslint').Rule.RuleModule} */
const sqlIsAStringLiteral = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require migration SQL to be a string literal at the call site, so the '
        + 'audit-table guards in migration-sql.spec.ts can read it.',
    },
    schema: [],
    messages: {
      notALiteral:
        'Migration SQL must be a string literal written at the call. This argument is '
        + 'a {{kind}}, which src/db/__tests__/migration-sql.spec.ts cannot read — the '
        + 'append-only guards on audit_entries would pass without ever seeing the '
        + 'statement. Inline the SQL, or write out why not and disable this rule on '
        + 'the line (migration-sql.spec.ts asserts the exact set of such exemptions).',
      missing:
        'This call runs SQL but no SQL argument was written at it, so there is nothing '
        + 'for the audit-table guards in migration-sql.spec.ts to read.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const argument = sqlArgument(node);
        if (argument === null) return;
        if (argument === undefined) {
          context.report({ node, messageId: 'missing' });
          return;
        }
        if (argument.type === 'Literal' && typeof argument.value === 'string') return;
        // A template literal with no `${}` in it is a literal in every sense
        // that matters here, and it is how this codebase writes multi-line
        // `CREATE TABLE` statements. One with a substitution is not: the
        // extractor reads the source text between the backticks, so an
        // interpolation reaches the guards as a variable's *name* standing
        // where the table's name should be.
        if (argument.type === 'TemplateLiteral' && argument.expressions.length === 0) return;
        context.report({
          node: argument,
          messageId: 'notALiteral',
          data: { kind: describe(argument) },
        });
      },
    };
  },
};

/**
 * A short, human name for what was written instead of a literal.
 *
 * @param {import('estree').Node} node - the offending argument
 * @returns {string} a phrase for the message
 */
function describe(node) {
  if (node.type === 'TemplateLiteral') return 'template literal with a ${} substitution';
  if (node.type === 'Identifier') return `reference to \`${node.name}\``;
  if (node.type === 'BinaryExpression') return 'concatenation';
  if (node.type === 'MemberExpression') return 'property access';
  if (node.type === 'CallExpression') return 'call result';
  return `${node.type}`;
}

/** @type {import('eslint').Rule.RuleModule} */
const noQueryRunnerSchemaApi = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Allow only queryRunner.query() in a migration, so every schema change '
        + 'leaves SQL text for migration-sql.spec.ts to read.',
    },
    schema: [],
    messages: {
      notPermitted:
        '`queryRunner.{{path}}(…)` changes the schema without leaving any SQL text, so '
        + 'src/db/__tests__/migration-sql.spec.ts cannot see it — `createForeignKey('
        + '\'audit_entries\', …)` is the foreign key that file exists to forbid, and it '
        + 'would add it in silence. Write the statement as SQL and pass it to '
        + 'queryRunner.query().',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const found = queryRunnerPath(node.callee);
        if (found === null) return;
        const permitted = !found.opaque
          && found.path.length === 1
          && PERMITTED_QUERY_RUNNER_CALLS.includes(found.path[0]);
        if (permitted) return;
        context.report({
          node,
          messageId: 'notPermitted',
          data: { path: found.path.join('.') },
        });
      },
    };
  },
};

/**
 * The plugin, for a flat config to name.
 *
 * No dependency: an ESLint flat config takes a plugin as a plain object, so
 * these rules ship as source in this repository rather than as a package.
 */
export default {
  rules: {
    'sql-is-a-string-literal': sqlIsAStringLiteral,
    'no-query-runner-schema-api': noQueryRunnerSchemaApi,
  },
};
