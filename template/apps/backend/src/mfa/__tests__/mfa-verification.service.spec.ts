import { randomUUID } from 'node:crypto';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { RecordAuditEntryInput } from '__FORGE_SCOPE__/core/audit/types';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import {
  MfaMethodNotFoundError,
  MfaVerificationFailedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import type { MfaMethodId } from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { FakeDataSource, currentCodeFor } from '../../common/testing';
import type { AuditService } from '../../audit/audit.service';
import type { SessionService } from '../../auth/session/session.service';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { UserRecord } from '../../users/user-record.entity';
import { MfaChallengeRecord } from '../entities/mfa-challenge-record.entity';
import { MfaMethodRecord } from '../entities/mfa-method-record.entity';
import { MfaRecoveryCodeRecord } from '../entities/mfa-recovery-code-record.entity';
import { RecoveryCodes } from '../recovery/recovery-codes';
import { MfaChallengePurpose } from '../enums/MfaChallengePurpose';
import { MfaChallengeService } from '../mfa-challenge.service';
import { MfaVerificationService } from '../mfa-verification.service';
import { TotpVerifier } from '../totp/TotpVerifier';
import { generateTotpSecret } from '../totp/totp-authenticator';

/** Nothing about the caller matters on a refusal path; this is what the route would pass. */
const CLIENT: ClientContext = { address: '203.0.113.7', label: 'a test' };

/**
 * # The two refusals `proveTotp` owes that no route can currently produce
 *
 * `d10-mfa-challenge-only.spec.ts` drives `MfaVerificationService` through
 * `POST /auth/mfa/verify` and covers everything an enrolled account can
 * actually present: a wrong code, a replayed one, a method belonging to
 * somebody else, a method never confirmed, and all five challenge refusals.
 * **This file covers the two branches that suite cannot reach**, because
 * reaching them takes a row no endpoint in this application can write yet.
 *
 * Both are `proveTotp`'s dispatch guards, and both are refusals rather than
 * fallthroughs on purpose:
 *
 * 1. **A confirmed `WEBAUTHN` method.** The migration models it, so the row is
 *    writable and `decideAuthenticationStep` counts it — an account holding one
 *    really does get a challenge. What must not happen is that presenting a
 *    *code* against it completes anything: a WebAuthn factor is proven by an
 *    assertion over a stored public key, and there is no reading of this
 *    method's arguments under which that proof was offered. A ternary reading
 *    "not TOTP, so WebAuthn" would run a ceremony nobody asked for; the
 *    explicit equality plus refusing fallthrough is what this pins.
 *
 * 2. **A `TOTP` row with no seed.** `type` is plain `text` with no `CHECK` and
 *    `totp_secret` is nullable, so corruption or a botched migration can leave
 *    one. `mapMfaMethodRecord` refuses such a row on sight, but this path does
 *    not go through it, so the guard is this class's own.
 *
 * ## The session stub throws, and that is an assertion
 *
 * Neither case may reach `sessions.begin`, and neither may record anything but
 * a refusal. Rather than asserting a count afterwards, the session stub throws
 * if called at all and the audit stub throws for every action except
 * `MFA_CHALLENGE_FAILED` — so a regression that opened a session and *then*
 * refused would fail here with the stub's own message rather than with the
 * expected `MfaVerificationFailedError`, which is the failure that says what
 * actually went wrong. The refusals themselves are recorded, which is the point
 * of that action, and each case says which reason it expects.
 */
describe('MfaVerificationService', () => {
  /** A store, the real challenge service and verifier over it, and the service under test. */
  interface World {
    source: FakeDataSource;
    challenges: MfaChallengeService;
    service: MfaVerificationService;
    /** The account every case here acts as. `FakeDataSource` mints the id, so it is read back rather than chosen. */
    userId: UserId;
    /** The refusing stubs, exposed so a case can build a second service over them. */
    sessions: SessionService;
    audit: AuditService;
    /** Every `MFA_CHALLENGE_FAILED` entry the stub accepted, in order. */
    recorded: RecordAuditEntryInput[];
    users: Repository<UserRecord>;
  }

  function makeWorld(honourLocks = true): World {
    const source = new FakeDataSource(honourLocks);
    const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
      source.getRepository(entity) as unknown as Repository<T>;

    const challenges = new MfaChallengeService(
      repo<MfaChallengeRecord>(MfaChallengeRecord),
      source as unknown as DataSource,
    );

    // See the file's own doc: called at all, these are the regression.
    const sessions = {
      begin: () => {
        throw new Error('sessions.begin was reached on a path that must refuse before it');
      },
    } as unknown as SessionService;
    const recorded: RecordAuditEntryInput[] = [];
    const audit = {
      record: async (entry: RecordAuditEntryInput) => {
        if (entry.action !== AuditAction.MFA_CHALLENGE_FAILED) {
          throw new Error(`audit.record was reached with ${entry.action} on a path that must refuse`);
        }
        recorded.push(entry);
      },
    } as unknown as AuditService;

    const users = repo<UserRecord>(UserRecord);

    // `completeLogin` re-reads the account and refuses one that may no longer
    // authenticate, so every case below needs a real, usable row to be
    // refused for the reason it is actually about.
    const now = new Date();
    // No `id` is named here, so the store mints one. Nothing about this account
    // needs a particular shape — only the `mfa_methods` rows below do, because
    // their ids are what a caller supplies as `methodId` and what the shape
    // check in front of the lookup judges.
    const userId = source.insert(UserRecord, {
      email: 'holder@example.test',
      displayName: 'The holder',
      status: UserStatus.ACTIVE,
      platformRole: PlatformRole.PLATFORM_USER,
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }).identifiers[0].id as UserId;

    const service = new MfaVerificationService(
      repo<MfaMethodRecord>(MfaMethodRecord),
      challenges,
      new TotpVerifier(),
      sessions,
      audit,
      users,
      new RecoveryCodes(
        repo<MfaRecoveryCodeRecord>(MfaRecoveryCodeRecord),
        source as unknown as DataSource,
      ),
    );

    return { source, challenges, service, sessions, audit, recorded, users, userId };
  }

  it('refuses a methodId that is not a UUID without ever reaching the database', async () => {
    // ## Why this case is here and not only in the transport suite
    //
    // `mfa_methods.id` is a `uuid` column. Against Postgres,
    // `findOne({ where: { id: 'not-a-uuid' } })` does not miss — it raises
    // `22P02 invalid input syntax for type uuid`, TypeORM wraps that in
    // `QueryFailedError`, and `AuthController.verifyMfa`'s catch does not name
    // it, so it re-raises and the filter answers `500`. That is **a sixth
    // answer on the one route whose entire premise is that every refusal is
    // byte-identical**, reachable by anyone holding a challenge — including a
    // legitimate user with a buggy client — and the challenge is spent on the
    // way, so the person cannot simply retry.
    //
    // `d10-mfa-challenge-only.spec.ts` compares that case's response bytes
    // against the other five, but it **cannot fail for this reason**:
    // `FakeDataSource` does not type its ids (it mints them as
    // `fake-<Entity>-<n>`, which are not UUIDs either), so it neither raises
    // `22P02` nor could tell a malformed id from one of its own. The suite is
    // structurally blind here — the third real property found hiding behind
    // that double's simplifications, after unique constraints and foreign
    // keys.
    //
    // So this test supplies the typing the fake lacks, in the only form that
    // does not depend on the fake at all: **a repository that throws if it is
    // consulted at all.** The property under test is not "a malformed id is
    // refused" — it is "a malformed id is refused *before* the lookup", which
    // is the only version of the fix that does not depend on a driver's error
    // class. Before the fix the lookup is reached and this fails with the
    // stub's message; after it, the shape check refuses first.
    const world = makeWorld();
    const token = await world.challenges.mint(world.userId, MfaChallengePurpose.LOGIN, null);

    const exploding = {
      findOne: () => {
        throw new Error('the database was consulted with an id of unchecked shape');
      },
    } as unknown as Repository<MfaMethodRecord>;

    const service = new MfaVerificationService(
      exploding,
      world.challenges,
      new TotpVerifier(),
      world.sessions,
      world.audit,
      world.users,
      new RecoveryCodes(
        world.source.getRepository(MfaRecoveryCodeRecord) as unknown as
          Repository<MfaRecoveryCodeRecord>,
        world.source as unknown as DataSource,
      ),
    );

    await expect(
      service.completeLogin(token, 'not-a-uuid', '123456', CLIENT),
    ).rejects.toThrow(MfaMethodNotFoundError);

    expect(world.recorded).toHaveLength(1);
    expect(world.recorded[0]).toMatchObject({
      actorId: world.userId,
      action: AuditAction.MFA_CHALLENGE_FAILED,
      metadata: { reason: 'method_not_found', proof: 'totp' },
      clientAddress: CLIENT.address,
    });
  });

  it('refuses a code presented against a confirmed WEBAUTHN method', async () => {
    const world = makeWorld();
    const now = new Date();

    // **The row carries a seed, and the code below genuinely verifies against
    // it.** That is what makes this case discriminating rather than decorative.
    // A WebAuthn row with a `totp_secret` is not something this application
    // writes, but `type` is plain `text`, `totp_secret` is nullable rather than
    // forbidden, and there is no `CHECK` tying the two — so the row is
    // writable. Seeded with a null secret instead, this test would pass on the
    // strength of `proveTotp`'s *seed* guard and would stay green with the type
    // dispatch deleted outright, which is the one thing it exists to pin.
    const seed = generateTotpSecret();
    const inserted = world.source.insert(MfaMethodRecord, {
      // A real UUID — the shape check in front of the lookup would refuse the
      // store's own synthetic id, as the real column would.
      id: randomUUID(),
      userId: world.userId,
      type: MfaMethodType.WEBAUTHN,
      label: 'A security key',
      totpSecret: seed,
      totpLastStep: null,
      webauthnCredentialId: 'Y3JlZGVudGlhbC1pZA',
      webauthnPublicKey: 'cHVibGljLWtleQ',
      webauthnCounter: '0',
      confirmedAt: now,
      lastUsedAt: null,
      createdAt: now,
    });

    const token = await world.challenges.mint(world.userId, MfaChallengePurpose.LOGIN, null);

    // `currentCodeFor` checks its own output against the real verifier, so the
    // refusal below cannot be an ordinary wrong-code refusal wearing this
    // test's name — the only thing standing in the way is the kind of factor.
    await expect(
      world.service.completeLogin(token, inserted.identifiers[0].id, currentCodeFor(seed), CLIENT),
    ).rejects.toThrow(MfaVerificationFailedError);

    expect(world.recorded).toHaveLength(1);
    expect(world.recorded[0]).toMatchObject({
      actorId: world.userId,
      action: AuditAction.MFA_CHALLENGE_FAILED,
      metadata: { reason: 'verification_failed', proof: 'totp' },
      clientAddress: CLIENT.address,
    });
  });

  it('refuses a TOTP method whose seed is missing rather than handing null to the verifier', async () => {
    const world = makeWorld();
    const now = new Date();
    const inserted = world.source.insert(MfaMethodRecord, {
      // A real UUID — the shape check in front of the lookup would refuse the
      // store's own synthetic id, as the real column would.
      id: randomUUID(),
      userId: world.userId,
      type: MfaMethodType.TOTP,
      // Not writable by this application; reachable by corruption or a botched
      // migration, which is the whole reason the guard exists.
      totpSecret: null,
      label: 'A broken row',
      totpLastStep: null,
      webauthnCredentialId: null,
      webauthnPublicKey: null,
      webauthnCounter: null,
      confirmedAt: now,
      lastUsedAt: null,
      createdAt: now,
    });

    const token = await world.challenges.mint(world.userId, MfaChallengePurpose.LOGIN, null);

    await expect(
      world.service.completeLogin(token, inserted.identifiers[0].id, '123456', CLIENT),
    ).rejects.toThrow(MfaVerificationFailedError);

    expect(world.recorded).toHaveLength(1);
    expect(world.recorded[0]).toMatchObject({
      actorId: world.userId,
      action: AuditAction.MFA_CHALLENGE_FAILED,
      metadata: { reason: 'verification_failed', proof: 'totp' },
      clientAddress: CLIENT.address,
    });
  });

  it('spends the challenge even when the method then refuses', async () => {
    // The order `completeLogin` fixes: the challenge is consumed first, so a
    // refusal further down does not leave it presentable again. Without this,
    // a caller holding one challenge could try method after method with it.
    const world = makeWorld();
    const now = new Date();
    const inserted = world.source.insert(MfaMethodRecord, {
      // A real UUID — the shape check in front of the lookup would refuse the
      // store's own synthetic id, as the real column would.
      id: randomUUID(),
      userId: world.userId,
      type: MfaMethodType.WEBAUTHN,
      label: 'A security key',
      totpSecret: generateTotpSecret(),
      totpLastStep: null,
      webauthnCredentialId: 'Y3JlZGVudGlhbC1pZA',
      webauthnPublicKey: 'cHVibGljLWtleQ',
      webauthnCounter: '0',
      confirmedAt: now,
      lastUsedAt: null,
      createdAt: now,
    });

    const token = await world.challenges.mint(world.userId, MfaChallengePurpose.LOGIN, null);
    const methodId = inserted.identifiers[0].id;

    await expect(
      world.service.completeLogin(token, methodId, '123456', CLIENT),
    ).rejects.toThrow(MfaVerificationFailedError);

    expect(world.source.all(MfaChallengeRecord)[0].consumedAt).not.toBeNull();

    expect(world.recorded).toHaveLength(1);
    expect(world.recorded[0]).toMatchObject({
      actorId: world.userId,
      action: AuditAction.MFA_CHALLENGE_FAILED,
      metadata: { reason: 'verification_failed', proof: 'totp' },
      clientAddress: CLIENT.address,
    });
  });

  /**
   * # Two presentations of one code, in flight together
   *
   * `proveTotp` rejects a step at or below the one it read, which stops a replay
   * that comes *after* the first use finished. Two requests overlapping both read
   * the old step, and only the conditional write in `claimStep` — `WHERE
   * totp_last_step IS NULL OR totp_last_step < :step`, decided by its affected-row
   * count — can make one of them lose.
   *
   * The two worlds are the arrangement `mfa-challenge.service.spec.ts` set: one
   * honours row locks and one ignores them. `verifyProof` takes no lock, so both
   * are decided by the predicate alone, and the second world is what pins that
   * down: a fix that leaned on a lock would pass the first and fail the second.
   * Dropping `totp_last_step <` from the predicate makes both go red with two
   * winners.
   *
   * ## What this shows, and what it does not
   *
   * `FakeDataSource` applies each statement whole and in turn, so it shows that
   * the implementation asks for the conditional write and refuses on its count.
   * It does not show that Postgres serialises two `UPDATE`s of one row — that is
   * the database's guarantee, and not something this double can demonstrate.
   */
  describe.each([
    ['honours row locks', true],
    ['ignores row locks', false],
  ])('a code presented twice at once, in a world that %s', (_name, honourLocks) => {
    it('has exactly one winner, and the loser looks like a wrong code', async () => {
      const world = makeWorld(honourLocks);
      const secret = generateTotpSecret();
      const now = new Date();
      const methodId = randomUUID();
      world.source.insert(MfaMethodRecord, {
        id: methodId,
        userId: world.userId,
        type: MfaMethodType.TOTP,
        label: 'Phone',
        totpSecret: secret,
        totpLastStep: null,
        webauthnCredentialId: null,
        webauthnPublicKey: null,
        webauthnCounter: null,
        confirmedAt: now,
        lastUsedAt: null,
        createdAt: now,
      });
      const code = currentCodeFor(secret);

      const outcomes = await Promise.allSettled([
        world.service.verifyProof(world.userId, { methodId: methodId as MfaMethodId, code }),
        world.service.verifyProof(world.userId, { methodId: methodId as MfaMethodId, code }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const losers = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
      );
      expect(losers).toHaveLength(1);
      expect(losers[0].reason).toBeInstanceOf(MfaVerificationFailedError);
      const [row] = world.source.all(MfaMethodRecord) as unknown as MfaMethodRecord[];
      expect(row.totpLastStep).not.toBeNull();
    });
  });
});
