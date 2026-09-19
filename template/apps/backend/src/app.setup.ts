import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';

/**
 * Everything the running application is configured with that is not a module.
 *
 * **It exists so that `main.ts` has nothing in it worth deleting.** `main.ts` is
 * imperative, runs only under `node`, and is excluded from coverage — so every
 * line in it is a line no test can see. That was measured rather than assumed: a
 * review deleted `cookieParser`, the global exception filter, the global
 * validation pipe and CORS credentials from `main.ts` one at a time, and the
 * backend suite stayed green at 165 tests for all four. Two of those deletions
 * are security regressions that would have shipped in every generated project.
 *
 * Everything that can be a module provider IS one — the guard, the validation
 * pipe, the exception filter and the response interceptor are all `APP_*`
 * providers in `app.module.ts`, where module metadata makes them assertable
 * without starting anything. What is left here is the residue that Nest has no
 * declarative form for: middleware, and CORS. `__tests__/composition-root.spec.ts`
 * calls **this function** — not a copy of it — against a probe application, so
 * deleting a line here turns a test red.
 *
 * ## What this does NOT do, stated precisely because the loose version is wrong
 *
 * It does not make `main.ts` safe. `main.ts` is excluded from coverage outright
 * (`jest.config.ts`: `'!main.ts'`) and no spec imports it, so **nothing notices
 * anything added to `bootstrap()`** — measured: dropping `{ rawBody: true }`,
 * changing the `PORT` default, deleting `app.listen(port)` entirely, and adding
 * a second `app.enableCors({ origin: true, credentials: true })` *after* the
 * call below (which silently widens CORS to every origin) each leave the whole
 * suite green.
 *
 * What moving the configuration here bought is a much smaller untested surface,
 * not a protected one: the four things that used to live in `bootstrap()` are
 * now assertable, and what remains there is three lines. Anyone adding a fourth
 * is adding it somewhere no test looks — which is the reason to put it here
 * instead.
 *
 * @param app - the application to configure, before it starts listening
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  // The renewal credential is carried in a cookie the browser will not let
  // script read (`auth/refresh-cookie.ts`), so something has to parse the
  // `Cookie` header before a handler can see it. No signing secret is passed,
  // and that is deliberate: a signed cookie proves this server set the value,
  // which for this credential is already established by looking the value up —
  // the server stores a hash of it and a forged one matches no row. A second
  // secret here would be one more thing to rotate for no property gained.
  app.use(cookieParser());

  // `credentials: true` is what allows the browser to send the renewal cookie at
  // all on a cross-origin request, which the webapp's own origin is. Without it
  // the cookie is set and then never sent back, and renewal fails for every
  // caller that is not same-origin — silently, with a 401 that looks like an
  // expired session.
  const corsOrigin = config.get<string>('CORS_ORIGIN', 'http://localhost:3001');
  app.enableCors({ origin: corsOrigin, credentials: true });
}
