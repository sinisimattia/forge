import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { generate } from '../../tools/create/index.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const forgeRoot = path.resolve(here, '../..');
const templateRoot = path.join(forgeRoot, 'template');

const BIG = { maxBuffer: 64 * 1024 * 1024 };

async function generateProject() {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-gate-'));
  const { target } = await generate({
    argv: ['--name', 'gateapp', '--out', out, '--yes', '--no-git'],
    templateRoot, forgeRoot, interactive: false,
  });
  await run('npm', ['install'], { cwd: target, ...BIG });
  return target;
}

/**
 * Runs a command that is expected to fail and returns everything it wrote.
 *
 * `assert.rejects` alone proves only that *something* went wrong — a typo in the
 * probe, a missing binary and the rule actually firing are indistinguishable to
 * it. Returning the output lets the caller assert on the message the rule emits,
 * which is what makes the injection evidence rather than a coincidence.
 */
async function expectFailure(cmd, args, options, why) {
  try {
    await run(cmd, args, options);
  } catch (error) {
    return `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
  }
  assert.fail(why);
}

test('a generated project passes every gate it ships with', async (t) => {
  const project = await generateProject();

  await t.test('lint', async () => {
    await run('npm', ['run', 'lint'], { cwd: project, ...BIG });
  });
  await t.test('typecheck', async () => {
    await run('npm', ['run', 'typecheck'], { cwd: project, ...BIG });
  });
  await t.test('test', async () => {
    await run('npm', ['run', 'test'], { cwd: project, ...BIG });
  });
  await t.test('build', async () => {
    await run('npm', ['run', 'build'], { cwd: project, ...BIG });
  });
  await t.test('core purity', async () => {
    await run('npm', ['run', 'purity', '-w', 'libs/core'], { cwd: project, ...BIG });
  });

  // `layers` is the webapp's Atomic Design gate. It needs its own subtest for the same
  // reason `purity` does: neither is in any `nx run-many` list the four subtests above
  // invoke (`build`, `test`, `lint`, `typecheck`). Both appear only in the root `affected`
  // script, which nothing here runs — so without this subtest a generated project could
  // ship a layering violation, or a layer checker that had stopped working, and every gate
  // above would still be green.
  await t.test('webapp atomic layering', async () => {
    const { stdout } = await run('npm', ['run', 'layers', '-w', 'apps/webapp'], { cwd: project, ...BIG });
    // The checker exits 1 when it scanned nothing, so reaching here already means it found
    // files. Asserting on its success line additionally rules out the case where the script
    // was replaced by something that exits 0 quietly.
    assert.match(stdout, /Atomic layering: clean/, 'the layer checker did not report a clean scan');
  });

  // D2 / D14 — the plan's Definition of Done requires these two discriminating tests
  // "implemented and each observed to fail when its fault is injected". Until this subtest,
  // they existed only as a manual shell snippet in the plan doc that nobody ran in CI — the
  // subtests above only prove `lint`/`purity` exit 0 on a clean project, which they would do
  // whether or not the underlying rules actually fire.
  //
  // The faults are injected into REAL domain files — `auth/entities/Session.ts` and
  // `auth/contracts/IAuthService.ts` — and not into a probe file the test creates. A probe
  // file only ever proves the guard covers the one directory the probe was written into; an
  // injection into a file that was already there proves it covers the tree. (Phase 1's
  // version wrote its probe into `shared/types/`, which is where both gates were originally
  // developed — the least informative place either could have been checked.)
  //
  // The D2 injection carries all three forms a framework dependency can take, because
  // `libs/core/eslint.config.mjs` uses two different mechanisms to ban them:
  // `@typescript-eslint/no-restricted-imports` sees only static import/export declarations,
  // so a separate `no-restricted-syntax` rule guards dynamic `import()` and `require()`
  // (its own comment there says so — "Without these, `await import('typeorm')` and
  // `require('typeorm')` walk straight past it"). Each form's own message is asserted, so
  // a regression that removed one rule cannot hide behind the other still failing the run.
  await t.test('D2/D14: the core-purity gates discriminate, on real domain files', async () => {
    const sessionPath = path.join(project, 'libs/core/src/auth/entities/Session.ts');
    const contractPath = path.join(project, 'libs/core/src/auth/contracts/IAuthService.ts');
    const sessionOriginal = await fs.readFile(sessionPath, 'utf8');
    const contractOriginal = await fs.readFile(contractPath, 'utf8');

    try {
      // ---- D2: a framework import in a real entity must fail `nx lint core`. ----
      await fs.writeFile(
        sessionPath,
        "import { Repository } from 'typeorm';\n"
        + '\n'
        + sessionOriginal
        + '\n'
        + 'export type D2ProbeStatic = Repository<Session>;\n'
        + "export async function d2ProbeDynamic() { return import('typeorm'); }\n"
        + "export const d2ProbeRequire = require('typeorm');\n",
      );

      const lintOutput = await expectFailure(
        'npx', ['nx', 'lint', 'core', '--skip-nx-cache'], { cwd: project, ...BIG },
        'expected `nx lint core` to fail while a typeorm import sits in auth/entities/Session.ts — D2 is decorative',
      );
      assert.match(
        lintOutput, /no framework or runtime-specific imports/,
        'lint failed, but not for the static framework import — the D2 static-import ban may have regressed',
      );
      assert.match(
        lintOutput, /no dynamic import of framework packages/,
        'lint failed, but not for the dynamic import — `no-restricted-syntax`’s ImportExpression selector may have regressed',
      );
      assert.match(
        lintOutput, /require\(\) is not permitted/,
        'lint failed, but not for the require() call — `no-restricted-syntax`’s CallExpression selector may have regressed',
      );

      await fs.writeFile(sessionPath, sessionOriginal);

      // ---- D14: transport vocabulary in a real contract's prose must fail `purity`. ----
      // One injected line carries two forbidden terms, and BOTH must be reported: a check
      // that stopped at the first match per line would still fail the run, and would still
      // look like it worked.
      await fs.writeFile(
        contractPath,
        '/** Returns the JWT carried in the session cookie. */\n' + contractOriginal,
      );

      const purityOutput = await expectFailure(
        'npm', ['run', 'purity', '-w', 'libs/core'], { cwd: project, ...BIG },
        'expected `purity -w libs/core` to fail while a JWT/cookie TSDoc line sits in auth/contracts/IAuthService.ts — D14 is decorative',
      );
      assert.match(
        purityOutput, /auth\/contracts\/IAuthService\.ts:1 {2}jwt/,
        'purity failed, but did not report `jwt` on the injected line of the real contract file',
      );
      assert.match(
        purityOutput, /auth\/contracts\/IAuthService\.ts:1 {2}cookie/,
        'purity failed, but did not report `cookie` — it reports only the first forbidden term per line',
      );
    } finally {
      await fs.writeFile(sessionPath, sessionOriginal);
      await fs.writeFile(contractPath, contractOriginal);
    }

    // With both faults removed, both gates must return to green — this is what proves the
    // failures above were caused by the injections and not by some unrelated break.
    // `--skip-nx-cache`: without it nx would replay the cached success from the `lint`
    // subtest above, because the restored tree hashes identically. A replayed cache entry
    // is not an observation that the gate is green again — it is an observation that it
    // once was. Re-run it for real.
    await run('npx', ['nx', 'lint', 'core', '--skip-nx-cache'], { cwd: project, ...BIG });
    await run('npm', ['run', 'purity', '-w', 'libs/core'], { cwd: project, ...BIG });
  });
});

test('a generated project contains the whole process layer', async () => {
  const project = await generateProject();

  // Not an exhaustive manifest — the inventory exists to catch a whole missing AREA, and a
  // list of three hundred paths is a list nobody updates. One load-bearing path per area
  // that a generated project would be broken without.
  const expected = [
    // the workspace shell and the process layer
    'CLAUDE.md', 'README.md', 'forge.json', 'package.json', 'nx.json',
    'compose.yaml', '.env.example', '.github/workflows/ci.yml',
    '.claude/agents/planner.md', '.claude/agents/reviewer.md', '.claude/agents/README.md',
    'docs/standards/agent-playbook.md', 'docs/standards/naming.md',
    'docs/adrs/0001-single-source-documentation.md',
    // the four platform ADRs — the decisions the identity surface is built on. Every one of
    // them is cited by name from code or from another doc, so a missing file here is a
    // dangling reference somewhere else.
    'docs/adrs/0005-identity-is-separate-from-user.md',
    'docs/adrs/0006-authorization-is-a-pure-function-in-core.md',
    'docs/adrs/0007-tenancy-is-explicit-never-ambient.md',
    'docs/adrs/0008-ports-not-vendors.md',
    // libs/core: one barrel per domain. These overlap with the exports<->barrel check below
    // and are NOT redundant with it: that check compares package.json against the disk, so
    // deleting a domain's folder AND its export key together passes it. This list is what
    // notices the domain went missing.
    'libs/core/src/shared/errors/DomainError.ts',
    'libs/core/src/users/contracts/index.ts',
    'libs/core/src/identities/contracts/index.ts',
    'libs/core/src/auth/contracts/index.ts',
    'libs/core/src/audit/contracts/index.ts',
    // ADR-0006's pure function. `authorization/` is the fifth domain and has no `contracts/`
    // — it is a policy module, not a service port, which is the whole point of that ADR.
    'libs/core/src/authorization/policies/index.ts',
    // the backend: health, the three migrations that build the identity schema, and the
    // mail port (ADR-0008 — a port, never a vendor).
    'apps/backend/src/health/health.controller.ts',
    'apps/backend/src/db/migrations/1758000000000-AppRoleAndDefaultPrivileges.ts',
    'apps/backend/src/db/migrations/1758000001000-IdentityFoundation.ts',
    'apps/backend/src/db/migrations/1758000002000-AuditAppendOnly.ts',
    'apps/backend/src/mail/IMailer.ts',
    // the webapp: the auth surface, its layout, and the layer checker that guards it.
    'apps/webapp/app/pages/index.vue',
    'apps/webapp/app/pages/login.vue',
    'apps/webapp/app/pages/register.vue',
    'apps/webapp/app/pages/forgot-password.vue',
    'apps/webapp/app/pages/reset-password.vue',
    'apps/webapp/app/pages/verify-email.vue',
    'apps/webapp/app/layouts/auth.vue',
    'apps/webapp/scripts/check-atomic-layers.mjs',
  ];
  for (const rel of expected) {
    await fs.access(path.join(project, rel));
  }

  const agents = await fs.readdir(path.join(project, '.claude/agents'));
  assert.equal(agents.length, 12, 'expected 11 agents plus a README');

  // Every subpath in libs/core's `exports` must resolve to a real barrel on disk.
  // A subpath added to package.json but not created — or created and not added —
  // fails here rather than in whichever consuming task imports it next.
  const corePkg = JSON.parse(
    await fs.readFile(path.join(project, 'libs/core/package.json'), 'utf8'),
  );
  const exported = Object.keys(corePkg.exports ?? {});
  assert.ok(exported.length > 0, 'libs/core/package.json declares no `exports` at all');

  // Every key must be `./<domain>/<group>`. The disk side below walks exactly two levels,
  // so a key of any other shape would be compared against a directory layout this check
  // never looks at — it would pass by not looking, which is the failure mode the check
  // exists to prevent. Fail loudly instead, and make whoever adds such a key extend both
  // sides together.
  const malformed = exported.filter((key) => !/^\.\/[^./]+\/[^./]+$/.test(key));
  assert.deepEqual(
    malformed, [],
    'libs/core exports a subpath that is not `./<domain>/<group>`; the disk walk below only '
    + 'covers that shape, so extend both sides together',
  );

  const src = path.join(project, 'libs/core/src');
  const onDisk = [];
  for (const domain of await fs.readdir(src, { withFileTypes: true })) {
    if (!domain.isDirectory()) continue;
    for (const group of await fs.readdir(path.join(src, domain.name), { withFileTypes: true })) {
      if (!group.isDirectory()) continue;
      try {
        await fs.access(path.join(src, domain.name, group.name, 'index.ts'));
      } catch {
        continue;
      }
      onDisk.push(`./${domain.name}/${group.name}`);
    }
  }

  const missingBarrel = exported.filter((key) => !onDisk.includes(key)).sort();
  assert.deepEqual(
    missingBarrel, [],
    'libs/core/package.json exports a subpath with no `src/<subpath>/index.ts` behind it — '
    + 'importing it from the backend or the webapp would fail at resolution',
  );
  const missingExport = onDisk.filter((key) => !exported.includes(key)).sort();
  assert.deepEqual(
    missingExport, [],
    'libs/core has a barrel that package.json does not export — it is unreachable from any '
    + 'consumer, and whoever wrote it cannot tell until they try to import it',
  );

  // `nx run-many` is checked elsewhere only by exit code, which stays 0 even if a
  // future template edit silently breaks project discovery for one package (a
  // shrinking gate that still reports green). Assert all three are actually found.
  const { stdout: projects } = await run('npx', ['nx', 'show', 'projects'], { cwd: project });
  for (const name of ['core', 'backend', 'webapp']) {
    assert.ok(projects.includes(name), `nx did not discover the ${name} project`);
  }
});

// D5 — no trace of the project the template was extracted from
test('D5: the template carries no source-project trace or populated secret', async () => {
  await run('node', ['tools/sanitize.mjs'], { cwd: forgeRoot });
});
