import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectAnswers } from '../../tools/create/prompts.mjs';

test('refuses to prompt when stdin is not a terminal', async () => {
  // The CI case: no --name, no --yes, nothing to read from. Must fail fast as a
  // usage error rather than hang and then exit 0 having done nothing.
  await assert.rejects(
    () => collectAnswers({}, { interactive: true, isTty: false }),
    (error) => { assert.equal(error.exitCode, 1); return true; },
  );
});

test('a missing name with --yes is a validation error, not an internal one', async () => {
  await assert.rejects(
    () => collectAnswers({ yes: true }, { interactive: true, isTty: true }),
    (error) => { assert.equal(error.exitCode, 1); return true; },
  );
});

test('supplied answers are returned untouched without prompting', async () => {
  const answers = await collectAnswers(
    { name: 'my-app', description: 'Hi.' },
    { interactive: true, isTty: false },
  );
  assert.equal(answers.name, 'my-app');
  assert.equal(answers.description, 'Hi.');
});
