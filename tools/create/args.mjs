export const NAME_RE = /^[a-z][a-z0-9-]*$/;
export const SCOPE_RE = /^@[a-z0-9][a-z0-9-]*$/;
export const DB_NAME_RE = /^[a-z][a-z0-9_]*$/;

/** A problem with what the user typed. Always exit code 1. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = 1;
  }
}

const VALUE_FLAGS = new Map([
  ['--name', 'name'],
  ['--title', 'title'],
  ['--scope', 'scope'],
  ['--description', 'description'],
  ['--db-name', 'dbName'],
  ['--out', 'out'],
  ['--into', 'into'],
]);

export function parseArgs(argv) {
  const parsed = { git: true, yes: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--no-git') { parsed.git = false; continue; }
    if (flag === '--yes' || flag === '-y') { parsed.yes = true; continue; }

    const key = VALUE_FLAGS.get(flag);
    if (!key) throw new UsageError(`Unknown flag: ${flag}`);

    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`${flag} requires a value`);
    }
    parsed[key] = value;
    i += 1;
  }

  if (parsed.into) {
    if (parsed.name) throw new UsageError('--into cannot be combined with --name');
    if (parsed.out) throw new UsageError('--into cannot be combined with --out');
    return { ...parsed, mode: 'adopt', out: process.cwd() };
  }

  if (parsed.name !== undefined && !NAME_RE.test(parsed.name)) {
    throw new UsageError(
      `Invalid --name "${parsed.name}". Use lowercase letters, digits and hyphens, starting with a letter.`,
    );
  }
  if (parsed.scope !== undefined && !SCOPE_RE.test(parsed.scope)) {
    throw new UsageError(`Invalid --scope "${parsed.scope}". Expected something like "@my-app".`);
  }
  if (parsed.dbName !== undefined && !DB_NAME_RE.test(parsed.dbName)) {
    throw new UsageError(
      `Invalid --db-name "${parsed.dbName}". Use lowercase letters, digits and underscores, starting with a letter.`,
    );
  }

  return { ...parsed, mode: 'create', out: parsed.out ?? process.cwd() };
}
