import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { generate } from '../../tools/create/index.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const forgeRoot = path.resolve(here, '../..');
const templateRoot = path.join(forgeRoot, 'template');

const enabled = process.env.FORGE_E2E === '1';

/**
 * The host running this test may already have something bound to 5432/3000/3001
 * (another project's Postgres, a locally running dev server, ...). Never assume
 * they are free — ask the OS for a free port instead and publish the stack there.
 */
async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** Gather what compose knows right now, so a failure is diagnosable instead of a bare timeout. */
async function composeDiagnostics(target) {
  const ps = await run('docker', ['compose', 'ps', '--all'], { cwd: target })
    .then((r) => r.stdout)
    .catch((error) => `(ps failed: ${error.message})`);
  const logs = await run('docker', ['compose', 'logs', '--no-color', '--tail', '200'], {
    cwd: target,
    maxBuffer: 64 * 1024 * 1024,
  })
    .then((r) => r.stdout)
    .catch((error) => `(logs failed: ${error.message})`);
  return `--- docker compose ps --all ---\n${ps}\n--- docker compose logs (tail 200) ---\n${logs}`;
}

test(
  'the generated stack boots and serves /health',
  { skip: !enabled && 'set FORGE_E2E=1' },
  async () => {
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-docker-'));
    const { target } = await generate({
      argv: ['--name', 'dockerapp', '--out', out, '--yes', '--no-git'],
      templateRoot,
      forgeRoot,
      interactive: false,
    });

    // A real user runs `npm install` before `npm run dev:up` (see the generator's own
    // "Next steps" output) — the template ships no package-lock.json, and the backend/
    // webapp Dockerfiles COPY it unconditionally, so `docker compose build` on a bare
    // generate (skipping this step) fails immediately with "package-lock.json: not found".
    await run('npm', ['install'], { cwd: target, maxBuffer: 64 * 1024 * 1024 });

    await fs.copyFile(path.join(target, '.env.example'), path.join(target, '.env'));

    // Pick free host ports rather than trusting the compose defaults (5432/3000/3001)
    // are unoccupied on this machine; compose.yaml reads these as overrides.
    const [postgresPort, backendPort, webappPort] = await Promise.all([
      getFreePort(),
      getFreePort(),
      getFreePort(),
    ]);
    await fs.appendFile(
      path.join(target, '.env'),
      `\nPOSTGRES_PORT=${postgresPort}\nBACKEND_PORT=${backendPort}\nWEBAPP_PORT=${webappPort}\n`,
    );

    try {
      try {
        // `--wait` makes compose itself the readiness gate: it reports failure
        // (bounded by --wait-timeout) as soon as a container exits or a
        // healthcheck condition can't be satisfied, instead of us blindly
        // polling an HTTP endpoint that a dead container would never answer.
        await run(
          'docker',
          ['compose', 'up', '-d', '--build', '--wait', '--wait-timeout', '300'],
          { cwd: target, maxBuffer: 64 * 1024 * 1024 },
        );
      } catch (error) {
        const diagnostics = await composeDiagnostics(target);
        throw new Error(`docker compose up --wait failed: ${error.message}\n\n${diagnostics}`);
      }

      const response = await fetch(`http://localhost:${backendPort}/health`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body, { status: 'ok' });
    } finally {
      await run('docker', ['compose', 'down', '-v'], { cwd: target }).catch((error) => {
        process.stderr.write(`warning: docker compose down -v failed: ${error.message}\n`);
      });
    }
  },
);
