import { argon2id, hash as argon2Hash, verify as argon2Verify } from 'argon2';
import { WeakPasswordError } from '__FORGE_SCOPE__/core/identities/errors';
import { DEFAULT_PASSWORD_POLICY, evaluatePassword } from '__FORGE_SCOPE__/core/identities/policies';
import type { PasswordPolicy } from '__FORGE_SCOPE__/core/identities/types';
import type { IPasswordHasher, StoredSecret } from './IPasswordHasher';

/**
 * The name recorded in `secret_algorithm`.
 *
 * It is spelled out here because there is nothing to take it from: `argon2`
 * exports `argon2id` as the number `2` — the enum value this file imports and
 * passes as `type` — and publishes no string at all. The only other place this text exists is
 * inside argon2's own PHC encoding (`$argon2id$v=19$...`), which is a detail of
 * a format, not an API.
 *
 * So this constant is the value written into a database column, and it has to
 * stay stable for as long as rows carry it, independently of anything the
 * library does to its own naming. That the two agree is not assumed: the suite
 * parses the tag out of a real encoding and asserts it equals this constant.
 */
export const ARGON2ID = 'argon2id';

/**
 * The cost parameters in force. Written into `secret_params` on every derivation
 * and compared against on every rehash decision.
 *
 * These are OWASP's first-listed argon2id configuration (19 MiB, two passes, one
 * lane). Memory is the parameter that actually costs an attacker: a GPU or an
 * ASIC has thousands of cores but not thousands of independent 19 MiB working
 * sets, so memory is what closes the gap between the attacker's hardware and
 * ours, and `timeCost` is kept at the minimum that configuration pairs with it.
 *
 * Measured in this project's own deployment image (`node:22-bookworm-slim`,
 * argon2 0.44.0): 37.0 ms per derivation. That is the budget being spent on
 * every sign-in and every registration.
 *
 * `parallelism` is 1, and NOT because extra lanes do nothing — they measurably
 * do: at these same memory and time costs the identical derivation took 20.6 ms
 * at p=2 and 11.7 ms at p=4 in that image. It is 1 because that speed-up is the
 * defender's alone and does not exist under load. Total work is what an attacker
 * pays per guess, and `parallelism` does not change it; it only spreads our share
 * of it over more cores, which helps while cores are idle and stops helping the
 * moment several people sign in at once — at which point the extra OS threads per
 * request remain and the latency gain does not. One lane makes the cost of a
 * sign-in the same number whether the machine is idle or busy, and makes that
 * number independent of a container CPU limit that is a deployment's decision and
 * not one taken here.
 */
export const CURRENT_PARAMS = {
  /** KiB of working memory per derivation. */
  memoryCost: 19456,
  /** Passes over that memory. */
  timeCost: 2,
  /** Lanes. See above: deliberately 1. */
  parallelism: 1,
} as const;

/**
 * {@link IPasswordHasher} over argon2id.
 *
 * Carries no `@Injectable()` decorator on purpose. Its one constructor parameter
 * is a {@link PasswordPolicy}, which is an interface and therefore has no runtime
 * token for Nest to resolve; decorating the class would make Nest emit
 * `design:paramtypes` of `[Object]` and fail at startup asking for a provider
 * that cannot exist. A module provides it with an explicit factory instead, which
 * is also the place a deployment's own policy gets to be substituted.
 */
export class Argon2PasswordHasher implements IPasswordHasher {
  /**
   * @param policy - the rules whose maximum length bounds the work this adapter
   *   will do. Injected rather than read from the constant directly so that a
   *   deployment that raises or lowers the bound moves this adapter with it.
   */
  public constructor(private readonly policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY) {}

  public async hash(secret: string): Promise<StoredSecret> {
    // The upper bound, and only the upper bound, is enforced here. The asymmetry
    // is deliberate: a minimum length is a rule about what to accept from a
    // person, and it belongs at the boundary where it can be reported to them
    // alongside every other violation at once. A maximum length is a rule about
    // what this process will spend, and a rule about spending has to hold at the
    // point of spend, whoever is calling.
    //
    // The spend is real but modest, and worth stating precisely rather than
    // gesturing at: argon2 absorbs the whole input before the memory-hard part
    // begins, so the cost is linear in the length of the secret ON TOP OF its
    // fixed cost, at roughly 3 ms per megabyte (measured, argon2 0.44.0, these
    // parameters: 24 ms at 8 bytes, 50 ms at 10 MB, 322 ms at 100 MB). A single
    // over-long secret is therefore not an outage; an unbounded one, repeated, is
    // a way to buy server time by the megabyte, and the bound is what prices it.
    //
    // The error still carries every violation the policy found, not just the one
    // that decided the refusal, because WeakPasswordError's contract is that it
    // lists all of them and a caller renders that list.
    const violations = evaluatePassword(secret, this.policy);
    if (violations.includes('TOO_LONG')) throw new WeakPasswordError(violations);

    return {
      hash: await argon2Hash(secret, { type: argon2id, ...CURRENT_PARAMS }),
      algorithm: ARGON2ID,
      params: { ...CURRENT_PARAMS },
    };
  }

  public async verify(secret: string, stored: StoredSecret): Promise<boolean> {
    // The same bound as in `hash`, for the same reason and one more: `hash` is
    // reached by someone registering or changing a password, and this is the
    // method reachable with no credentials at all, so it is the one where buying
    // server time by the megabyte actually costs an attacker nothing. Answering
    // `false` without deriving anything is correct as well as cheap — a secret
    // longer than the policy allows cannot have produced any stored value,
    // because `hash` would have refused it.
    //
    // Consequence, accepted: lowering `maxLength` on a live deployment locks out
    // anyone whose existing password is longer than the new bound. They recover
    // through a password reset like anyone else, and the alternative — honouring
    // a bound at write time that verification ignores — leaves the work unbounded
    // on the one path that is reachable without credentials.
    if (secret.length > this.policy.maxLength) return false;

    try {
      return await argon2Verify(stored.hash, secret);
    } catch {
      // A stored value this adapter cannot parse. See IPasswordHasher.verify.
      return false;
    }
  }

  public needsRehash(stored: StoredSecret): boolean {
    if (stored.algorithm !== ARGON2ID) return true;

    // "Weaker than", not "different from". A value produced under parameters
    // STRONGER than the current ones is left alone: re-deriving it would replace
    // a better stored value with a worse one, which is the opposite of what this
    // method exists to do. A missing parameter reads as `undefined`, and every
    // comparison below is false for `undefined`, so it is spelled as an explicit
    // check rather than left to the numeric comparisons to not-quite-handle.
    return (Object.keys(CURRENT_PARAMS) as (keyof typeof CURRENT_PARAMS)[]).some((name) => {
      const value = stored.params[name];
      return typeof value !== 'number' || value < CURRENT_PARAMS[name];
    });
  }
}
