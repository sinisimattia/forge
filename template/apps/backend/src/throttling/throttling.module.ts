import { Module, type ExecutionContext } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { hashOpaqueToken } from '../common/crypto';
import {
  PostgresThrottlerStorage,
  THROTTLE_BLOCK_REPORTER,
  type ThrottleBlockReporter,
} from './postgres-throttler.storage';
import { requireBucket } from './throttled.decorator';
import { buildBuckets, type BucketDefinition } from './throttling.config';

/**
 * Writes the one audit entry a block earns.
 *
 * The storage calls this on the attempt that sets the block and on no other, so
 * a caller who keeps attempting adds nothing here. That is the property that
 * keeps the audit table from being something an attacker can fill by persisting.
 *
 * The subject is recorded as a digest and never as the value. `key` is already a
 * digest of the bucket and the subject, made by the guard, and is hashed once
 * more through the helper every stored token here goes through, so that the
 * audit row does not carry the counter table's own primary key. **This does not
 * make the subject unrecoverable.** For a low-entropy subject such as an email
 * address an unsalted hash is a lookup: anybody who can guess the address and
 * how the key is built can confirm it, and `rate_limit_counters` has the same
 * exposure. What the digest does is keep the value itself — an address, a
 * challenge — out of a table built to be read.
 *
 * The entry does **not** say which bucket was exceeded: the bucket is hashed
 * into the key before the storage sees it. It identifies a subject and a retry
 * window, nothing more. A failure to write is logged by the storage and does not
 * reach the request.
 *
 * @param audit - the audit writer the rest of the backend uses
 * @returns the reporter the storage is constructed with
 */
export function auditThrottleBlock(audit: AuditService): ThrottleBlockReporter {
  return async (key, retryAfterSeconds) => {
    await audit.record({
      organizationId: null,
      actorId: null,
      action: AuditAction.THROTTLE_ENGAGED,
      resourceType: 'throttle-subject',
      resourceId: hashOpaqueToken(key),
      metadata: { retryAfterSeconds },
      clientAddress: null,
      clientLabel: null,
      occurredAt: new Date(),
    });
  };
}

/**
 * The store, in a module of its own so the options factory can be given it.
 *
 * The library's only published seam for a custom store is
 * `ThrottlerModuleOptions.storage`, which takes an instance rather than a
 * token: whoever builds the options has to already hold the store. The
 * options are built inside `ThrottlerModule`'s own injector, which sees the
 * global modules and whatever `forRootAsync` is told to import and nothing
 * else — so the store is provided here and imported there, rather than
 * constructed by hand with a `DataSource` pulled out of the global context.
 * `PostgresThrottlerStorage` asks for its connection with
 * `@InjectDataSource()`; this keeps that true.
 */
@Module({
  imports: [AuditModule],
  providers: [
    PostgresThrottlerStorage,
    { provide: THROTTLE_BLOCK_REPORTER, inject: [AuditService], useFactory: auditThrottleBlock },
  ],
  exports: [PostgresThrottlerStorage],
})
export class ThrottlerStorageModule {}

/**
 * How the library is configured: one throttler, whose numbers each request
 * resolves from its own bucket.
 *
 * ## Why one throttler and not one per bucket
 *
 * The library applies **every** configured throttler to every request it does
 * not skip. A throttler per bucket would therefore meter a sign-in against the
 * sign-in budget and against every other bucket's at the same time, and the
 * tightest of them would be the one that refused — a route limited by a budget
 * its decorator does not name. Keeping each out of the others' way would mean a
 * `skipIf` on every entry that is correct on every entry, where forgetting one
 * is silent.
 *
 * One throttler whose `limit`, `ttl` and `blockDuration` are resolved per
 * request from the route's own bucket has no such arrangement to get wrong:
 * there is one budget in play and it is the declared one. It also leaves the
 * refusal's headers under their standard names — the library suffixes
 * `Retry-After` and `X-RateLimit-*` with the throttler's name whenever that
 * name is not `default`, and `Retry-After-credential` is a header no client
 * reads.
 *
 * Exported as a named function for the discipline `app.module.ts` states about
 * `typeOrmOptions` and `GLOBAL_PROVIDERS`: a spec registers these exact options
 * rather than a copy that is free to drift from them.
 *
 * @param config - the configuration this deployment was started with
 * @param storage - where the counters live
 * @returns the options `ThrottlerModule.forRootAsync` is given
 */
export function throttlerOptions(
  config: ConfigService,
  storage: ThrottlerStorage,
): ThrottlerModuleOptions {
  const buckets = buildBuckets(config);
  const budget = (context: ExecutionContext): BucketDefinition => buckets[requireBucket(context)];
  return {
    storage,
    throttlers: [
      {
        limit: (context) => budget(context).limit,
        ttl: (context) => budget(context).ttl,
        blockDuration: (context) => budget(context).blockDuration,
      },
    ],
  };
}

/**
 * Counting attempts, for the routes that declare a budget.
 *
 * Importing this module configures the library and provides the store; it does
 * **not** put the guard in front of anything. That is the `APP_GUARD` entry in
 * `GLOBAL_PROVIDERS`, and `__tests__/composition-root.spec.ts` is what asserts
 * it is there — a module imported with nothing reading it breaks no type and
 * fails no lint rule.
 *
 * No `TypeOrmModule.forFeature` for `RateLimitCounterRecord`. The table is
 * reached with raw SQL through the `DataSource`, so no repository for it is
 * ever injected, and registering one would be wiring nothing reads. The entity
 * is in `app.module.ts`'s list, which `__tests__/composition-root.spec.ts` asserts
 * entity by entity.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, ThrottlerStorageModule],
      inject: [ConfigService, PostgresThrottlerStorage],
      useFactory: throttlerOptions,
    }),
  ],
})
export class ThrottlingModule {}
