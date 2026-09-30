import { EntityManager, FindManyOptions, IsNull, Not, Repository } from 'typeorm';
import type { MfaMethod } from '__FORGE_SCOPE__/core/mfa/entities';
import { MfaStep } from '__FORGE_SCOPE__/core/mfa/enums';
import { decideAuthenticationStep } from '__FORGE_SCOPE__/core/mfa/policies';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { MfaMethodRecord } from '../../mfa/entities/mfa-method-record.entity';
import { mapMfaMethodRecord } from '../../mfa/mapMfaMethodRecord';

/**
 * What {@link SecondFactorSettled.settle} answers: either the evidence a
 * session may be opened, or the confirmed methods that must be proven first.
 *
 * A discriminated union rather than a nullable value, and that is the point of
 * the shape: the evidence is reachable **only** through the `ISSUE_SESSION`
 * arm, so a caller cannot get at it without having written the narrowing that
 * handles the other arm. The compiler, not a comment, is what makes the
 * `REQUIRE_SECOND_FACTOR` branch impossible to forget.
 */
export type SecondFactorOutcome
  = | {
    readonly step: MfaStep.ISSUE_SESSION;
    /** Hand this to `SessionService.begin`/`beginIn`. */
    readonly settled: SecondFactorSettled;
  }
  | {
    readonly step: MfaStep.REQUIRE_SECOND_FACTOR;
    /** The confirmed methods the account may answer the challenge with. */
    readonly methods: readonly MfaMethod[];
  };

/**
 * Evidence that the second factor has been settled for the account a session
 * is about to be opened for.
 *
 * ## What this class is for, which is not what it holds
 *
 * It holds one string nothing branches on. Its whole value is that
 * `SessionService.begin` and `SessionService.beginIn` **require one**, so
 * ADR-0012's rule — a second factor is a property of the account, so every
 * path that would open a session asks the same policy first — is enforced by
 * the compiler rather than by prose.
 *
 * Before this type, that rule was held by three near-identical comments beside
 * three near-identical query-and-decide blocks. One more path — an
 * impersonation endpoint, a magic-link sign-in, an invitation that signs its
 * acceptor in — could reach `begin` with no policy call, and would earn no
 * compile error, no failing test, and no reason to read any of the comments.
 * That is the same shape as the defect that shipped once on the federated
 * path: two halves each correct, the join unexamined. A required argument
 * whose only producers are the three static factories below turns "remember to
 * ask the policy" into "this does not compile".
 *
 * ## Why a class, and why `premise` is private
 *
 * TypeScript is structural: a `boolean`, a string literal union, or an
 * `interface` with a marker field is evidence anybody can type out at the call
 * site, which is not evidence at all. A class with a **private member** is
 * nominal — nothing else in the language is assignable to it — and a
 * **private constructor** means the only values of it in existence are the ones
 * the factories below made. Both halves are load-bearing: drop the private
 * member and `{ premise: 'x' } as SecondFactorSettled` stops needing the
 * assertion; drop the private constructor and `new SecondFactorSettled('x')`
 * works from anywhere.
 *
 * **What it does not stop, said plainly.** `{} as SecondFactorSettled` compiles,
 * because `{}` overlaps every type and TypeScript permits the assertion; so does
 * `as unknown as`. A shaped forgery does not — `{ premise: 'x' } as
 * SecondFactorSettled` is refused, since the private member makes the two types
 * non-overlapping. The guarantee is therefore "no path reaches session issuance
 * without the policy **by accident**", which is the failure mode this exists
 * for: the next endpoint written by somebody who never read ADR-0012. It is not
 * a defence against a contributor who writes a cast to get past a compiler
 * telling them not to, and no type in this language would be.
 *
 * ## The three premises, and that there are exactly three
 *
 * Every session this application opens rests on one of them, and each factory
 * names the one it asserts. Adding a fourth is a visible edit to this file
 * with a TSDoc paragraph owed — which is the enumeration the old comments were
 * trying to be, except that it now lives where it cannot be bypassed rather
 * than in five files a new caller has no reason to open.
 */
export class SecondFactorSettled {
  /**
   * The premise this evidence rests on. Private, because being unforgeable is
   * the only job it has; read only by {@link SecondFactorSettled.toString},
   * which exists so a log line or a debugger can say *why* a session was
   * allowed to open.
   */
  private constructor(private readonly premise: string) {}

  public toString(): string {
    return `SecondFactorSettled(${this.premise})`;
  }

  /**
   * Asks ADR-0012's policy for one account, and answers with the evidence or
   * with the methods still owed.
   *
   * @param methods - the `mfa_methods` repository
   * @param userId - the account whose credentials have just been proven
   * @returns the policy's answer, carrying the evidence on the issuing arm
   */
  public static async settle(
    methods: Repository<MfaMethodRecord>,
    userId: UserId,
  ): Promise<SecondFactorOutcome> {
    return SecondFactorSettled.decide(
      await methods.find(SecondFactorSettled.confirmedMethodsOf(userId)),
    );
  }

  /**
   * The same question, asked inside a transaction somebody else opened — so it
   * sees that transaction's own uncommitted writes rather than a stale
   * snapshot beside them. `OAuthService.provisionAndSignIn` inserts the
   * account and asks about it in one transaction, which is the only reason
   * this variant exists.
   *
   * @param manager - the caller's transaction
   * @param userId - the account whose credentials have just been proven
   * @returns the policy's answer, carrying the evidence on the issuing arm
   */
  public static async settleIn(
    manager: EntityManager,
    userId: UserId,
  ): Promise<SecondFactorOutcome> {
    return SecondFactorSettled.decide(
      await manager.find(MfaMethodRecord, SecondFactorSettled.confirmedMethodsOf(userId)),
    );
  }

  /**
   * Evidence that the factor was **just proven** — the second half of a
   * two-phase sign-in, where asking the policy would be circular.
   *
   * `MfaVerificationService` is the one caller, and it is the one caller by
   * construction: everything that finishes a challenge, WebAuthn assertions
   * included, reaches session issuance through it rather than opening a
   * session of its own. It spends the login challenge, re-checks that the
   * account may still authenticate, and only then calls this — see
   * `MfaVerificationService.openSession`, whose callers are the private
   * methods that ran a proof.
   */
  public static becauseTheFactorWasJustProven(): SecondFactorSettled {
    return new SecondFactorSettled('THE_FACTOR_WAS_JUST_PROVEN');
  }

  /**
   * Evidence carried by the caller's **existing** access token, for the one
   * path that reissues a session to somebody who already holds one.
   *
   * `AuthService.changePasswordAndReissue` is that path, and it is the literal
   * counterexample to "every path asks the policy": it asks nothing, and is
   * still not a bypass. `POST /auth/change-password` carries no `@Public()`,
   * so the global `JwtAuthGuard` has already accepted an access token for the
   * actor — and an access token cannot exist without one of the other two
   * premises having been established when the session behind it was opened.
   * The request must also prove the current secret. The reissued session is
   * therefore no stronger than the one that asked for it, which is the whole
   * test: this factory says "the caller already passed the gate", not "skip
   * the gate".
   *
   * **Anything reaching for this factory owes that same argument.** It is not
   * a general-purpose escape hatch: a path whose route is `@Public()`, or that
   * opens a session for an account other than the authenticated actor's, has
   * no access token standing behind it and must use {@link
   * SecondFactorSettled.settle} instead. An impersonation endpoint is the
   * obvious trap — the actor holds a token, but the session is opened for
   * somebody else, whose second factor nothing has asked about.
   */
  public static becauseTheCallerAlreadyHoldsAnAccessToken(): SecondFactorSettled {
    return new SecondFactorSettled('THE_CALLER_ALREADY_HOLDS_AN_ACCESS_TOKEN');
  }

  /**
   * **Confirmed rows only, and the filter is in the query rather than after
   * it.** Written once here, and the argument with it, because it was
   * previously written three times and is exactly the kind of clause that gets
   * "simplified" at one site and not the others.
   *
   * Two independent reasons converge on it, and only the first is about the
   * policy:
   *
   * 1. `decideAuthenticationStep` counts nothing but confirmed methods, so
   *    mapping the unconfirmed ones buys the policy nothing.
   * 2. `mapMfaMethodRecord` **throws** for a row whose kind and columns
   *    disagree — a `TOTP` row with no seed, a `WEBAUTHN` row with no
   *    credential id or public key. Mapping every row therefore turns one
   *    half-written record into a 500 on *every* sign-in attempt for that
   *    account, with no path out: the person cannot sign in to remove the row
   *    that stops them signing in.
   *
   * The second is a guard, not a repair for something happening now. No
   * enrollment path in this application leaves a row whose kind and columns
   * disagree: TOTP writes its seed in the same insert that creates the row, and
   * WebAuthn writes no row at all until the attestation has verified, then
   * writes one fully populated and already confirmed. What the query buys is
   * that nothing *makes* that stay true — a row from a partial restore, one
   * edited by hand, or an enrollment later built in two steps would each be one
   * write away from taking an account's sign-in down entirely, and the filter
   * bounds the damage to rows somebody has already confirmed.
   */
  private static confirmedMethodsOf(userId: UserId): FindManyOptions<MfaMethodRecord> {
    return { where: { userId, confirmedAt: Not(IsNull()) } };
  }

  /** The policy's answer over rows already narrowed to the confirmed ones. */
  private static decide(rows: MfaMethodRecord[]): SecondFactorOutcome {
    const decision = decideAuthenticationStep(rows.map(mapMfaMethodRecord));
    if (decision.step === MfaStep.REQUIRE_SECOND_FACTOR) {
      return { step: MfaStep.REQUIRE_SECOND_FACTOR, methods: decision.methods };
    }
    return {
      step: MfaStep.ISSUE_SESSION,
      settled: new SecondFactorSettled('THE_POLICY_ANSWERED_ISSUE_SESSION'),
    };
  }
}
