import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, LessThan, Repository } from 'typeorm';
import {
  MfaChallengeAlreadyConsumedError,
  MfaChallengeExpiredError,
  MfaChallengeNotFoundError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { generateOpaqueToken, hashOpaqueToken } from '../common/crypto';
import { MfaChallengeRecord } from './entities/mfa-challenge-record.entity';
import { MfaChallengePurpose } from './enums/MfaChallengePurpose';

/**
 * How long a challenge lives, in milliseconds.
 *
 * Minutes, and few of them. A challenge is the only thing standing between a
 * correct password and a session, so its window is the window in which an
 * intercepted or phished second factor is still worth something. Five minutes
 * is comfortably enough to open an authenticator app or touch a security key,
 * and comfortably short of a browser tab left open over lunch. The same
 * reasoning `OAUTH_AUTHORIZATION_TTL_MS` gives for its own row, with a tighter
 * number because there is no third party to visit in between.
 */
export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * What the one refusal with no row to name puts in place of an identifier.
 *
 * Every error in `core/mfa/errors` takes the id of the challenge it is about,
 * so a developer reading a log can tell which row was meant, and four of the
 * five refusals below have one to give. The absent case has nothing: no row
 * was found, and the two values actually in hand — the token the caller
 * presented and its digest — are the two this method must never write into a
 * message, since a message can reach a log and a log outlives the challenge.
 */
const NO_SUCH_CHALLENGE = '(none)';

/**
 * The single-use challenge that ties a completed first factor to the second
 * one that finishes it.
 *
 * This is the same machinery as `oauth_authorization_requests` — a
 * server-minted credential, stored as a digest, with its purpose fixed at the
 * moment this server minted it, consumed under a write lock inside the
 * transaction that reads it — written a second time rather than generalised
 * into something both could share. Read `OAuthService.complete` and
 * `OAuthService.consumeAuthorizationRow` alongside this file; every ordering
 * decision below is one of theirs.
 *
 * ## The four things this file is for
 *
 * 1. **The token exists in the clear in exactly one place: the string
 *    {@link MfaChallengeService.mint} returns.** The row holds
 *    `hashOpaqueToken(token)` and nothing else, so a copy of `mfa_challenges`
 *    is not a set of usable pending authentications.
 * 2. **The row is read inside a transaction under `pessimistic_write` and
 *    spent in that same transaction, before anything else is called.** Two
 *    simultaneous presentations of one challenge must not both succeed;
 *    without the lock both would read `consumed_at IS NULL` and both would
 *    proceed. Whatever a caller does with the returned row — verifying a TOTP
 *    code, completing a WebAuthn ceremony, issuing a session — happens after
 *    this transaction has committed, never inside it.
 * 3. **`purpose` is dispatched by explicit equality per modelled value, with
 *    an unconditional refusing fallthrough.** The column is plain `text` with
 *    no `CHECK` (see the migration's own TSDoc, and
 *    {@link MfaChallengePurpose}'s), so a value neither member names is
 *    reachable in principle: corruption, a botched migration, a future
 *    writer, anyone with any write path at all. A ternary reading "not
 *    enrollment, so it must be a login" would answer such a row by finishing
 *    a sign-in. The equivalent dispatch elsewhere in this backend was once
 *    written that way, and replaying a row it had never been told about
 *    minted a real, usable session. The safe default is refuse.
 * 4. **Expired rows are swept on write.** No cron, no background worker
 *    nobody wired up: the sweep runs on the path that creates rows, so it
 *    cannot be a thing two documents claim and nothing performs.
 *
 * ## Five refusals, told apart here and nowhere a caller can see
 *
 * Absent, expired, already consumed, a purpose this file does not model, and
 * a purpose that is modelled but not the one asked for. Each raises the error
 * that names it — and **whatever puts this service behind an HTTP route owes
 * one answer for all five.**
 *
 * The distinctions are every one of them a leak. "Expired, not absent" says a
 * digest existed, which turns presenting tokens into a way of learning which
 * ones this server minted. "Already consumed" says somebody used it. "Wrong
 * purpose" says an enrollment is pending on an account. None of it is
 * anything the presenter had to be given, and the legitimate holder needs
 * none of it either: they hold the challenge, and it works.
 *
 * So why distinguish at all? Because non-disclosure is a property of the
 * transport boundary, not of the domain, and this backend already settles the
 * question that way. `AuthenticationOutcome`'s `REJECTED` branch carries a
 * `reason`; `AuthController.login` has it in scope and deliberately does not
 * read it, with a comment saying why. The reason is recorded and never
 * returned. Collapsing it here instead would throw away what the audit trail
 * needs — "a challenge was refused" is a far poorer entry than "a challenge
 * was refused because it had already been spent" — to buy a guarantee the
 * boundary has to provide anyway.
 */
@Injectable()
export class MfaChallengeService {
  public constructor(
    @InjectRepository(MfaChallengeRecord)
    private readonly challenges: Repository<MfaChallengeRecord>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Mints a challenge, sweeping whatever has expired on the way.
   *
   * `purpose` is fixed here, by the endpoint that knows what it is asking
   * for, and never by anything the request that later consumes the challenge
   * sends — the same discipline `OAuthService.start` holds itself to, and for
   * the same reason: a purpose a caller could supply at consumption time is a
   * purpose whoever holds the browser could edit, turning an enrollment
   * confirmation into a finished sign-in.
   *
   * The sweep comes first and is not conditional on anything. It is a
   * `DELETE ... WHERE expires_at < now`, and it removes expired rows whether
   * or not they were ever consumed: neither is presentable again, so neither
   * has any further use.
   *
   * **It is not indexed, and that is a choice rather than an omission.**
   * `1758000005000-Mfa.ts` creates `ix_mfa_challenges_user_id` and no index on
   * `expires_at` — this comment claimed one for two phases, which was never
   * true. The predicate is therefore a sequential scan, and what makes that
   * acceptable is that this sweep runs on the path that creates rows: the
   * table only ever holds the challenges minted inside one TTL window, which
   * is `MFA_CHALLENGE_TTL_MS` — minutes — of sign-ins and enrollments. A
   * deployment where that is a large number is a deployment that wants the
   * index; adding one is a migration, not an edit here.
   *
   * Doing it here rather than in a scheduled job is what
   * makes it a thing that runs — a sweep on a path nothing calls is a sweep
   * that does not exist.
   *
   * @param userId - whose challenge this is
   * @param purpose - what it will be allowed to finish, fixed now
   * @param webauthnChallenge - the ceremony nonce, or `null` for a challenge
   *   that never enters one
   * @returns the plaintext token, the only copy of it that will ever exist
   */
  public async mint(
    userId: UserId,
    purpose: MfaChallengePurpose,
    webauthnChallenge: string | null,
  ): Promise<string> {
    const now = new Date();
    await this.challenges.delete({ expiresAt: LessThan(now) });

    const { token, hash } = generateOpaqueToken();
    await this.challenges.insert({
      userId,
      // Never the token — see this column's own TSDoc on the entity. The
      // plaintext is returned below and held nowhere.
      tokenHash: hash,
      purpose,
      webauthnChallenge,
      expiresAt: new Date(now.getTime() + MFA_CHALLENGE_TTL_MS),
      consumedAt: null,
      createdAt: now,
    });

    return token;
  }

  /**
   * Spends a challenge, or refuses it — naming which of five things went
   * wrong, for a caller that is obliged not to pass that on.
   *
   * Everything that can say no is decided, and the row is marked consumed, in
   * one transaction holding one write lock, before this method returns
   * anything to a caller that might verify a code, call a WebAuthn library or
   * issue a session. That ordering is what survives a slow or throwing
   * caller: a challenge that has been read must not still be presentable
   * while whoever read it is busy.
   *
   * A refusal rolls the transaction back, so a challenge refused for the
   * wrong purpose is still there for the ceremony it was actually minted for.
   * Only a refusal — the row is spent on the way out of the success path, not
   * on the way out of a failure.
   *
   * @param token - the challenge token as its holder presents it
   * @param expected - the purpose the calling endpoint is prepared to finish
   * @returns the row, with `consumedAt` as it now stands in the table
   * @throws MfaChallengeNotFoundError when no challenge answers to this
   *   token, when its purpose is one this file does not model, and when its
   *   purpose is not the one `expected` — the last two because a challenge
   *   minted for another ceremony is not one this caller holds
   * @throws MfaChallengeExpiredError when its window has passed
   * @throws MfaChallengeAlreadyConsumedError when it has been spent — either
   *   already, or by a concurrent presentation that won the row
   */
  public async consume(token: string, expected: MfaChallengePurpose): Promise<MfaChallengeRecord> {
    const now = new Date();
    return this.dataSource.transaction(async (manager) => MfaChallengeService.consumeRow(
      manager,
      { tokenHash: hashOpaqueToken(token) },
      expected,
      now,
    ));
  }

  /**
   * Reads a challenge **without spending it**: the same lookup and the same
   * refusals as {@link MfaChallengeService.consume}, and no write.
   *
   * It exists for the one read a caller must make before it can present the
   * challenge at all — "which methods may I finish this with" — where spending
   * the challenge to ask would end the sign-in it was asked about. No lock is
   * taken: there is nothing to make exclusive, and a read that raced a spend
   * simply reports the row as it stood, after which the spend is what decides.
   *
   * The refusals are `consume`'s, from the same function
   * ({@link MfaChallengeService.refuseUnlessPresentable}) rather than a copy of
   * it: absent, spent, expired, a purpose this class does not model, and a
   * purpose other than `expected`. The last two are separate checks, so a
   * purpose the allowlist does not know is refused even when it is the one asked
   * for.
   *
   * @param token - the plaintext token, as the browser holds it
   * @param expected - the purpose the calling endpoint is prepared to serve
   * @returns the row, unchanged by this call
   * @throws the same refusals {@link MfaChallengeService.consume} names
   */
  public async peek(token: string, expected: MfaChallengePurpose): Promise<MfaChallengeRecord> {
    const found = await this.challenges.findOne({ where: { tokenHash: hashOpaqueToken(token) } });
    MfaChallengeService.refuseUnlessPresentable(found, expected, new Date());
    return found;
  }

  /**
   * Spends the account's own pending challenge, for the ceremony whose second
   * leg carries **no token at all**.
   *
   * WebAuthn enrollment is that ceremony. `POST /mfa/webauthn/options` and
   * `POST /mfa/webauthn/verify` are each fixed as an enrollment by the session
   * the request arrived with, and a request that carried a session *and* a
   * challenge token is refused outright — see `webauthn/WebAuthnCeremonies.ts`. So
   * the enrollment's token can never travel back on the request that finishes
   * it, and handing it to the browser would only create a credential with
   * nowhere to be presented. It is minted, held, and looked up by the account
   * the session names.
   *
   * **What this does not weaken.** The row is still found under
   * `pessimistic_write` and still spent inside the transaction that read it,
   * by the same {@link MfaChallengeService.consumeRow} every other caller goes
   * through: two simultaneous presentations still cannot both succeed, the
   * purpose is still dispatched by explicit equality with a refusing
   * fallthrough, and expiry and prior consumption are still refused. What
   * changes is only *which column selects the row*, and the account doing the
   * selecting is the one the request proved with a session — never a value a
   * request supplied.
   *
   * `consumedAt: IsNull()` and `purpose` are in the criteria and **not** in
   * place of the checks `consumeRow` makes: newest-first would otherwise land
   * on a spent row and refuse an enrollment that is genuinely pending. The
   * checks then run again on whatever comes back, which is the arrangement
   * `consume`'s own conditional update has and for the same reason — a
   * redundant guard is what survives the edit that drops the criterion.
   *
   * Newest first, because a second `POST /mfa/webauthn/options` starts a second
   * ceremony and the browser is completing that one. The older rows stay
   * pending until they expire and the next mint sweeps them; each is still
   * single-use, and none can be presented by anybody, since no token for them
   * exists outside this server.
   *
   * @param userId - whose pending challenge to spend; read off a proven
   *   session, never off a request body
   * @param expected - the purpose the calling endpoint is prepared to finish
   * @returns the row, with `consumedAt` as it now stands in the table
   * @throws the same five refusals {@link MfaChallengeService.consume} names —
   *   with `MfaChallengeNotFoundError` for an account holding no pending
   *   challenge of that purpose at all
   */
  public async consumePendingFor(
    userId: UserId,
    expected: MfaChallengePurpose,
  ): Promise<MfaChallengeRecord> {
    const now = new Date();
    return this.dataSource.transaction(async (manager) => MfaChallengeService.consumeRow(
      manager,
      { userId, purpose: expected, consumedAt: IsNull() },
      expected,
      now,
      { createdAt: 'DESC' },
    ));
  }

  /**
   * The five refusals, in order, shared by every path that reads a challenge:
   * {@link MfaChallengeService.consumeRow} (which then spends it) and
   * {@link MfaChallengeService.peek} (which does not).
   *
   * One function rather than the same lines twice, because the two checks on
   * purpose below are deliberately separate and a copy is where they get
   * collapsed: `peek` once carried only the comparison, which is the collapsed
   * form, and nothing failed. Keeping the order — absent, spent, expired,
   * unmodelled purpose, wrong purpose — in one place makes it a property of the
   * class rather than of two methods that must be kept alike.
   *
   * @throws the error naming whichever refusal applied
   */
  private static refuseUnlessPresentable(
    found: MfaChallengeRecord | null,
    expected: MfaChallengePurpose,
    now: Date,
  ): asserts found is MfaChallengeRecord {
    if (found === null) throw new MfaChallengeNotFoundError(NO_SUCH_CHALLENGE);
    if (found.consumedAt !== null) throw new MfaChallengeAlreadyConsumedError(found.id);
    if (found.expiresAt.getTime() <= now.getTime()) {
      throw new MfaChallengeExpiredError(found.id);
    }

    // Explicit equality per modelled value, then an unconditional refusal for
    // everything else — point 3 of this class's own TSDoc. This pair of
    // conditions is deliberately not collapsed into the second one alone:
    // `found.purpose !== expected` would already refuse `'SOMETHING_ELSE'`
    // today, and would stop refusing it the day a third member joins
    // `MfaChallengePurpose` and some endpoint expects it. The allowlist
    // refuses what this file does not model; the comparison refuses what this
    // caller was not asking for. They answer different questions.
    //
    // `expected` is a parameter, so there is one shape of call the allowlist
    // alone refuses: a caller asking for the very purpose an unmodelled row
    // carries, where `found.purpose !== expected` is false. A test of that
    // shape is the only kind that reds when these two lines go — every other
    // unmodelled-purpose case passes a modelled `expected` and is refused by
    // the comparison below, so it stays green either way. Every public entry
    // point routed through this helper therefore owes one such case of its
    // own; `mfa-challenge.service.spec.ts` carries them for `consume` and
    // `peek`, and carries the argument for why one per entry point rather
    // than one in total. `consumePendingFor` reaches this helper too and has
    // no case of its own yet.
    //
    // Both refusals are `MfaChallengeNotFoundError`, and that is not a
    // collapse of the kind this class's TSDoc argues against: a row whose
    // purpose this file does not model, and a row minted for a ceremony this
    // caller is not running, are both "no challenge that this caller holds".
    // There is no third fact to record about either.
    if (found.purpose !== MfaChallengePurpose.LOGIN
      && found.purpose !== MfaChallengePurpose.WEBAUTHN_ENROLLMENT) {
      throw new MfaChallengeNotFoundError(found.id);
    }
    if (found.purpose !== expected) throw new MfaChallengeNotFoundError(found.id);
  }

  /**
   * The transaction body of {@link MfaChallengeService.consume} and
   * {@link MfaChallengeService.consumePendingFor}, pulled out as its own
   * `static` so the boundary is visible at the call site rather than folded
   * into a longer method — the shape `OAuthService.consumeAuthorizationRow`
   * already has.
   *
   * `where` is the only thing the two callers differ in. The write lock, the
   * refusals — {@link MfaChallengeService.refuseUnlessPresentable}'s, not a
   * copy kept here — and the conditional spend all live in this one body, so
   * neither path can acquire a weaker version of any of them.
   *
   * @throws the errors {@link MfaChallengeService.refuseUnlessPresentable}
   *   names
   * @throws MfaChallengeAlreadyConsumedError when the spend itself finds the
   *   row already spent, which is the case the lock is supposed to have
   *   prevented — see the comment on the update
   */
  private static async consumeRow(
    manager: EntityManager,
    where: Record<string, unknown>,
    expected: MfaChallengePurpose,
    now: Date,
    order?: Record<string, 'ASC' | 'DESC'>,
  ): Promise<MfaChallengeRecord> {
    const found = await manager.findOne(MfaChallengeRecord, {
      where,
      order,
      lock: { mode: 'pessimistic_write' },
    });

    MfaChallengeService.refuseUnlessPresentable(found, expected, now);

    // `consumedAt: IsNull()` in the criteria, and `affected` read afterwards,
    // for the reason `OAuthService.consumeAuthorizationRow` does the same:
    // both are redundant while the lock above is held, and both are the only
    // thing between a double-spend and a reported success on the day that
    // lock is dropped by an edit that looks harmless.
    const consumed = await manager.update(
      MfaChallengeRecord,
      { id: found.id, consumedAt: IsNull() },
      { consumedAt: now },
    );
    if (consumed.affected !== 1) throw new MfaChallengeAlreadyConsumedError(found.id);

    return { ...found, consumedAt: now };
  }
}
