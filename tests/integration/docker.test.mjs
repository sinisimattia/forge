import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { generate } from '../../tools/create/index.mjs';
import { tempDirFactory } from '../helpers/temp.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const forgeRoot = path.resolve(here, '../..');
const templateRoot = path.join(forgeRoot, 'template');

const enabled = process.env.FORGE_E2E === '1';

const tempDir = tempDirFactory('forge-docker-');

/**
 * The address the dev provider is configured to assert for the whole of
 * {@link walkFederatedSignIn} — a fresh address nobody else in this walk
 * registers, so "creates an account" and "signs into the same one twice" are
 * unambiguous. Set once, in `apps/backend/.env`, before the stack ever boots.
 * {@link walkTheFederatedRefusal} points the dev provider at a different
 * address later, by rewriting that file and recreating the `backend`
 * container — see that function's own doc for why.
 */
const DEV_OAUTH_INITIAL_EMAIL = 'federated-walker@example.com';

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
async function composeDiagnostics(target, projectName, files = []) {
  const flags = files.flatMap((file) => ['-f', file]);
  const ps = await run('docker', ['compose', ...flags, '-p', projectName, 'ps', '--all'], { cwd: target })
    .then((r) => r.stdout)
    .catch((error) => `(ps failed: ${error.message})`);
  const logs = await run(
    'docker',
    ['compose', ...flags, '-p', projectName, 'logs', '--no-color', '--tail', '200'],
    { cwd: target, maxBuffer: 64 * 1024 * 1024 },
  )
    .then((r) => r.stdout)
    .catch((error) => `(logs failed: ${error.message})`);
  return `--- docker compose ps --all ---\n${ps}\n--- docker compose logs (tail 200) ---\n${logs}`;
}

/**
 * Generates a project and gives it a compose project name nothing else on this
 * machine will ever name again.
 *
 * `generate()` always resolves the target to `<out>/<name>`, so the project
 * directory basename — and therefore Compose's default project name, and the
 * container/volume names it derives from that — would be identical on every run
 * of this test on this machine. Without an explicit project name, a run that
 * dies before its `finally` (kill -9, CI cancel, OOM) leaves a `<name>_pgdata`
 * volume that the *next* run silently attaches to and reuses instead of getting
 * a fresh database. Derive a project name from the already-unique temp dir and
 * pass it to every compose invocation so they always agree.
 *
 * Trade-off this introduces: because the project name is unique per run, a run
 * that dies before its `finally` (same kill -9 / CI cancel / OOM scenarios
 * above) now leaves a `forge-e2e-*_pgdata` volume that is permanently orphaned —
 * nothing ever names that exact project again to `down -v` it — rather than a
 * stale volume that gets silently reused. Correct for test isolation, but it
 * trades "wrong data" for "leaked disk space"; there is no cleanup for these
 * orphans today.
 *
 * @param name - the project name to generate under
 * @returns the generated project directory and the compose project name for it
 */
async function generateProject(name) {
  const out = await tempDir();
  const { target } = await generate({
    argv: ['--name', name, '--out', out, '--yes', '--no-git'],
    templateRoot,
    forgeRoot,
    interactive: false,
  });

  // `template/package-lock.json` is committed and copied verbatim into every
  // generated project, so no host `npm install` is needed before
  // `docker compose build` — both Dockerfiles' `COPY package.json
  // package-lock.json ...` find a real file straight off a bare `generate()`,
  // and `RUN npm ci` installs from it inside the image. (Previously the template
  // shipped no lockfile at all, so that COPY failed outright with
  // "package-lock.json: not found" unless a host install had just created one —
  // this deliberately no longer runs one, so a regression here is exactly what
  // would bring that requirement back.)

  const projectName = `forge-e2e-${path.basename(out).replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
  return { target, projectName };
}

/**
 * One HTTP call against the running stack, with everything a walk needs to
 * assert on kept as data rather than thrown away.
 *
 * `res.text()` rather than `res.json()`: D7 compares two responses to each other
 * byte for byte, and a parse-then-stringify round trip would make
 * `{"status":"accepted"}` and `{ "status" : "accepted" }` compare equal.
 *
 * @param base - the stack's base URL
 * @param method - the HTTP method
 * @param route - the path, starting with `/`
 * @param options - `body` (serialized as JSON), `token` (bearer), `cookie`
 * @returns the status, the raw body text, the parsed body when it is JSON, and
 *   every `Set-Cookie` the response carried
 */
async function call(base, method, route, { body, token, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  if (cookie !== undefined) headers.cookie = cookie;

  const response = await fetch(`${base}${route}`, {
    method,
    headers,
    // `redirect: 'manual'` — found the hard way, by `walkFederatedSignIn`'s
    // first run: `fetch`'s default (`'follow'`) auto-follows `OAuthController`'s
    // `302`s straight through this application's own callback and into
    // whatever the webapp answers at `PUBLIC_WEBAPP_URL/oauth/callback`, so
    // `call()` returned the WEBAPP's response (once even a `500` from its dev
    // server) instead of this backend's own `302` — silently, since nothing
    // about that shape says "this followed a redirect you did not ask for."
    // `'manual'` hands back the `3xx` itself, `status` and `Location`
    // included (confirmed against Node's own `fetch`, which — unlike a
    // browser's opaque redirect — does not hide either behind `redirect:
    // 'manual'`), which is what every caller of `.location` below needs and
    // what D7's byte-for-byte comparisons already assumed of every other
    // route.
    redirect: 'manual',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {
    status: response.status,
    text,
    json,
    setCookie: response.headers.getSetCookie(),
    // Only the federated walk needs this — `OAuthController` answers every one
    // of its routes with a `302` rather than a body, so following the trip a
    // browser would take means reading `Location` ourselves. Added as an
    // extra field rather than a new return shape so every existing caller,
    // which never reads it, is unaffected.
    location: response.headers.get('location'),
  };
}

/** The `name=value` pair of the renewal cookie in a response, or `undefined`. */
function refreshCookie(response) {
  const header = response.setCookie.find((value) => value.startsWith('refreshCredential='));
  return header === undefined ? undefined : header.split(';')[0];
}

/**
 * Every message the dev mailer has written, read **from the host**.
 *
 * From the host deliberately, not through `docker compose exec`: the whole
 * design rests on `MAIL_OUTBOX_DIR` landing inside the `.:/app` bind mount, and
 * reading it from inside the container would pass whether or not the mount
 * carried anything back out. This directory is where Task 10's reasoning about
 * the container's working directory gets checked for the first time.
 *
 * @param target - the generated project directory on the host
 * @returns each message, oldest first
 */
async function readOutbox(target) {
  const dir = path.join(target, '.mail-outbox');
  const names = await fs.readdir(dir).catch(() => []);
  const messages = [];
  for (const name of names.sort()) {
    messages.push(JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')));
  }
  return messages;
}

/** The single-use token out of a message's link. */
function tokenFrom(message) {
  const link = message.body.match(/https?:\/\/\S+/);
  assert.ok(link, `no link in the message body:\n${message.body}`);
  const token = new URL(link[0]).searchParams.get('token');
  assert.ok(token, `no token in the link: ${link[0]}`);
  return token;
}

/**
 * Waits for a message matching `predicate` to appear in the outbox.
 *
 * Polled rather than read once: `send()` is awaited by the service but the
 * response reaches this process over a socket, so a read that happens
 * immediately after a `202` can legitimately beat the `writeFile` to disk.
 *
 * @param target - the generated project directory
 * @param predicate - which message is being waited for
 * @returns the matching message
 */
async function waitForMessage(target, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const messages = await readOutbox(target);
    const found = messages.filter(predicate).pop();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const messages = await readOutbox(target);
  assert.fail(
    'no matching message reached the outbox on the host — either nothing was sent or '
    + `MAIL_OUTBOX_DIR does not resolve inside the bind mount. Outbox held: ${JSON.stringify(
      messages.map((message) => message.subject),
    )}`,
  );
}

/**
 * The connection strings `compose.yaml` hands the backend, read out of the file.
 *
 * Read rather than retyped, because a retyped literal is a second place the role
 * names live and the D13 block is the one test whose whole point is that it
 * connects as the *application* role and not the owner. A comment here once said
 * these were read from the file while a literal sat underneath it — the claim was
 * false and the mechanism did not exist. This is the mechanism.
 *
 * `@postgres:` becomes `@localhost:` because `psql` is executed *inside* the
 * `postgres` container, where the service's own name is not a host it can reach.
 *
 * @param target - the generated project directory
 * @returns the application role's URL and the schema owner's URL
 * @throws Error when either variable is missing, which means the compose file
 *   changed shape and this test is no longer testing what it says it is
 */
async function connectionUrlsFrom(target) {
  const yaml = await fs.readFile(path.join(target, 'compose.yaml'), 'utf8');
  const read = (name) => {
    const match = yaml.match(new RegExp(`^\\s*${name}:\\s*(postgresql://\\S+)\\s*$`, 'm'));
    assert.ok(match, `compose.yaml no longer pins ${name} — this test cannot tell which role it is using`);
    return match[1].replace('@postgres:', '@localhost:');
  };
  return { app: read('DATABASE_URL'), owner: read('MIGRATION_DATABASE_URL') };
}

test(
  'the generated stack walks the whole identity and tenancy flow, and the audit log is append-only',
  { skip: !enabled && 'set FORGE_E2E=1' },
  async () => {
    const { target, projectName } = await generateProject('dockerapp');

    const compose = (...args) => run('docker', ['compose', '-p', projectName, ...args], {
      cwd: target,
      maxBuffer: 64 * 1024 * 1024,
    });

    await fs.copyFile(path.join(target, '.env.example'), path.join(target, '.env'));

    // Pick free host ports rather than trusting the compose defaults (5432/3000/3001/9229)
    // are unoccupied on this machine; compose.yaml reads these as overrides. This covers
    // the debug port too — 9229 is the Node inspector default, so it's not a hypothetical.
    const [postgresPort, backendPort, webappPort, backendDebugPort] = await Promise.all([
      getFreePort(),
      getFreePort(),
      getFreePort(),
      getFreePort(),
    ]);
    await fs.appendFile(
      path.join(target, '.env'),
      `\nPOSTGRES_PORT=${postgresPort}\nBACKEND_PORT=${backendPort}\nWEBAPP_PORT=${webappPort}\n` +
        `BACKEND_DEBUG_PORT=${backendDebugPort}\n`,
    );

    // `compose.yaml`'s `backend` service pins `DATABASE_URL`, `MIGRATION_DATABASE_URL`,
    // `APP_DB_ROLE`, `APP_DB_PASSWORD`, `JWT_SECRET` and `PUBLIC_WEBAPP_URL` in
    // `environment:`, which wins over `env_file:`. `MAIL_OUTBOX_DIR` is the one variable
    // this walk needs that it does NOT pin, so it arrives through the optional
    // `apps/backend/.env` the service already reads. An absolute path, so what is asserted
    // is the bind mount rather than an agreement about the container's working directory.
    // OAUTH_DEV_ENABLED/OAUTH_DEV_EMAIL land here for the same reason
    // MAIL_OUTBOX_DIR does: `compose.yaml` pins `NODE_ENV`, `DATABASE_URL` and
    // the rest of the backend's `environment:` block, which wins over
    // `env_file:`, but names neither of these two — so this optional file is
    // the only way in. `NODE_ENV=development` is pinned there, so the
    // production refusal (proven separately, against the real prod image, by
    // `proveProductionRefusesTheDevProvider`) does not fire here.
    await fs.writeFile(
      path.join(target, 'apps/backend/.env'),
      'MAIL_OUTBOX_DIR=/app/.mail-outbox\n'
      + 'OAUTH_DEV_ENABLED=1\n'
      + `OAUTH_DEV_EMAIL=${DEV_OAUTH_INITIAL_EMAIL}\n`,
    );

    // The entity-versus-migration drift probe. It lives outside `src/`, so `nest
    // start --watch` does not compile it and it cannot break the running stack;
    // it is run once, by hand, below. See its assertion for what it catches that
    // nothing else here does.
    await fs.writeFile(path.join(target, 'apps/backend/drift-probe.ts'), DRIFT_PROBE);

    const base = `http://localhost:${backendPort}`;

    try {
      try {
        // `--wait` makes compose itself the readiness gate: it reports failure
        // (bounded by --wait-timeout) as soon as a container exits or a
        // healthcheck condition can't be satisfied, instead of us blindly
        // polling an HTTP endpoint that a dead container would never answer.
        //
        // `postgres backend` — not the whole stack. Nothing below this line
        // makes a single request against `webapp`: every walk in this test
        // drives the backend's own HTTP API directly and reads a `Location`
        // header or a database row for its evidence, never a rendered page.
        // Building and booting `webapp` here would cost a second image (and
        // its own build-cache footprint — measured at roughly 1.24 GB image
        // plus its share of a ~1.7 GB cold build cache) for zero coverage.
        // **If you are adding an assertion that calls the webapp, add the
        // service back here first** — it is not started, so a request against
        // it will simply hang until `--wait-timeout`, which will look like an
        // unrelated failure. (It is not merely unbuilt by omission, either:
        // the dev webapp's SSR currently 500s on every page for reasons
        // unrelated to this test — see the phase's own follow-on task for
        // that defect. That is exactly why nothing here has ever exercised
        // it, and exactly why "add coverage" rather than "restore the old
        // scope" is the right fix when someone needs it.)
        await compose('up', '-d', '--build', '--wait', '--wait-timeout', '600', 'postgres', 'backend');
      } catch (error) {
        const diagnostics = await composeDiagnostics(target, projectName);
        throw new Error(`docker compose up --wait failed: ${error.message}\n\n${diagnostics}`);
      }

      const health = await call(base, 'GET', '/health');
      assert.equal(health.status, 200);
      assert.deepEqual(health.json, { status: 'ok' });

      await walkTheIdentityFlow(base, target);
      await walkFederatedSignIn(base);
      await walkTheFederatedRefusal(compose, projectName, base, target);
      await walkTheTenancyFlow(base, target);
      await proveTheAuditLogIsAppendOnly(compose, projectName, target);
      await proveWhatTheFakeCannotExpress(compose, base, target);
    } catch (error) {
      const diagnostics = await composeDiagnostics(target, projectName);
      throw new Error(`${error.message}\n\n${diagnostics}`);
    } finally {
      // `--rmi local` as well as `-v`: this test builds a fresh image tag per run
      // (the project name is unique), so without it every run leaves another
      // `forge-e2e-*-backend` behind. The build cache is untouched, so the next
      // run rebuilds from layers rather than from scratch — and `local` never
      // touches `postgres:16-alpine`, which carries a tag from the compose file
      // and belongs to whoever else on this machine is using it.
      await compose('down', '-v', '--rmi', 'local').catch((error) => {
        process.stderr.write(`warning: docker compose down -v --rmi local failed: ${error.message}\n`);
      });
    }
  },
);

/**
 * Registration through to recovery, against the real stack.
 *
 * The three discriminating tests this re-proves here rather than against fakes:
 * **D6** (nothing is reachable without a credential unless it says so), **D7**
 * (a known and an unknown address are indistinguishable) and **D8** (a renewal
 * credential presented twice ends the whole family).
 *
 * @param base - the stack's base URL
 * @param target - the generated project directory, for the outbox
 */
async function walkTheIdentityFlow(base, target) {
  const email = 'walker@example.com';
  const secret = 'correct-horse-battery-staple-42';

  const registered = await call(base, 'POST', '/auth/register', {
    body: { email, displayName: 'Walker', secret },
  });
  assert.equal(registered.status, 202, registered.text);
  assert.deepEqual(registered.json, { status: 'accepted' });

  const verification = await waitForMessage(target, (message) => message.to === email);
  assert.match(verification.subject, /verify/i);

  // D6. Not "some route is closed" — the route the whole product hangs off.
  const anonymous = await call(base, 'GET', '/users/me');
  assert.equal(anonymous.status, 401, `D6: /users/me answered an anonymous caller: ${anonymous.text}`);

  const tooEarly = await call(base, 'POST', '/auth/login', { body: { email, secret } });
  assert.equal(tooEarly.status, 401, `signing in before verifying succeeded: ${tooEarly.text}`);

  const verified = await call(base, 'POST', '/auth/verify-email', {
    body: { credential: tokenFrom(verification) },
  });
  // 200 with a body, not 204. `AuthController.verifyEmail` is `@HttpCode(HttpStatus.OK)`
  // and answers `{"status":"verified"}`; asserting 204 here would fail against the
  // shipped controller.
  assert.equal(verified.status, 200, verified.text);
  assert.deepEqual(verified.json, { status: 'verified' });

  const signedIn = await call(base, 'POST', '/auth/login', { body: { email, secret } });
  assert.equal(signedIn.status, 200, signedIn.text);
  assert.equal(signedIn.json.user.email, email);
  assert.ok(signedIn.json.accessToken, 'no access credential in the sign-in response');
  const firstCookie = refreshCookie(signedIn);
  assert.ok(firstCookie, `no renewal cookie was set: ${JSON.stringify(signedIn.setCookie)}`);

  const me = await call(base, 'GET', '/users/me', { token: signedIn.json.accessToken });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.json.email, email);
  assert.equal(me.json.displayName, 'Walker');

  const patched = await call(base, 'PATCH', '/users/me', {
    token: signedIn.json.accessToken,
    body: { displayName: 'Walker Renamed' },
  });
  assert.equal(patched.status, 200, patched.text);
  assert.equal(patched.json.displayName, 'Walker Renamed');

  // `/auth/sessions`, not `/users/me/sessions` — `UsersController` has no such
  // route and answers 404 for it.
  const sessions = await call(base, 'GET', '/auth/sessions', { token: signedIn.json.accessToken });
  assert.equal(sessions.status, 200, sessions.text);
  assert.equal(sessions.json.length, 1, `expected exactly one session, got ${sessions.text}`);
  assert.equal(sessions.json[0].isCurrent, true);

  const renewed = await call(base, 'POST', '/auth/refresh', { cookie: firstCookie });
  assert.equal(renewed.status, 200, renewed.text);
  const secondCookie = refreshCookie(renewed);
  assert.ok(secondCookie, 'renewal returned no new cookie');
  // The RENEWAL credential is what rotates. The access credential is not asserted
  // to differ: its claims are `{sub, sid, iat, exp}` with second granularity, so a
  // renewal in the same second as the sign-in mints a byte-identical JWT. Observed,
  // not hypothesised — the two were equal on the first run of this walk.
  assert.notEqual(secondCookie, firstCookie, 'renewal handed back the same credential');

  const afterRenewal = await call(base, 'GET', '/users/me', { token: renewed.json.accessToken });
  assert.equal(afterRenewal.status, 200, afterRenewal.text);

  // D8. The spent credential, presented a second time.
  const reused = await call(base, 'POST', '/auth/refresh', { cookie: firstCookie });
  assert.equal(reused.status, 401, `D8: a spent renewal credential was accepted: ${reused.text}`);

  // ...and the whole family goes with it, which is the half that distinguishes
  // "this credential was refused" from "this session is over". Asserted through
  // the session list rather than by expecting the access credential to stop
  // working: `JwtStrategy` reads nothing from the database by design, so a
  // credential minted before the revocation keeps working until it expires
  // (`ACCESS_TOKEN_TTL_SECONDS`). That window is the documented trade in
  // `auth/strategies/jwt.strategy.ts`, and asserting a 401 here would be
  // asserting the opposite of what this backend was built to do.
  const successorRefused = await call(base, 'POST', '/auth/refresh', { cookie: secondCookie });
  assert.equal(
    successorRefused.status,
    401,
    `D8: the successor credential survived reuse detection: ${successorRefused.text}`,
  );
  const afterReuse = await call(base, 'GET', '/auth/sessions', { token: renewed.json.accessToken });
  assert.equal(afterReuse.status, 200, afterReuse.text);
  assert.deepEqual(
    afterReuse.json,
    [],
    `D8: the session survived reuse detection: ${afterReuse.text}`,
  );

  const signedInAgain = await call(base, 'POST', '/auth/login', { body: { email, secret } });
  assert.equal(signedInAgain.status, 200, signedInAgain.text);

  // D7, compared to EACH OTHER rather than to a literal, so a branch added to
  // either answer fails this rather than needing somebody to have remembered to
  // update two expectations.
  const known = await call(base, 'POST', '/auth/forgot-password', { body: { email } });
  const unknown = await call(base, 'POST', '/auth/forgot-password', {
    body: { email: 'no-such-person@example.com' },
  });
  assert.equal(known.status, 202, known.text);
  assert.equal(
    unknown.status,
    known.status,
    `D7: the statuses differ — ${known.status} vs ${unknown.status}`,
  );
  assert.equal(
    unknown.text,
    known.text,
    `D7: the bodies differ —\n  known:   ${known.text}\n  unknown: ${unknown.text}`,
  );

  const recovery = await waitForMessage(
    target,
    (message) => message.to === email && /reset/i.test(message.subject),
  );
  const reset = await call(base, 'POST', '/auth/reset-password', {
    body: { credential: tokenFrom(recovery), secret: 'a-different-correct-horse-77' },
  });
  // 200 with a body, not 204 — `AuthController.resetPassword` is
  // `@HttpCode(HttpStatus.OK)` and answers `{"status":"reset"}`.
  assert.equal(reset.status, 200, reset.text);
  assert.deepEqual(reset.json, { status: 'reset' });

  // Recovery ends every session. Asserted the same way D8's is and for the same
  // reason: the pre-reset ACCESS credential keeps working for the rest of its
  // short life by design, so what is checked is that no session remains and that
  // the renewal credential minted before the reset is dead.
  const staleRenewal = await call(base, 'POST', '/auth/refresh', {
    cookie: refreshCookie(signedInAgain),
  });
  assert.equal(
    staleRenewal.status,
    401,
    `recovery left a usable renewal credential behind: ${staleRenewal.text}`,
  );
  const afterReset = await call(base, 'GET', '/auth/sessions', {
    token: signedInAgain.json.accessToken,
  });
  assert.equal(afterReset.status, 200, afterReset.text);
  assert.deepEqual(afterReset.json, [], `recovery left sessions alive: ${afterReset.text}`);

  // The new secret is the one that works now, and the old one is not.
  const withOld = await call(base, 'POST', '/auth/login', { body: { email, secret } });
  assert.equal(withOld.status, 401, `the pre-reset password still signs in: ${withOld.text}`);
  const withNew = await call(base, 'POST', '/auth/login', {
    body: { email, secret: 'a-different-correct-horse-77' },
  });
  assert.equal(withNew.status, 200, withNew.text);
}

/**
 * One statement, one scalar, via `psql` inside the `postgres` container.
 *
 * The idiom {@link proveWhatTheFakeCannotExpress}'s own `ask` already uses,
 * hoisted so {@link walkFederatedSignIn} and {@link walkTheFederatedRefusal}
 * — which run before that function, against identities and sessions rather
 * than the audit log — do not each grow a private copy of it.
 *
 * @param compose - the project-scoped compose runner
 * @param url - the connection string to run as (see `connectionUrlsFrom`)
 * @param sql - the statement, `-tAc` — no header, no alignment, tuples only
 * @returns the trimmed stdout
 */
async function psqlValue(compose, url, sql) {
  const { stdout } = await compose('exec', '-T', 'postgres', 'psql', url, '-tAc', sql);
  return stdout.trim();
}

/**
 * One full round trip through `DevOAuthProvider`: `GET /auth/oauth/OIDC`
 * begins the "sign-in", and following its own `Location` straight back into
 * `GET /auth/oauth/OIDC/callback` completes it — no page, ever, in between
 * (see that adapter's own doc for why). Returns the callback's response,
 * which is where a session's cookie or a refusal's `error=` code lands.
 *
 * @param base - the stack's base URL
 * @returns the callback's own response
 */
async function signInThroughDevProvider(base) {
  const begin = await call(base, 'GET', '/auth/oauth/OIDC');
  assert.equal(begin.status, 302, begin.text);
  assert.ok(begin.location, `no Location header on the dev provider's own redirect: ${begin.text}`);

  // The host on this Location is `PUBLIC_API_URL`, which is `base` itself
  // here (`compose.yaml` pins it to `http://localhost:${BACKEND_PORT}`) — but
  // read from the header rather than assumed, the same discipline the D11
  // unit test's own `follow()` applies to a provider's redirect.
  const target = new URL(begin.location);
  return call(base, 'GET', `${target.pathname}${target.search}`);
}

/**
 * Federated sign-in through the development adapter, against the real stack:
 * `GET /auth/oauth/providers` lists it, a first round trip creates an
 * account, a second signs into the *same* one, and the linked identity shows
 * up at `GET /users/me/identities` — the walk `DevOAuthProvider` exists to
 * make possible with no third-party account (see its own doc, and
 * ADR-0011's R10).
 *
 * The stack was booted with `OAUTH_DEV_ENABLED=1` and
 * `OAUTH_DEV_EMAIL={@link DEV_OAUTH_INITIAL_EMAIL}` from the start (see the
 * `apps/backend/.env` written before `compose up` above) — this address is
 * not registered by anything else in this walk, so "one account, not two"
 * has an unambiguous account to be about.
 *
 * Every claim here is checked against the real database, not only the HTTP
 * response: `FakeDataSource` enforces no unique constraint on
 * `auth_identities`, so "the second round trip did not provision a second
 * account" is invisible to the unit tier no matter how the response reads.
 *
 * @param base - the stack's base URL
 */
async function walkFederatedSignIn(base) {
  const providers = await call(base, 'GET', '/auth/oauth/providers');
  assert.equal(providers.status, 200, providers.text);
  assert.ok(
    Array.isArray(providers.json?.providers) && providers.json.providers.includes('OIDC'),
    `the development provider is not in the configured list: ${providers.text}`,
  );

  const first = await signInThroughDevProvider(base);
  assert.equal(first.status, 302, first.text);
  assert.match(first.location, /\/oauth\/callback/, `landed somewhere unexpected: ${first.location}`);
  assert.ok(
    !/[?&]error=/.test(first.location),
    `the first round trip through the dev provider was refused: ${first.location}`,
  );
  const firstCookie = refreshCookie(first);
  assert.ok(firstCookie, `no renewal cookie was set on account creation: ${JSON.stringify(first.setCookie)}`);

  const renewed = await call(base, 'POST', '/auth/refresh', { cookie: firstCookie });
  assert.equal(renewed.status, 200, renewed.text);
  assert.equal(renewed.json.user.email, DEV_OAUTH_INITIAL_EMAIL);
  assert.ok(renewed.json.accessToken, `no access credential after renewal: ${renewed.text}`);
  const userId = renewed.json.user.id;

  const identitiesAfterFirst = await call(base, 'GET', '/users/me/identities', {
    token: renewed.json.accessToken,
  });
  assert.equal(identitiesAfterFirst.status, 200, identitiesAfterFirst.text);
  assert.equal(
    identitiesAfterFirst.json.length,
    1,
    `expected exactly one identity after the first sign-in, got ${identitiesAfterFirst.text}`,
  );
  assert.equal(identitiesAfterFirst.json[0].provider, 'OIDC');
  assert.equal(identitiesAfterFirst.json[0].providerAccountId, DEV_OAUTH_INITIAL_EMAIL);

  // ---- the same flow, a second time: signs in, does not provision again ----
  const second = await signInThroughDevProvider(base);
  assert.equal(second.status, 302, second.text);
  assert.ok(
    !/[?&]error=/.test(second.location),
    `the second round trip through the dev provider was refused: ${second.location}`,
  );
  const secondCookie = refreshCookie(second);
  assert.ok(secondCookie, `no renewal cookie was set on the second sign-in: ${JSON.stringify(second.setCookie)}`);

  const renewedAgain = await call(base, 'POST', '/auth/refresh', { cookie: secondCookie });
  assert.equal(renewedAgain.status, 200, renewedAgain.text);
  assert.equal(
    renewedAgain.json.user.id,
    userId,
    `the second round trip signed into a DIFFERENT account: first ${userId}, second ${renewedAgain.json.user.id}`,
  );

  const identitiesAfterSecond = await call(base, 'GET', '/users/me/identities', {
    token: renewedAgain.json.accessToken,
  });
  assert.equal(identitiesAfterSecond.status, 200, identitiesAfterSecond.text);
  assert.equal(
    identitiesAfterSecond.json.length,
    1,
    `a second identity row appeared on the second sign-in: ${identitiesAfterSecond.text}`,
  );
}

/**
 * D11, against the real stack: a dev-provider callback whose asserted address
 * already belongs to a password account must not link it or sign anyone in —
 * see ADR-0011 and `oauth.service.ts`'s own
 * `REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT` branch. Proven at the unit tier
 * already, against `FakeDataSource`; this is the one tier where
 * `auth_identities` carries a real foreign key and a real uniqueness
 * invariant to actually violate, so "nothing was linked" is checked against
 * the database those constraints live in, not against a fake that could not
 * enforce them either way.
 *
 * `OAUTH_DEV_EMAIL` is fixed for the life of a container — `DevOAuthProvider`
 * asserts exactly one address, configured once at construction, never per
 * request (see that class's own doc). Rehearsing the collision therefore
 * means pointing it at an address that ALREADY belongs to a seeded password
 * account and rebooting: `apps/backend/.env` is rewritten and only the
 * `backend` service is recreated — `postgres` (which holds the very rows
 * being asserted on) and `webapp` are left untouched, exactly `.env.example`'s
 * own guidance for this variable.
 *
 * @param compose - the project-scoped compose runner
 * @param projectName - the compose project, for diagnostics on a failed recreate
 * @param base - the stack's base URL
 * @param target - the generated project directory, for the outbox and `.env`
 */
async function walkTheFederatedRefusal(compose, projectName, base, target) {
  const COLLISION_EMAIL = 'password-collision@example.com';
  const secret = 'correct-horse-battery-staple-42';

  const registered = await call(base, 'POST', '/auth/register', {
    body: { email: COLLISION_EMAIL, displayName: 'Has A Password Already', secret },
  });
  assert.equal(registered.status, 202, registered.text);
  const verification = await waitForMessage(
    target,
    (message) => message.to === COLLISION_EMAIL && /verify/i.test(message.subject),
  );
  const verified = await call(base, 'POST', '/auth/verify-email', {
    body: { credential: tokenFrom(verification) },
  });
  assert.equal(verified.status, 200, verified.text);

  const { owner } = await connectionUrlsFrom(target);
  const userId = await psqlValue(compose, owner, `SELECT id FROM users WHERE email = '${COLLISION_EMAIL}'`);
  assert.match(userId, /^[0-9a-f-]{36}$/, `the seeded password account is missing: ${userId}`);

  const identitiesBefore = await psqlValue(
    compose, owner, `SELECT count(*) FROM auth_identities WHERE user_id = '${userId}'`,
  );
  const sessionsBefore = await psqlValue(
    compose, owner, `SELECT count(*) FROM sessions WHERE user_id = '${userId}'`,
  );
  assert.equal(
    identitiesBefore,
    '1',
    `the seeded account should hold exactly its password identity before the collision attempt, got ${identitiesBefore}`,
  );

  await fs.writeFile(
    path.join(target, 'apps/backend/.env'),
    'MAIL_OUTBOX_DIR=/app/.mail-outbox\n'
    + 'OAUTH_DEV_ENABLED=1\n'
    + `OAUTH_DEV_EMAIL=${COLLISION_EMAIL}\n`,
  );
  try {
    // `--force-recreate`, not a bare `up -d`: an env_file's content is not
    // part of what compose diffs to decide whether a service needs
    // recreating, so without it `backend` would keep running with
    // `DEV_OAUTH_INITIAL_EMAIL` still configured and this whole function
    // would be asserting nothing. Only `backend` — `postgres` and `webapp`
    // are named nowhere in this call and stay exactly as they were.
    await compose('up', '-d', '--wait', '--wait-timeout', '120', '--force-recreate', 'backend');
  } catch (error) {
    const diagnostics = await composeDiagnostics(target, projectName);
    throw new Error(
      `backend did not come back up after pointing the dev provider at the collision address: `
      + `${error.message}\n\n${diagnostics}`,
    );
  }

  const refused = await signInThroughDevProvider(base);
  assert.equal(refused.status, 302, refused.text);
  assert.match(
    refused.location,
    /[?&]error=EMAIL_ALREADY_REGISTERED\b/,
    `D11: the dev-provider callback did not refuse a colliding address: ${refused.location}`,
  );
  assert.equal(
    refused.setCookie.length,
    0,
    `D11: a renewal cookie was set for a refused, unauthenticated callback: ${JSON.stringify(refused.setCookie)}`,
  );

  const identitiesAfter = await psqlValue(
    compose, owner, `SELECT count(*) FROM auth_identities WHERE user_id = '${userId}'`,
  );
  const sessionsAfter = await psqlValue(
    compose, owner, `SELECT count(*) FROM sessions WHERE user_id = '${userId}'`,
  );
  assert.equal(
    identitiesAfter,
    identitiesBefore,
    `D11: a federated identity was linked to the account despite the refusal — before `
    + `${identitiesBefore}, after ${identitiesAfter}`,
  );
  assert.equal(
    sessionsAfter,
    sessionsBefore,
    `D11: a session was created for the account despite the refusal — before ${sessionsBefore}, `
    + `after ${sessionsAfter}`,
  );

  const refusalRecorded = await psqlValue(
    compose,
    owner,
    "SELECT count(*) FROM audit_entries WHERE action = 'FEDERATED_LINK_REFUSED' "
    + `AND actor_user_id = '${userId}'`,
  );
  assert.equal(
    refusalRecorded,
    '1',
    `D11: no FEDERATED_LINK_REFUSED entry was recorded against the account that already existed: `
    + refusalRecorded,
  );
}

/**
 * Registers, verifies and signs one fresh account in, against the real stack.
 * The building block {@link walkTheTenancyFlow} composes three of.
 *
 * @param base - the stack's base URL
 * @param target - the generated project directory, for the outbox
 * @param email - the address to register
 * @param displayName - the name to register it under
 * @returns the account's email, its access token, and its user id
 */
async function registerVerifyLogin(base, target, email, displayName) {
  const secret = 'correct-horse-battery-staple-42';

  const registered = await call(base, 'POST', '/auth/register', {
    body: { email, displayName, secret },
  });
  assert.equal(registered.status, 202, registered.text);

  const verification = await waitForMessage(
    target,
    (message) => message.to === email && /verify/i.test(message.subject),
  );
  const verified = await call(base, 'POST', '/auth/verify-email', {
    body: { credential: tokenFrom(verification) },
  });
  assert.equal(verified.status, 200, verified.text);

  const signedIn = await call(base, 'POST', '/auth/login', { body: { email, secret } });
  assert.equal(signedIn.status, 200, signedIn.text);
  assert.ok(signedIn.json.accessToken, `no access credential for ${email}: ${signedIn.text}`);

  return { email, token: signedIn.json.accessToken, userId: signedIn.json.user.id };
}

/**
 * Organization creation through to a resource grant and the audit trail that
 * results — the tenancy analogue of {@link walkTheIdentityFlow}, against the
 * real stack: guard, hydrator, service and database all in one process, which
 * no unit tier can assemble.
 *
 * Register → verify → login (three accounts: two organization owners and one
 * invitee) → create an organization → invite the third account → accept →
 * grant it a permission → read `GET /organizations/:id/audit`.
 *
 * **Every entry the walk produces is asserted to carry the ORGANIZATION on
 * it.** That is the end-to-end form of a fault the unit tier already caught
 * once: `AuditEntry.organizationId` shipped nullable and unasserted in the
 * previous phase, and dropping it from the backend's mapper left the whole
 * suite green — three of ten compared fields were `null === null`. Here it is
 * checked against a real column in a real database.
 *
 * **D9 — a second organization, with disjoint members, one request across.**
 * `PermissionsGuard` collapses "no such organization" and "you may not touch
 * this one" into the exact same bare `NotFoundException` (see that guard's
 * own TSDoc for why a `403` would be an enumeration oracle), so what
 * distinguishes a real fix from an implementation that leaks the reason in
 * its body is compared here: not just the status, but the body, byte for
 * byte, between the foreign organization and one that was never issued.
 *
 * @param base - the stack's base URL
 * @param target - the generated project directory, for the outbox
 */
async function walkTheTenancyFlow(base, target) {
  const ownerA = await registerVerifyLogin(base, target, 'tenant-owner-a@example.com', 'Owner A');
  const ownerB = await registerVerifyLogin(base, target, 'tenant-owner-b@example.com', 'Owner B');
  const invitee = await registerVerifyLogin(base, target, 'tenant-member@example.com', 'Invited Member');

  // ---- two organizations, with disjoint membership: A's owner and invitee
  // never belong to B, and B's owner never belongs to A ----
  const createdA = await call(base, 'POST', '/organizations', {
    token: ownerA.token,
    body: { name: 'Tenant Walk Org A', slug: 'tenant-walk-org-a' },
  });
  assert.equal(createdA.status, 201, createdA.text);
  const orgA = createdA.json;

  const createdB = await call(base, 'POST', '/organizations', {
    token: ownerB.token,
    body: { name: 'Tenant Walk Org B', slug: 'tenant-walk-org-b' },
  });
  assert.equal(createdB.status, 201, createdB.text);
  const orgB = createdB.json;

  // ---- invite the third account into A, and accept ----
  const invited = await call(base, 'POST', `/organizations/${orgA.id}/invitations`, {
    token: ownerA.token,
    body: { email: invitee.email, role: 'MEMBER' },
  });
  assert.equal(invited.status, 201, invited.text);

  const invitation = await waitForMessage(
    target,
    (message) => message.to === invitee.email && /invited to join/i.test(message.subject),
  );
  const accepted = await call(base, 'POST', `/invitations/${tokenFrom(invitation)}/accept`, {
    token: invitee.token,
  });
  assert.equal(accepted.status, 201, accepted.text);
  assert.equal(accepted.json.organizationId, orgA.id, `accepted into the wrong organization: ${accepted.text}`);
  assert.equal(accepted.json.userId, invitee.userId);

  // ---- grant the invited member a permission on a resource ----
  const granted = await call(base, 'POST', `/organizations/${orgA.id}/grants`, {
    token: ownerA.token,
    body: {
      subjectUserId: invitee.userId,
      resourceType: 'document',
      resourceId: 'tenant-walk-doc-1',
      permission: 'organization:update',
    },
  });
  assert.equal(granted.status, 201, granted.text);
  assert.equal(granted.json.organizationId, orgA.id, `grant issued against the wrong organization: ${granted.text}`);

  // ---- the audit trail: every step above, WITH the organization on it ----
  const audit = await call(base, 'GET', `/organizations/${orgA.id}/audit?limit=50`, {
    token: ownerA.token,
  });
  assert.equal(audit.status, 200, audit.text);

  const entryFor = (action) => audit.json.data.find((entry) => entry.action === action);
  for (const action of ['ORGANIZATION_CREATED', 'MEMBER_INVITED', 'INVITATION_ACCEPTED', 'GRANT_CREATED']) {
    const entry = entryFor(action);
    assert.ok(entry, `no ${action} entry in the organization's own audit trail: ${audit.text}`);
    assert.equal(
      entry.organizationId,
      orgA.id,
      `${action}'s audit entry carries no organization — a null organizationId here is exactly `
      + `the fault this walk exists to catch, unmasked end to end. Got: ${JSON.stringify(entry)}`,
    );
  }

  // ---- D9: one request across, from a member of A's own accounts, at B ----
  //
  // Compared to a genuinely nonexistent organization, not merely asserted to
  // be a 404: a status match alone would pass for an implementation that
  // answers 404 with a body naming the real reason.
  const absentOrgId = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0';

  for (const actor of [invitee, ownerA]) {
    const crossTenant = await call(base, 'GET', `/organizations/${orgB.id}/audit`, { token: actor.token });
    const noSuchOrg = await call(base, 'GET', `/organizations/${absentOrgId}/audit`, { token: actor.token });

    assert.equal(
      crossTenant.status,
      404,
      `D9: ${actor.email}'s cross-tenant audit read answered ${crossTenant.status}: ${crossTenant.text}`,
    );
    assert.equal(
      crossTenant.status,
      noSuchOrg.status,
      `D9: statuses differ between a foreign organization and one that was never issued for ${actor.email}`,
    );
    // Byte for byte, not merely equal statuses: the whole point of the shared
    // 404 is that "you may not" and "there is no such thing" are the same
    // sentence, not two sentences that happen to carry the same number.
    assert.equal(
      crossTenant.text,
      noSuchOrg.text,
      `D9: bodies differ for ${actor.email} —\n  foreign: ${crossTenant.text}\n  absent:  ${noSuchOrg.text}`,
    );
  }
}

/**
 * D13, at the database, as the application role.
 *
 * Every statement below runs through `psql` inside the `postgres` container with
 * the **application** role's credentials — the ones `compose.yaml` hands the API,
 * not the owner's. Nothing here goes through the API, because the claim is about
 * what the database refuses, not about what the application declines to ask.
 *
 * @param compose - the project-scoped compose runner
 * @param projectName - the compose project, for error messages
 */
async function proveTheAuditLogIsAppendOnly(compose, projectName, target) {
  // The RESTRICTED role's URL, taken out of `compose.yaml` itself — see
  // `connectionUrlsFrom`. Retyping it here would mean this test could go on
  // passing against a role that no longer exists or, worse, against the owner.
  const { app: url } = await connectionUrlsFrom(target);

  /** Runs one statement as the application role; resolves `{ ok, out }` either way. */
  const psql = async (...args) =>
    compose('exec', '-T', 'postgres', 'psql', url, ...args).then(
      (result) => ({ ok: true, out: `${result.stdout}${result.stderr}` }),
      (error) => ({ ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}${error.message}` }),
    );

  // `TRUNCATE` is here on different grounds from the other two, and it is worth
  // being precise: the app role was never GRANTED `TRUNCATE`
  // (`AppRoleAndDefaultPrivileges` grants `SELECT, INSERT, UPDATE, DELETE` and no
  // more), so this line is refused whether or not `AuditAppendOnly`'s `REVOKE`
  // ever ran. It therefore discriminates the OWNERSHIP fault — an owner can
  // truncate — and nothing about the revoke. `UPDATE` and `DELETE` are the two
  // that speak to the revoke.
  for (const statement of [
    "UPDATE audit_entries SET action = 'TAMPERED' WHERE true",
    'DELETE FROM audit_entries WHERE true',
    'TRUNCATE audit_entries',
  ]) {
    const refused = await psql('-c', statement);
    assert.equal(refused.ok, false, `D13: the application role was allowed to run: ${statement}`);
    assert.match(
      refused.out,
      /permission denied for table audit_entries/,
      `D13: ${statement} failed, but not for the reason this test is about:\n${refused.out}`,
    );
  }

  // Append-ONLY, not read-only. Both halves matter: a table the application
  // cannot write at all would pass the three assertions above while making the
  // audit log impossible to keep.
  const selected = await psql('-tAc', 'SELECT action FROM audit_entries ORDER BY occurred_at');
  assert.equal(selected.ok, true, `D13: the application role cannot read the log:\n${selected.out}`);
  for (const action of ['USER_REGISTERED', 'LOGIN_SUCCEEDED', 'SESSION_REUSE_DETECTED']) {
    assert.match(
      selected.out,
      new RegExp(action),
      `D13: the walk's ${action} entry is not in the log:\n${selected.out}`,
    );
  }

  const inserted = await psql('-c', "INSERT INTO audit_entries (action) VALUES ('E2E_PROBE')");
  assert.equal(inserted.ok, true, `D13: the application role cannot append:\n${inserted.out}`);

  // The assertion that makes it a guarantee rather than a configuration detail.
  //
  // **The self-grant does not fail, and asserting that it does would pass for the
  // wrong reason.** Postgres answers a grant of a privilege the grantor does not
  // hold with `WARNING: no privileges were granted`, reports `GRANT`, and exits
  // 0. Verified again here at Postgres 16. So what is asserted is the only thing
  // that distinguishes "it was refused" from "it worked": the privilege itself,
  // after the attempt.
  const grant = await psql('-c', 'GRANT UPDATE ON audit_entries TO CURRENT_USER');
  assert.equal(grant.ok, true, `expected the self-grant to exit 0 with a warning:\n${grant.out}`);
  assert.match(grant.out, /no privileges were granted/, grant.out);

  const privilege = await psql(
    '-tAc',
    "SELECT has_table_privilege(CURRENT_USER, 'audit_entries', 'UPDATE')",
  );
  assert.equal(privilege.ok, true, privilege.out);
  assert.equal(
    privilege.out.trim(),
    'f',
    'D13 IS DECORATIVE: the application role granted itself UPDATE on audit_entries back. '
    + `The two-role design in db/migrations/ does not hold in project ${projectName}.`,
  );
}

/**
 * The four properties `FakeDataSource` is structurally unable to express.
 *
 * Its own docblock lists them: with no transactions it cannot express
 * atomicity, with no unique constraints it cannot express a duplicate, with no
 * schema it cannot express drift, and with no referential integrity it cannot
 * express a cascade. A unit test asserting any of them passes whatever the code
 * does. This is the first place a real database exists, so it is the only place
 * they are either true or false.
 *
 * Audit immutability — the first of the four — is proved by
 * {@link proveTheAuditLogIsAppendOnly}, over exactly the `UPDATE` and `DELETE`
 * the two unit tests that lean on it assume.
 *
 * @param compose - the project-scoped compose runner
 * @param base - the stack's base URL
 * @param target - the generated project directory
 */
async function proveWhatTheFakeCannotExpress(compose, base, target) {
  const { owner } = await connectionUrlsFrom(target);
  const ask = async (sql) => {
    const { stdout } = await compose('exec', '-T', 'postgres', 'psql', owner, '-tAc', sql);
    return stdout.trim();
  };

  // ---- Unique constraints: duplicate registration under a race. ----
  //
  // `AuthService.register` answers a unique violation identically to a fresh
  // registration rather than as a 409, which is only meaningful if the
  // constraint is what stops the second account existing. Four concurrent
  // registrations of one address, which is what actually exercises it: a
  // check-then-insert wins this race as often as it loses.
  /**
   * One round of four concurrent registrations of one fresh address.
   *
   * @returns the contested address, the four responses, and how many
   *   registrations anywhere in this run lost on a unique violation
   */
  const raceOnce = async () => {
    const contested = `race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const attempts = await Promise.all(
      [0, 1, 2, 3].map(() =>
        call(base, 'POST', '/auth/register', {
          body: {
            email: contested,
            displayName: 'Racer',
            secret: 'correct-horse-battery-staple-42',
          },
        }),
      ),
    );
    // The two branches `register` reaches "exactly one account" through are
    // already distinguishable in the audit table: the check-then-insert records
    // the existing owner as the actor with empty metadata, the unique violation
    // records a NULL actor and `{lostRace:true}`.
    const lost = Number(
      await ask(
        "SELECT count(*) FROM audit_entries WHERE action = 'DUPLICATE_REGISTRATION_ATTEMPTED'"
        + " AND actor_user_id IS NULL AND metadata->>'lostRace' = 'true'",
      ),
    );
    return { contested, attempts, lost };
  };

  // Retried, because the property under test only exists in the rounds that
  // genuinely interleave. **`count(users) = 1` on its own is not evidence of a
  // unique constraint** — `AuthService.register`'s check-then-insert produces
  // that result too, so an assertion that stops there passes against a schema
  // with no constraint at all, which is the precise property Step 3c exists to
  // prove. Proven to fire: with the four registrations issued sequentially, so
  // that no round can interleave, this fails with "not one lost on a UNIQUE
  // violation" while `count(users) = 1` still passes.
  //
  // Three rounds rather than one, because a round that fails to interleave is a
  // scheduling accident and not a fault, and failing a gate for one would be a
  // flake. The count is over the whole run, so it never decreases.
  let race = await raceOnce();
  for (let round = 1; round < 3 && race.lost === 0; round += 1) {
    race = await raceOnce();
  }
  const { contested, attempts } = race;

  const shapes = new Set(attempts.map((attempt) => `${attempt.status}|${attempt.text}`));
  assert.equal(
    shapes.size,
    1,
    `concurrent registrations of one address were distinguishable: ${JSON.stringify([...shapes])}`,
  );
  assert.equal(attempts[0].status, 202, attempts[0].text);
  assert.equal(
    race.lost >= 1,
    true,
    'across three rounds of four concurrent registrations, not one lost on a UNIQUE violation — '
    + 'every duplicate was caught by the check-then-insert instead, so nothing here proves the '
    + 'constraint exists. Audit rows on the losing branch: 0.',
  );
  assert.equal(
    await ask(`SELECT count(*) FROM users WHERE email = '${contested}'`),
    '1',
    'four concurrent registrations of one address produced more than one account — '
    + 'the unique constraint is not what it is assumed to be',
  );
  assert.equal(
    await ask(`SELECT count(*) FROM auth_identities WHERE provider_account_id = '${contested}'`),
    '1',
    'the race produced more than one password identity for one address',
  );

  // ---- Entity-versus-migration drift. ----
  //
  // A column an entity declares and no migration ever created is invisible to
  // every unit suite — the fake does no schema checking at all — and surfaces at
  // runtime as a query error on whichever request first touches it. The probe
  // asks TypeORM for its own column metadata and asks the database which columns
  // exist. Proven to fire: adding a column to `UserRecord` that no migration
  // creates makes it report
  // `users.never_created_by_any_migration declared by UserRecord but absent`.
  const { stdout: drift } = await compose(
    'exec',
    '-T',
    '--workdir',
    '/app/apps/backend',
    'backend',
    'sh',
    '-lc',
    'TS_NODE_PROJECT=tsconfig.json npx ts-node -r tsconfig-paths/register drift-probe.ts',
  );
  const report = JSON.parse(drift.trim().split('\n').pop());
  assert.deepEqual(report.problems, [], `entity/migration drift:\n${JSON.stringify(report, null, 2)}`);
  // Named, not counted. This began as `report.tables.length === 7` and went stale the moment
  // Phase 3 added four tables — and stayed stale, because the only tier that runs this file
  // was PR-only until Task 20 moved it onto push. A count also fails uselessly: it says a
  // number changed, not which table appeared or, far worse, which one stopped being mapped.
  // The list is what makes both directions legible, and the assertion's real job is
  // anti-vacuity — a probe that mapped nothing must not pass by having nothing to report.
  assert.deepEqual(
    [...report.tables].sort(),
    [
      'audit_entries', 'auth_identities', 'email_verification_tokens', 'memberships',
      'oauth_authorization_requests', 'organization_invitations', 'organizations',
      'password_reset_tokens', 'refresh_tokens', 'resource_grants', 'sessions', 'users',
    ],
    `the set of tables TypeORM maps has changed. Got: ${[...report.tables].sort().join(', ')}. `
    + 'A new domain means adding its tables here; a table DISAPPEARING from this list means an '
    + 'entity stopped being registered, which no unit suite can see.',
  );

  // ---- Foreign keys, cascades, and the one table that deliberately has none. ----
  //
  // `audit_entries` carries no foreign key on purpose: a referential action runs
  // with the TABLE OWNER's privileges, so an `ON DELETE CASCADE` or `SET NULL`
  // pointing here would let a statement aimed at `users` erase or rewrite audit
  // history straight past the revoke, which cannot see it. This asserts the
  // shape (no foreign key at all) and then the behaviour (delete the account and
  // watch the history survive with its actor intact).
  assert.equal(
    await ask(
      "SELECT count(*) FROM pg_constraint WHERE conrelid = 'audit_entries'::regclass AND contype = 'f'",
    ),
    '0',
    'audit_entries has a foreign key. Referential actions run with the table owner\'s '
    + 'privileges, so this is a documented way to erase audit history that the REVOKE '
    + 'cannot catch — see db/migrations/1758000002000-AuditAppendOnly.ts.',
  );

  const walker = await ask("SELECT id FROM users WHERE email = 'walker@example.com'");
  assert.match(walker, /^[0-9a-f-]{36}$/, `the walk's account is missing: ${walker}`);
  const countsFor = async () => ({
    identities: await ask(`SELECT count(*) FROM auth_identities WHERE user_id = '${walker}'`),
    sessions: await ask(`SELECT count(*) FROM sessions WHERE user_id = '${walker}'`),
    verifications: await ask(
      `SELECT count(*) FROM email_verification_tokens WHERE user_id = '${walker}'`,
    ),
    resets: await ask(`SELECT count(*) FROM password_reset_tokens WHERE user_id = '${walker}'`),
    audit: await ask(`SELECT count(*) FROM audit_entries WHERE actor_user_id = '${walker}'`),
  });

  const before = await countsFor();
  for (const [table, count] of Object.entries(before)) {
    assert.notEqual(count, '0', `the walk left nothing in ${table}, so nothing here is being tested`);
  }

  await compose('exec', '-T', 'postgres', 'psql', owner, '-c', `DELETE FROM users WHERE id = '${walker}'`);

  const after = await countsFor();
  assert.deepEqual(
    { ...after, audit: undefined },
    { identities: '0', sessions: '0', verifications: '0', resets: '0', audit: undefined },
    `deleting the account did not cascade: before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
  );
  assert.equal(
    after.audit,
    before.audit,
    'deleting the account took its audit history with it. That is what a foreign key on '
    + 'audit_entries does, and it happens with the table owner\'s privileges, so the '
    + 'REVOKE that makes this log append-only does not apply to it.',
  );
}

/**
 * R10, against the real production image: `NODE_ENV=production` together
 * with `OAUTH_DEV_ENABLED` must refuse to boot at all, not merely decline to
 * register the adapter. `buildOAuthProviders` (`oauth.config.ts`) throws
 * synchronously while `AuthModule`'s providers are being built, which is
 * before `NestFactory.create`'s promise ever resolves — `main.ts`'s
 * `bootstrap()` is called with no `.catch`, so that rejection is unhandled and
 * Node exits non-zero. A unit test already drives `buildOAuthProviders`
 * directly and asserts the throw; what it cannot show is that the *shipped
 * artifact* — the compiled `prod` image, `NODE_ENV` pinned in
 * `compose.prod.yaml`'s own `environment:` exactly as a real deployment would
 * see it — actually dies rather than serving. This is that proof, against the
 * same `prodapp-backend:local` image the rest of this test already built and
 * booted successfully.
 *
 * `docker compose run --rm --no-deps`, not `up`: `backend`'s own
 * `restart: unless-stopped` would otherwise put a crashing container into a
 * restart loop this assertion would have to race against — polling for a
 * state that may flip between "restarting" and "exited" from one moment to
 * the next. `run` starts one throwaway container from the same image and
 * hands back its real exit status directly, with nothing to race. `--no-deps`
 * only skips *starting* `postgres`/`migrate` again — both are already up and
 * healthy from earlier in this same test, on the same compose network, so
 * `DATABASE_URL` still resolves; it plays no part in which error wins, since
 * the OAuth guard throws before any provider that would need it is built.
 *
 * @param prod - the project-scoped, `compose.prod.yaml`-pinned compose runner
 */
async function proveProductionRefusesTheDevProvider(prod) {
  const attempt = await prod(
    'run', '--rm', '--no-deps',
    '-e', 'OAUTH_DEV_ENABLED=1',
    '-e', 'OAUTH_DEV_EMAIL=refused-in-production@example.test',
    'backend',
  ).then(
    (result) => ({ ok: true, out: `${result.stdout}${result.stderr}` }),
    (error) => ({ ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}${error.message}` }),
  );

  assert.equal(
    attempt.ok,
    false,
    `the production backend booted successfully with OAUTH_DEV_ENABLED=1 and NODE_ENV=production, `
    + `rather than refusing to start:\n${attempt.out}`,
  );
  assert.match(
    attempt.out,
    /OAUTH_DEV_ENABLED is set with NODE_ENV=production/,
    `the backend exited, but not for the reason this test is about:\n${attempt.out}`,
  );
}

/**
 * The production images, booted — which until this test nothing had ever done.
 *
 * A smoke check and not a second walk. Two prod-only defects were found by hand
 * in this phase and both were invisible to jest and to the dev stack because
 * both of those run from `src/`: `migration:run:prod` was a silent no-op that
 * would have shipped an empty schema, and `nest-cli.json` copied `i18n/**` to a
 * path the compiled `app.module.js` does not resolve, so the image did not boot
 * at all. One build, `GET /health`, gone — that is what would have caught either.
 *
 * **The webapp's production image is booted too, and it is not a formality.**
 * `apps/webapp/Dockerfile`'s prod stage copies `.output` and **no
 * `node_modules`**, while the webapp imports runtime *values* — not only types —
 * from the workspace core package on the SSR path (`normalizeEmail` and
 * `AuthenticationStatus` in `LoginForm.vue`, `User` in `stores/auth.ts`, the
 * error classes in `pages/reset-password.vue`). If Nitro externalises that
 * package instead of bundling it, `node .output/server/index.mjs` dies at its
 * first import with `MODULE_NOT_FOUND`. That is the identical failure shape to
 * the prod stage that never copied `libs/core/dist`, which only an image build
 * found. `nx build webapp` in the generated-project tier proves `.output` is
 * *produced*; nothing proved it *runs*.
 *
 * The two images are built one after the other rather than together, so a
 * machine that runs out of disk does so with one build's worth of diagnosis
 * rather than two.
 */
test(
  'the production images boot: the backend serves /health and the webapp serves a page',
  { skip: !enabled && 'set FORGE_E2E=1' },
  async () => {
    const { target, projectName } = await generateProject('prodapp');

    const prod = (...args) =>
      run('docker', ['compose', '-f', 'compose.prod.yaml', '-p', projectName, ...args], {
        cwd: target,
        maxBuffer: 64 * 1024 * 1024,
      });

    const [backendPort, webappPort] = await Promise.all([getFreePort(), getFreePort()]);
    const env = [
      'POSTGRES_DB=prodapp',
      'POSTGRES_USER=prodapp',
      'POSTGRES_PASSWORD=prodapp-owner-local-smoke-test',
      'APP_DB_ROLE=prodapp-app',
      'APP_DB_PASSWORD=prodapp-app-local-smoke-test',
      'JWT_SECRET=prodapp-local-smoke-test-signing-key',
      // The origin every mail link is built from, and now also the origin the
      // backend is told to allow: `compose.prod.yaml` derives `CORS_ORIGIN` from
      // `WEBAPP_PORT`, so naming a different port here would be a stack that
      // mails links to one place and accepts requests from another.
      `PUBLIC_WEBAPP_URL=http://localhost:${webappPort}`,
      // The origin every federated provider redirect URI is built from —
      // `compose.prod.yaml` pins `PUBLIC_API_URL: ${PUBLIC_API_URL:?required}`
      // on the `backend` service with no default, so without this line
      // `docker compose config` (and therefore `up`) refuses to resolve at
      // all, before a single image builds. Missing here for a time even
      // after the compose file started requiring it — this test is the one
      // thing that would have caught that gap, and until this line existed
      // it hadn't been run since the requirement was added.
      `PUBLIC_API_URL=http://localhost:${backendPort}`,
      `BACKEND_PORT=${backendPort}`,
      `WEBAPP_PORT=${webappPort}`,
      '',
    ].join('\n');
    await fs.writeFile(path.join(target, '.env'), env);

    // Every production credential is `${…:?required}` in compose.prod.yaml, and
    // that is worth asserting rather than assuming: a default would be a
    // credential shared by every project generated from this template. Checked
    // before anything is built, because `config` needs no image.
    for (const missing of [
      'JWT_SECRET', 'POSTGRES_PASSWORD', 'APP_DB_ROLE', 'PUBLIC_WEBAPP_URL', 'PUBLIC_API_URL',
    ]) {
      await fs.writeFile(
        path.join(target, '.env'),
        env.split('\n').filter((line) => !line.startsWith(`${missing}=`)).join('\n'),
      );
      const refused = await prod('config').then(
        () => null,
        (error) => `${error.stdout ?? ''}${error.stderr ?? ''}`,
      );
      assert.ok(
        refused !== null,
        `compose.prod.yaml resolved with no ${missing}. A production stack must refuse to `
        + 'start rather than fall back to a value every generated project shares.',
      );
      assert.match(refused, new RegExp(missing));
    }
    await fs.writeFile(path.join(target, '.env'), env);

    try {
      try {
        await prod('up', '-d', '--build', '--wait', '--wait-timeout', '900', 'backend');
      } catch (error) {
        const diagnostics = await composeDiagnostics(target, projectName, ['compose.prod.yaml']);
        throw new Error(`the production stack did not come up: ${error.message}\n\n${diagnostics}`);
      }

      const health = await call(`http://localhost:${backendPort}`, 'GET', '/health');
      assert.equal(health.status, 200);
      assert.deepEqual(health.json, { status: 'ok' });

      // `migration:run:prod` loads its data source from `dist/`, and shipped for a
      // while as a silent no-op that reported success against an empty database.
      // The image booting proves the entities resolve; this proves the schema is
      // there.
      const { stdout: tables } = await prod(
        'exec', '-T', 'postgres', 'psql',
        'postgresql://prodapp:prodapp-owner-local-smoke-test@localhost:5432/prodapp',
        '-tAc', "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'",
      );
      assert.equal(
        Number(tables.trim()) >= 8,
        true,
        `the production migrations ran but created almost nothing (${tables.trim()} tables). `
        + 'That is what `migration:run:prod` reporting "No migrations are pending" looks like.',
      );

      // ---- the webapp's production image, second and separately ----
      try {
        await prod('up', '-d', '--build', '--wait', '--wait-timeout', '900', 'webapp');
      } catch (error) {
        const diagnostics = await composeDiagnostics(target, projectName, ['compose.prod.yaml']);
        throw new Error(
          'the production WEBAPP image did not come up. The prod stage copies `.output` and no '
          + '`node_modules`; if Nitro externalised the workspace core package rather than '
          + `bundling it, this is MODULE_NOT_FOUND at the first import. ${error.message}`
          + `\n\n${diagnostics}`,
        );
      }

      const page = await call(`http://localhost:${webappPort}`, 'GET', '/');
      // 200 and not merely "the container is up": a Nitro server whose SSR throws
      // still answers, with a 500 error page, from a container the healthcheck
      // may well have passed on an earlier request.
      assert.equal(page.status, 200, `the production webapp answered ${page.status}:\n${page.text}`);
      assert.match(page.text, /<!DOCTYPE html>/i, `not an HTML document:\n${page.text.slice(0, 500)}`);
      assert.match(
        page.text,
        /id="__nuxt"/,
        `the page carries no Nuxt root, so this is not the app:\n${page.text.slice(0, 500)}`,
      );

      // The dev-provider production refusal is proven in its OWN test
      // ('the production backend refuses to boot with the development OAuth
      // provider enabled', below) rather than tacked on here. This test
      // already builds both prod images — the one thing standing between a
      // generated project and shipping a broken production image, and this
      // headroom-tight host cannot always carry a third check (a one-off
      // `docker compose run`) inside that same build. The refusal check
      // needs only the backend image, which this test also builds, so
      // splitting it costs a second `--build backend` in the other test
      // rather than a bigger build in this one.
    } finally {
      // `--rmi local` removes `<project>-webapp` (no explicit `image:` in the
      // compose file) but NOT the backend: `x-backend-image` gives that one an
      // explicit tag, which makes it a custom-tagged image compose declines to
      // delete. It is removed by name instead, and by name only — nothing on this
      // machine is removed that this test did not build.
      await prod('down', '-v', '--rmi', 'local').catch((error) => {
        process.stderr.write(`warning: production down -v failed: ${error.message}\n`);
      });
      await run('docker', ['image', 'rm', 'prodapp-backend:local']).catch(() => {});
    }
  },
);

/**
 * R10, against the real production image — split off from the test above on
 * purpose.
 *
 * This host's Docker headroom is tight enough that the two prod images the
 * test above builds (backend and webapp, together the thing standing between
 * a generated project and shipping a broken production build) do not
 * reliably leave room for a third build inside the same run. This assertion
 * needs only the backend image — never the webapp, which plays no part in
 * R10 — so it gets its own project, its own generated directory, and its own
 * teardown, rather than costing the webapp check a build it does not need.
 * `proveProductionRefusesTheDevProvider`'s own doc has the rest of the
 * reasoning (`docker compose run --rm --no-deps`, not `up`, and why).
 */
test(
  'the production backend refuses to boot with the development OAuth provider enabled',
  { skip: !enabled && 'set FORGE_E2E=1' },
  async () => {
    const { target, projectName } = await generateProject('prodrefusal');

    const prod = (...args) =>
      run('docker', ['compose', '-f', 'compose.prod.yaml', '-p', projectName, ...args], {
        cwd: target,
        maxBuffer: 64 * 1024 * 1024,
      });

    const [backendPort, webappPort] = await Promise.all([getFreePort(), getFreePort()]);
    // The full set of `:?required` production variables, exactly as the other
    // production test provides them — `compose.prod.yaml`'s `backend` service
    // needs every one of them to resolve at all, whether or not `webapp` is
    // ever built. `WEBAPP_PORT` is still required even with no `webapp`
    // service here: `CORS_ORIGIN` and `PUBLIC_WEBAPP_URL` are both derived
    // from it, and neither is conditional on the service existing.
    const env = [
      'POSTGRES_DB=prodrefusal',
      'POSTGRES_USER=prodrefusal',
      'POSTGRES_PASSWORD=prodrefusal-owner-local-smoke-test',
      'APP_DB_ROLE=prodrefusal-app',
      'APP_DB_PASSWORD=prodrefusal-app-local-smoke-test',
      'JWT_SECRET=prodrefusal-local-smoke-test-signing-key',
      `PUBLIC_WEBAPP_URL=http://localhost:${webappPort}`,
      `PUBLIC_API_URL=http://localhost:${backendPort}`,
      `BACKEND_PORT=${backendPort}`,
      `WEBAPP_PORT=${webappPort}`,
      '',
    ].join('\n');
    await fs.writeFile(path.join(target, '.env'), env);

    try {
      try {
        // `backend` only — `migrate` runs first regardless, as its own
        // `depends_on: condition: service_completed_successfully`, and
        // `webapp` is never named so it is never built.
        await prod('up', '-d', '--build', '--wait', '--wait-timeout', '900', 'backend');
      } catch (error) {
        const diagnostics = await composeDiagnostics(target, projectName, ['compose.prod.yaml']);
        throw new Error(`the production backend did not come up: ${error.message}\n\n${diagnostics}`);
      }

      // Proves the image this refusal is about to be checked against is a
      // working one — the refusal below means nothing if the backend never
      // serves at all for some unrelated reason.
      const health = await call(`http://localhost:${backendPort}`, 'GET', '/health');
      assert.equal(health.status, 200, `the production backend that R10 is checked against never came up healthy: ${health.text}`);

      await proveProductionRefusesTheDevProvider(prod);
    } finally {
      await prod('down', '-v', '--rmi', 'local').catch((error) => {
        process.stderr.write(`warning: production refusal down -v failed: ${error.message}\n`);
      });
      await run('docker', ['image', 'rm', 'prodrefusal-backend:local']).catch(() => {});
    }
  },
);

/**
 * The drift probe, written into the generated project and run once inside it.
 *
 * It is a string here rather than a file in `tests/` because it has to run where
 * the project's own `typeorm`, `ts-node` and path mappings are, which is inside
 * the container; `tests/` is not on any path the container can see.
 *
 * Directional on purpose. It asks whether every column an entity declares exists
 * in the database, and not the reverse: the migrations deliberately create things
 * no entity declares — every foreign key, every `DEFAULT now()`, every
 * `COMMENT ON`, and `uq_users_email` — so `typeorm migration:generate` reports 26
 * statements' worth of "drift" against a perfectly correct schema and cannot be
 * used as this gate. (Run, not assumed: the generated migration's `up()` was 26
 * `DROP CONSTRAINT`/`DROP DEFAULT`/`COMMENT … IS NULL` statements.) What actually
 * breaks a running application is the other direction, and that is what this asks.
 */
const DRIFT_PROBE = `import ds from './src/db/data-source';

(async () => {
  await ds.initialize();
  const problems: string[] = [];
  for (const meta of ds.entityMetadatas) {
    const rows: Array<{ column_name: string }> = await ds.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
      [meta.tableName],
    );
    if (rows.length === 0) {
      problems.push('table missing: ' + meta.tableName);
      continue;
    }
    const present = new Set(rows.map((row) => row.column_name));
    for (const column of meta.columns) {
      if (!present.has(column.databaseName)) {
        problems.push(
          meta.tableName + '.' + column.databaseName + ' declared by ' + meta.name + ' but absent from the database',
        );
      }
    }
  }
  console.log(JSON.stringify({ tables: ds.entityMetadatas.map((meta) => meta.tableName), problems }));
  await ds.destroy();
})();
`;
