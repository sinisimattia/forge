import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { NAME_RE, UsageError } from './args.mjs';

/**
 * Fills in whatever the flags did not provide.
 *
 * Prompting needs a real terminal. With `--yes`, a non-interactive caller, or a
 * stdin that is not a TTY (CI, piped input), a missing name is a usage error
 * rather than a prompt nobody can answer. A CLI whose exit codes are
 * contractual must never exit 0 having done nothing.
 *
 * `isTty` is injectable so the non-terminal path is testable without a subprocess.
 */
export async function collectAnswers(
  args,
  { interactive = true, isTty = Boolean(stdin.isTTY) } = {},
) {
  const answers = {
    name: args.name,
    title: args.title,
    scope: args.scope,
    description: args.description,
    dbName: args.dbName,
  };

  const canPrompt = interactive && !args.yes && isTty;

  if (answers.name || !canPrompt) {
    if (!answers.name) throw new UsageError('A project name is required (--name).');
    return answers;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  // Ctrl-D closes the interface without ever settling the pending question,
  // which would hang the process forever. Race the close against the answer.
  let finished = false;
  const closedEarly = new Promise((_, reject) => {
    rl.once('close', () => {
      if (!finished) reject(new UsageError('Input closed before a project name was given.'));
    });
  });
  const ask = (query) => Promise.race([rl.question(query), closedEarly]);

  try {
    while (!answers.name || !NAME_RE.test(answers.name)) {
      answers.name = (await ask('Project name (kebab-case): ')).trim();
      if (!NAME_RE.test(answers.name)) {
        stdout.write('  Use lowercase letters, digits and hyphens, starting with a letter.\n');
      }
    }
    answers.description ??= (await ask('One-line description (optional): ')).trim();
  } finally {
    finished = true;
    rl.close();
  }

  return answers;
}
