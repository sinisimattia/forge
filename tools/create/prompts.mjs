import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { NAME_RE } from './args.mjs';

/**
 * Fills in whatever the flags did not provide. With `interactive: false` the
 * caller must already have supplied everything required.
 */
export async function collectAnswers(args, { interactive = true } = {}) {
  const answers = {
    name: args.name,
    title: args.title,
    scope: args.scope,
    description: args.description,
    dbName: args.dbName,
  };

  if (answers.name || !interactive || args.yes) {
    if (!answers.name) throw new Error('A project name is required (--name).');
    return answers;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    while (!answers.name || !NAME_RE.test(answers.name)) {
      answers.name = (await rl.question('Project name (kebab-case): ')).trim();
      if (!NAME_RE.test(answers.name)) {
        stdout.write('  Use lowercase letters, digits and hyphens, starting with a letter.\n');
      }
    }
    answers.description ??= (await rl.question('One-line description (optional): ')).trim();
  } finally {
    rl.close();
  }

  return answers;
}
