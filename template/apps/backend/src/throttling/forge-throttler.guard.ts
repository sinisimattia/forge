import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { TooManyAttemptsError } from '__FORGE_SCOPE__/core/shared/errors';
import { assertNever, normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';
import { hashOpaqueToken } from '../common/crypto';
import { bucketOf } from './throttled.decorator';
import { BUCKET_SUBJECT, ThrottleSubject } from './throttling.config';

/**
 * The framework's throttler, adapted where the library publishes a seam and
 * replaced nowhere.
 *
 * ## The subject is never the network address
 *
 * The library's own tracker is the request's address. This application cannot
 * use it. Nothing configures a trusted proxy, and `auth/client-context.ts`
 * records that the address and the label it collects are never trusted for a
 * decision — so behind a proxy the observed address is the proxy's, identical
 * for every caller, and a budget keyed on it would meter the whole userbase as
 * one. Declaring the proxy trusted would make the address client-supplied,
 * which both defeats the budget and turns it into a way to deny service to
 * somebody else's account.
 *
 * What is counted instead is something the server minted or the attack targets.
 *
 * ## What these budgets do not cover
 *
 * Stated rather than half-covered, because a budget that looks like it covers a
 * case and does not is worse than none.
 *
 * **An attacker spreading a few attempts across many accounts from one host.**
 * Every subject here is per-account or per-attempt, so a run that touches each
 * one once is within every budget. Catching it needs a trustworthy network
 * identity, which this deployment does not have.
 *
 * **Guessing a single-use credential.** {@link ThrottleSubject.RESET_CREDENTIAL}
 * is the credential presented, so every guess in a run is a different subject
 * with its own fresh count — the budget bounds repeated presentation of *one*
 * credential, such as a spent link being retried, and nothing else. What bounds
 * guessing is the credential's own entropy. The alternative would be to resolve
 * the credential before counting it, which is a database read in a tracker and
 * the account-existence oracle below, for a budget that still could not refuse
 * the first guess at each of a million credentials.
 *
 * ## An address is counted whether or not it names anybody
 *
 * {@link ThrottleSubject.ADDRESS} is taken from the request, not from a lookup.
 * Counting only addresses that resolve to an account would make a refusal and a
 * rejection distinguishable, and the budget built to harden signing in would
 * become a way to ask whether somebody has an account here. That is the rule
 * ADR-0005 states and core's `AuthenticationRejectionReason` models — why an
 * attempt failed is recorded and never returned — reached from a direction
 * neither of them describes:
 * nothing has to be in the answer for the answer to tell you something, and a
 * route that refuses the tenth attempt on a registered address and the
 * hundredth on an unregistered one has said which is which.
 *
 * ## A route with no bucket is not throttled
 *
 * `shouldSkip` is true wherever `@Throttled` is absent. A global guard that
 * metered everything by default would meter each route on whatever subject
 * happened to be present, which for most of them is nothing.
 *
 * ## The bucket, not the route, is the budget
 *
 * `generateKey` is overridden so a key is the bucket and the subject and
 * nothing else. The library's own builds in the controller class and the
 * handler name, which would give each route its own counter inside a shared
 * bucket: two routes answering one challenge would each permit the full
 * `mfa-attempt` limit against it, so the budget a reader sees configured would
 * be multiplied by however many routes draw on it. The key is hashed, as the
 * library's is, because a tracker holds an address or a single-use credential
 * in the clear and `rate_limit_counters` is not a place to keep either.
 *
 * ## It runs after authentication, not before
 *
 * `GLOBAL_PROVIDERS` lists this guard below `JwtAuthGuard`, and the order is
 * load-bearing in both directions. {@link ThrottleSubject.ACCOUNT_OR_CHALLENGE}
 * reads the signed-in account off the request, which exists only once
 * authentication has put it there; running first would silently demote every
 * authenticated route to the shared no-subject budget. And on a route that
 * requires a credential, running first would let somebody with no credential at
 * all fill that shared budget and refuse everybody else.
 */
@Injectable()
export class ForgeThrottlerGuard extends ThrottlerGuard {
  /**
   * The subject of a request from which the subject kind in hand could read
   * nothing at all.
   *
   * Such requests share a single budget rather than getting one each, which would grow
   * the table without bound, and rather than being refused, which would make a
   * malformed body a server error. What lands here is what validation rejects a
   * moment later — it is not a place a legitimate caller is expected to be.
   * That is a property of every subject read below, not of this constant. A
   * presented bearer credential is a subject too, for a request that carries one
   * and no account and no challenge: a route that does not verify the credential
   * before the throttler runs, such as the sign-in routes a caller reaches with
   * a stale or bogus bearer. A route whose legitimate callers can land here
   * shares one budget between all of them, and anybody can drain it.
   */
  public static readonly MALFORMED = 'malformed';

  /** Reads a subject off the raw request. `public static` so a test can drive it directly. */
  public static subjectOf(subject: ThrottleSubject, request: Record<string, any>): string {
    const body: Record<string, unknown> = request['body'] ?? {};
    // The guard runs ahead of the validation pipe, so every one of these fields
    // is whatever the caller sent: absent, null, an object, an array. A value
    // that is not a non-empty string is no subject at all, and saying so in one
    // place is what keeps every branch below from having its own opinion.
    const text = (value: unknown): string | null =>
      typeof value === 'string' && value.length > 0 ? value : null;
    // The challenge presented, or failing that the bearer credential presented.
    //
    // The second covers a request that carries a bearer and no challenge where
    // no account was established ahead of this guard — a route that does not
    // verify the credential first, such as `/auth/mfa/methods` and
    // `/auth/mfa/verify` reached with a stale or bogus bearer. Routes marked
    // `@ReadsSession()` have their credential verified by the global guard, so
    // they never get here with one.
    //
    // It is a digest of the credential, never the identity inside it. Decoding
    // a credential without verifying it would let a caller name any account and
    // drain a chosen victim's budget; a digest of an opaque string can only be
    // reached by presenting the same string. The digest uses the helper this
    // backend digests every stored token with. It is defence in depth, not what
    // keeps the credential out of the counter table: `generateKey` hashes the
    // whole tracker before it becomes a key, which is also why the
    // `RESET_CREDENTIAL` subject can carry its credential raw.
    //
    // Last, so a presented challenge always wins: adding a header to a request
    // that carries one must never move it onto a fresh budget.
    const challenge = (): string => {
      const token = text(body['challengeToken']);
      if (token !== null) return `challenge:${token}`;
      const authorization = text(request['headers']?.['authorization']);
      const bearer = authorization === null ? null : /^Bearer\s+(\S+)\s*$/i.exec(authorization);
      return bearer === null
        ? ForgeThrottlerGuard.MALFORMED
        : `credential:${hashOpaqueToken(bearer[1])}`;
    };

    switch (subject) {
      case ThrottleSubject.CHALLENGE:
        return challenge();
      case ThrottleSubject.ACCOUNT_OR_CHALLENGE: {
        const userId = text(request['user']?.['userId']);
        return userId === null ? challenge() : `account:${userId}`;
      }
      case ThrottleSubject.ADDRESS: {
        const email = text(body['email']);
        if (email === null) return ForgeThrottlerGuard.MALFORMED;
        // Normalized through core's own rule, so that one address is one
        // budget rather than one per spelling. An address that normalizes away
        // to nothing is no address, and joins the subjects that named none
        // rather than opening a budget keyed on the empty string.
        const normalized = normalizeEmail(email);
        return normalized.length === 0
          ? ForgeThrottlerGuard.MALFORMED
          : `address:${normalized}`;
      }
      case ThrottleSubject.RESET_CREDENTIAL: {
        const credential = text(body['credential']);
        return credential === null
          ? ForgeThrottlerGuard.MALFORMED
          : `reset:${credential}`;
      }
      default:
        return assertNever(subject);
    }
  }

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return bucketOf(context) === undefined;
  }

  /**
   * The bucket and the subject this request spends from.
   *
   * ## Why the context, and not something left on the request
   *
   * Which subject to read depends on the route's bucket, which lives in route
   * metadata rather than on the request — so `getTracker` has to reach the
   * context somehow. The library passes it: `handleRequest` calls the tracker
   * as `getTracker(req, context)`, and `ThrottlerGetTrackerFunction` declares
   * both arguments. Taking it there rather than stashing the resolved subject
   * on the request on the way past means there is no per-request state to
   * carry, nothing to go stale, and nothing a second concurrent request could
   * read instead of its own: both arguments arrive from the one call that is
   * deciding this request, and a guard is a singleton whose requests interleave
   * freely. `__tests__/forge-throttler.guard.spec.ts` drives two interleaved
   * requests through `canActivate` and checks each gets its own subject.
   *
   * The parameter is optional only because the base class declares one
   * argument and TypeScript will not let an override require two. The library
   * passes both on every call; a version that stopped would land here with no
   * bucket, which is why the same spec asserts the subject through the real
   * `canActivate` rather than by calling this method with a context by hand.
   *
   * @param req - the raw request, before validation has touched the body
   * @param context - the request being decided, from the library's own call
   * @returns bucket and subject, which `generateKey` turns into a counter key
   */
  protected override async getTracker(
    req: Record<string, any>,
    context?: ExecutionContext,
  ): Promise<string> {
    const bucket = context === undefined ? undefined : bucketOf(context);
    if (bucket === undefined) return ForgeThrottlerGuard.MALFORMED;
    return `${bucket}:${ForgeThrottlerGuard.subjectOf(BUCKET_SUBJECT[bucket], req)}`;
  }

  /**
   * One counter per bucket and subject, named by a digest of the two.
   *
   * The route is deliberately not in here; see the class comment. Hashed for
   * the reason the library hashes: `tracker` carries an address or a single-use
   * credential verbatim, and this value is the primary key of a table.
   *
   * @param _context - unread; everything that distinguishes one counter from
   *   another is already in `tracker`, and reading the route here would be the
   *   second, disagreeing opinion this override exists to remove
   * @param tracker - bucket and subject, from {@link getTracker}
   * @returns the key `PostgresThrottlerStorage` counts against
   */
  protected override generateKey(_context: ExecutionContext, tracker: string): string {
    return createHash('sha256').update(tracker).digest('hex');
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    // The library's own exception would answer directly and bypass both
    // `HttpExceptionFilter`'s table and the translation it performs. Every
    // other failure in this application goes through there; this one does too.
    // `timeToBlockExpire` is already in seconds — see the storage's own note on
    // the units it converts.
    throw new TooManyAttemptsError(detail.timeToBlockExpire);
  }
}
