import type { ConfigService } from '@nestjs/config';
import { MFA_CHALLENGE_TTL_MS } from '../mfa/mfa-challenge.service';

/** Which budget a route draws on. */
export type ThrottleBucket
  = | 'mfa-attempt'
    | 'mfa-mint'
    | 'mfa-proof'
    | 'credential'
    | 'reset-credential';

/** Where a bucket's subject is found on the request. */
export enum ThrottleSubject {
  /** The challenge this attempt answers, or failing that the credential it presents. */
  CHALLENGE = 'CHALLENGE',
  /**
   * The signed-in account, or the challenge when there is no session yet, or
   * failing both the digest of the bearer credential presented.
   */
  ACCOUNT_OR_CHALLENGE = 'ACCOUNT_OR_CHALLENGE',
  /** The address the request named, whether or not it names anybody. */
  ADDRESS = 'ADDRESS',
  /** The single-use credential a reset presents. */
  RESET_CREDENTIAL = 'RESET_CREDENTIAL',
}

/**
 * What each bucket counts against.
 *
 * Separate from {@link buildBuckets} and not configurable, because a subject is
 * not a tuning knob: changing what a budget counts against changes which
 * attacks it stops and which callers it refuses, and both of those are design
 * decisions argued on `ForgeThrottlerGuard`. A deployment that could move
 * `credential` from the address to the account would quietly convert a budget
 * that works on addresses nobody has registered into one that does not, and a
 * budget that only counts registered addresses answers the question core's
 * `AuthenticationRejectionReason` refuses to answer.
 *
 * The guard reads this directly rather than being handed a bucket table, so it
 * needs no configuration to know what to read off a request.
 */
export const BUCKET_SUBJECT: Record<ThrottleBucket, ThrottleSubject> = {
  // The challenge on a sign-in, so the budget belongs to the attempt in progress
  // rather than to whoever happens to be holding it; and the signed-in account on
  // a passkey enrollment, which carries no challenge. That leg guesses the proof
  // that admits a second factor, so its budget must not be one a caller can
  // reset by obtaining another access credential — a budget keyed on the
  // credential presented is exactly the "fresh budget on demand" that `mfa-mint`
  // below exists to avoid. See `ForgeThrottlerGuard.subjectOf`.
  //
  // **This is not what bounds guessing a sign-in code, and an operator tuning it
  // for that will change nothing.** A LOGIN challenge is consumed before the
  // proof against it is checked — `MfaVerificationService.completeLogin` and
  // `completeLoginWithRecoveryCode` spend it on their first line, and
  // `WebAuthnCeremonies.loginOptions` consumes before anything else — so one
  // challenge admits exactly one guess. The remaining attempts this budget
  // allows against that same token are reachable (`d16-throttle-refusal.spec.ts`
  // exhausts them) but they are refused as already-consumed without the code
  // being looked at, so they are not guesses and nobody grinding would spend
  // them. A second guess needs a second challenge, which needs a second
  // `POST /auth/login`, which spends `credential`. **`credential` is the bucket
  // that holds that door; `THROTTLE_CREDENTIAL_LIMIT` is the knob that moves
  // it, and `THROTTLE_MFA_ATTEMPT_LIMIT` is not.**
  //
  // Kept nonetheless, and doing real work: it is the counter on the enrollment
  // leg of `POST /mfa/webauthn/verify`, which proves an existing factor on the
  // session and spends no login challenge per attempt. It is also what would
  // bound the login legs the day one of them stopped spending the challenge
  // first — a change that would otherwise be silently unbounded.
  'mfa-attempt': ThrottleSubject.ACCOUNT_OR_CHALLENGE,
  // Why a mint budget exists at all: a per-challenge cap resets whenever a new
  // challenge is minted, so somebody holding the password would buy a fresh
  // budget on demand. This one does not reset with the challenge.
  //
  // It bounds minting, not guessing, and no route carrying it hands out a net
  // new LOGIN challenge: `POST /auth/mfa/methods` neither spends nor mints one,
  // and `/mfa/webauthn/options`' login leg spends one and mints one.
  'mfa-mint': ThrottleSubject.ACCOUNT_OR_CHALLENGE,
  'mfa-proof': ThrottleSubject.ACCOUNT_OR_CHALLENGE,
  credential: ThrottleSubject.ADDRESS,
  // Its own bucket rather than a share of `credential`, because the request
  // carries no address to count against: a reset presents only the single-use
  // credential it is spending, and keeping the two apart stops a reset budget
  // and a sign-in budget draining each other.
  //
  // Keyed on the credential presented, so this bounds repeated presentation of
  // one credential — a spent or leaked link being retried — and not guessing. A
  // caller trying a different credential each time is a different subject every
  // time and is bounded by the credential's entropy rather than by this budget.
  'reset-credential': ThrottleSubject.RESET_CREDENTIAL,
};

/** How generously a bucket is spent. */
export interface BucketDefinition {
  readonly limit: number;
  /** Window, in milliseconds — the unit the library's storage takes. */
  readonly ttl: number;
  /** How long a refusal lasts once the limit is passed, in milliseconds. */
  readonly blockDuration: number;
}

const MINUTE = 60_000;

/**
 * The budgets, with their defaults.
 *
 * Every limit is an environment variable, and so is every window a deployment
 * is free to choose, because these are guesses until somebody runs this in
 * anger and the one most likely to be felt first is `credential` — a shared
 * address retrying a forgotten password is the plausible false positive.
 *
 * `mfa-attempt`'s window is the exception, and the entry below says why: it is
 * `MFA_CHALLENGE_TTL_MS` itself rather than a number chosen here, so making it
 * settable would only offer a way to disagree with the challenge.
 *
 * **There is deliberately no switch that disables throttling.** A
 * deployment-wide "off" is a security control that fails silently the moment
 * somebody sets it and forgets, and a test that needs different numbers passes
 * them to {@link buildBuckets} directly.
 *
 * @param config - the configuration this deployment was started with
 * @returns one definition per bucket, in milliseconds
 */
export function buildBuckets(config: ConfigService): Record<ThrottleBucket, BucketDefinition> {
  const num = (key: string, fallback: number): number => {
    const raw = config.get<string>(key);
    const parsed = raw === undefined ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    // The challenge's own lifetime, imported rather than restated, so the
    // budget dies with the challenge rather than outliving it. Two copies of
    // the same five minutes would agree until somebody changed one of them, and
    // the one that moved would be the one nothing reads back.
    'mfa-attempt': {
      limit: num('THROTTLE_MFA_ATTEMPT_LIMIT', 5),
      ttl: MFA_CHALLENGE_TTL_MS,
      blockDuration: MFA_CHALLENGE_TTL_MS,
    },
    'mfa-mint': {
      limit: num('THROTTLE_MFA_MINT_LIMIT', 10),
      ttl: num('THROTTLE_MFA_MINT_WINDOW_MS', 15 * MINUTE),
      blockDuration: num('THROTTLE_MFA_MINT_WINDOW_MS', 15 * MINUTE),
    },
    'mfa-proof': {
      limit: num('THROTTLE_MFA_PROOF_LIMIT', 10),
      ttl: num('THROTTLE_MFA_PROOF_WINDOW_MS', 15 * MINUTE),
      blockDuration: num('THROTTLE_MFA_PROOF_WINDOW_MS', 15 * MINUTE),
    },
    credential: {
      limit: num('THROTTLE_CREDENTIAL_LIMIT', 10),
      ttl: num('THROTTLE_CREDENTIAL_WINDOW_MS', 15 * MINUTE),
      blockDuration: num('THROTTLE_CREDENTIAL_WINDOW_MS', 15 * MINUTE),
    },
    'reset-credential': {
      limit: num('THROTTLE_CREDENTIAL_LIMIT', 10),
      ttl: num('THROTTLE_CREDENTIAL_WINDOW_MS', 15 * MINUTE),
      blockDuration: num('THROTTLE_CREDENTIAL_WINDOW_MS', 15 * MINUTE),
    },
  };
}
