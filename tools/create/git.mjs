import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Short SHA of the forge checkout, or 'unknown' outside a git repository. */
export async function forgeCommit(forgeRoot) {
  try {
    const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: forgeRoot });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

/** Initializes a repository and makes the single initial commit. */
export async function initRepo(dir, title) {
  await run('git', ['init', '-q'], { cwd: dir });
  await run('git', ['add', '-A'], { cwd: dir });
  await run('git', [
    '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', `chore: initial commit for ${title}`,
  ], { cwd: dir });
}
