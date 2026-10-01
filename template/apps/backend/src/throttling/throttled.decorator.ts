import { applyDecorators, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ThrottleBucket } from './throttling.config';

/** Where the guard looks for the bucket a route draws on. */
export const THROTTLE_BUCKET = 'forge:throttle-bucket';

/**
 * Draws this route's attempts from `bucket`.
 *
 * One decorator rather than the library's own plus a second carrying the
 * subject: the limit and what it counts against are one decision, and a route
 * that had the numbers without the subject — or the reverse — would be
 * metering something nobody chose.
 *
 * A route without this decorator is not throttled. That is the guard's
 * `shouldSkip`, and it is deliberate: a global guard that metered every route
 * by default would meter them on whatever subject happened to be available,
 * which for most routes is nothing at all.
 *
 * @param bucket - the budget this route spends from
 */
export function Throttled(bucket: ThrottleBucket): MethodDecorator {
  return applyDecorators(SetMetadata(THROTTLE_BUCKET, bucket));
}

/**
 * Reads route metadata, and holds nothing of its own.
 *
 * Shared rather than injected because `Reflector` is a reader: every method on
 * it is a lookup in `Reflect`'s own metadata, keyed by the handler and class it
 * is given. It has no per-request state to confuse between two requests, which
 * is what lets {@link bucketOf} be a plain function the module's option
 * resolvers can call without a container.
 */
const ROUTE_METADATA = new Reflector();

/**
 * The bucket `context`'s route draws on, or `undefined` for a route that
 * declares none.
 *
 * Handler first, then class, so a method may draw on a different budget than
 * the controller around it declares.
 *
 * @param context - the request being decided
 * @returns the declared bucket, or `undefined` where there is no `@Throttled`
 */
export function bucketOf(context: ExecutionContext): ThrottleBucket | undefined {
  return ROUTE_METADATA.getAllAndOverride<ThrottleBucket | undefined>(THROTTLE_BUCKET, [
    context.getHandler(),
    context.getClass(),
  ]);
}

/**
 * The same lookup, for a caller that has already established the route is
 * throttled.
 *
 * The throw is a backstop, not a case any route reaches: everything that calls
 * this runs after `ForgeThrottlerGuard.shouldSkip` has let through only routes
 * carrying `@Throttled`, and `@Throttled` accepts nothing but a
 * {@link ThrottleBucket}. It exists for a value that arrived from outside the
 * type system — somebody setting this key with `SetMetadata` by hand — and it
 * plays the part `assertNever` plays for a union: fail where the assumption
 * broke, rather than invent a budget nobody chose.
 *
 * @param context - the request being decided
 * @returns the declared bucket
 * @throws if the route declares none
 */
export function requireBucket(context: ExecutionContext): ThrottleBucket {
  const bucket = bucketOf(context);
  if (bucket === undefined) {
    throw new Error(
      `No throttle bucket on ${context.getClass().name}.${context.getHandler().name}`,
    );
  }
  return bucket;
}
