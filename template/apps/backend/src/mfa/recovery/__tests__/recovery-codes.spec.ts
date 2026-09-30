import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import {
  MfaVerificationFailedError,
  RecoveryCodeAlreadyConsumedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { AuditService } from '../../../audit/audit.service';
import type { SessionService } from '../../../auth/session/session.service';
import { hashOpaqueToken } from '../../../common/crypto';
import { FakeDataSource, currentCodeFor } from '../../../common/testing';
import { UserRecord } from '../../../users/user-record.entity';
import { MfaChallengeRecord } from '../../entities/mfa-challenge-record.entity';
import { MfaMethodRecord } from '../../entities/mfa-method-record.entity';
import { MfaRecoveryCodeRecord } from '../../entities/mfa-recovery-code-record.entity';
import { MfaChallengePurpose } from '../../enums/MfaChallengePurpose';
import { MfaChallengeService } from '../../mfa-challenge.service';
import { MfaVerificationService } from '../../mfa-verification.service';
import { TotpVerifier } from '../../totp/TotpVerifier';
import { RECOVERY_CODE_COUNT, RecoveryCodes } from '../recovery-codes';

const CLIENT: ClientContext = { address: '203.0.113.7', label: 'a test' };

/** Not a credential: the seed of a method the specs below compute codes for. */
const FAKE_TOTP_SEED = 'JBSWY3DPEHPK3PXP';

/**
 * What the stubbed session hands back. Module constants rather than literals
 * beside the keys `accessToken` and `refreshToken`, which the extraction gate's
 * text scan would take for populated secrets — the idiom
 * `mapMfaMethodRecord.spec.ts` uses for `FAKE_TOTP_SEED`.
 */
const STUB_ACCESS = 'stub-access';
const STUB_RENEWAL = 'stub-renewal';

/**
 * # Recovery codes
 *
 * ## Single use is one statement, so there is no lock to remove
 *
 * `MfaChallengeService` spends a challenge under a write lock *and* a
 * `consumed_at IS NULL` predicate, and its spec therefore builds a second
 * world where the lock is ignored so the predicate can be tested alone. There
 * is no such second world here, because `RecoveryCodes.consume` takes no lock:
 * it is one `UPDATE` and its predicate is the only mechanism there is. So the
 * predicate is tested directly — `refuses a code that is already spent` seeds a
 * spent row and asserts it is refused — and the race asserts that of two
 * simultaneous presentations exactly one wins. Removing `consumedAt: IsNull()`
 * fails the first of those, and the single-use test beside it.
 *
 * ## What `FakeDataSource` cannot see
 *
 * This phase has lost three properties to the double, and none is asserted
 * here as though it were:
 *
 * - **Unique constraints.** Nothing below asserts that
 *   `uq_mfa_recovery_codes_code_hash` refuses two rows sharing a digest; the
 *   store would accept them. The constraint is the migration's.
 * - **Foreign keys.** Nothing asserts that a user's codes die with the user.
 * - **Column typing.** `user_id` is a `uuid` column, and Postgres would answer
 *   a malformed one with `22P02`; the store answers with no rows. Nothing here
 *   claims a malformed id is refused. `userId` reaches `RecoveryCodes` only
 *   from a consumed challenge row, never from a request.
 *
 * ## The proof is chosen by field, in both directions
 *
 * `does not accept a recovery code presented as a TOTP code` and `does not
 * accept a TOTP code presented as a recovery code` are the two halves.
 */
describe('RecoveryCodes', () => {
  const USER = '11111111-1111-4111-8111-111111111111' as UserId;
  const OTHER = '22222222-2222-4222-8222-222222222222' as UserId;

  interface World {
    source: FakeDataSource;
    codes: Repository<MfaRecoveryCodeRecord>;
    service: RecoveryCodes;
  }

  const buildWorld = (): World => {
    const source = new FakeDataSource();
    const codes = source.getRepository(MfaRecoveryCodeRecord) as unknown as
      Repository<MfaRecoveryCodeRecord>;
    return { source, codes, service: new RecoveryCodes(codes, source as unknown as DataSource) };
  };

  /** What a person does to a printed code before typing it back. */
  const ungrouped = (code: string): string => code.replace(/\s+/g, '');

  let world: World;
  beforeEach(() => {
    world = buildWorld();
  });

  describe('generate', () => {
    it('generates ten codes and stores only their digests', async () => {
      const codes = await world.service.generate(USER);

      expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
      expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
      const rows = await world.codes.find({ where: { userId: USER } });
      expect(rows.map((row) => row.codeHash).sort())
        .toEqual(codes.map((code) => hashOpaqueToken(ungrouped(code))).sort());
      expect(rows.every((row) => row.consumedAt === null)).toBe(true);
      for (const code of codes) {
        expect(JSON.stringify(rows)).not.toContain(code);
        expect(JSON.stringify(rows)).not.toContain(ungrouped(code));
      }
    });

    it('draws sixteen bytes per code: twenty-two characters once ungrouped', async () => {
      // 128 bits, and short enough to copy from paper. Thirty-two bytes would
      // be forty-three characters, eleven groups, on every code of a printed sheet.
      const codes = await world.service.generate(USER);
      for (const code of codes) expect(ungrouped(code)).toHaveLength(22);
    });

    it('groups a code for legibility with whitespace only', async () => {
      const [code] = await world.service.generate(USER);
      expect(code).toMatch(/^\S{1,4}( \S{1,4})+$/);
    });

    it('invalidates the previous batch when a new one is issued', async () => {
      const [old] = await world.service.generate(USER);
      const fresh = await world.service.generate(USER);

      await expect(world.service.consume(USER, old))
        .rejects.toBeInstanceOf(MfaVerificationFailedError);
      await expect(world.service.consume(USER, fresh[0])).resolves.toBeUndefined();
      expect(await world.codes.find({ where: { userId: USER } })).toHaveLength(RECOVERY_CODE_COUNT);
    });

    it('leaves the codes of other accounts alone', async () => {
      const [theirs] = await world.service.generate(OTHER);
      await world.service.generate(USER);
      await expect(world.service.consume(OTHER, theirs)).resolves.toBeUndefined();
    });
  });

  describe('consume', () => {
    it('accepts a code once and refuses it thereafter, saying it was spent', async () => {
      const [code] = await world.service.generate(USER);
      await expect(world.service.consume(USER, code)).resolves.toBeUndefined();
      await expect(world.service.consume(USER, code))
        .rejects.toBeInstanceOf(RecoveryCodeAlreadyConsumedError);
    });

    it('accepts a code typed without its grouping', async () => {
      const [code] = await world.service.generate(USER);
      await expect(world.service.consume(USER, ungrouped(code))).resolves.toBeUndefined();
    });

    it('refuses a code that is already spent, naming that and not "unknown"', async () => {
      // Seeded spent rather than spent through `consume`, so the predicate is
      // the only thing that can refuse it.
      await world.codes.insert({
        userId: USER,
        codeHash: hashOpaqueToken('seeded-spent'),
        consumedAt: new Date(),
        createdAt: new Date(),
      });
      await expect(world.service.consume(USER, 'seeded-spent'))
        .rejects.toBeInstanceOf(RecoveryCodeAlreadyConsumedError);
    });

    it('refuses a code belonging to another user as unknown, without spending it', async () => {
      const [code] = await world.service.generate(OTHER);
      await expect(world.service.consume(USER, code))
        .rejects.toBeInstanceOf(MfaVerificationFailedError);
      // And did not spend it for its owner.
      await expect(world.service.consume(OTHER, code)).resolves.toBeUndefined();
    });

    it('does not reveal that a code of another user was spent', async () => {
      // The scoping applies to the diagnosis as well as to the update: if the
      // follow-up read were not scoped by user, this would say "already used".
      const [code] = await world.service.generate(OTHER);
      await world.service.consume(OTHER, code);
      await expect(world.service.consume(USER, code))
        .rejects.toBeInstanceOf(MfaVerificationFailedError);
    });

    it('refuses a code nobody was issued as unknown', async () => {
      await world.service.generate(USER);
      await expect(world.service.consume(USER, 'not-a-code'))
        .rejects.toBeInstanceOf(MfaVerificationFailedError);
      await expect(world.service.consume(USER, ''))
        .rejects.toBeInstanceOf(MfaVerificationFailedError);
    });

    it('lets exactly one of two simultaneous presentations win', async () => {
      const [code] = await world.service.generate(USER);

      const results = await Promise.allSettled([
        world.service.consume(USER, code),
        world.service.consume(USER, code),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(RecoveryCodeAlreadyConsumedError);
    });
  });

  describe('as the second phase of a sign-in', () => {
    interface Login {
      verification: MfaVerificationService;
      challenges: MfaChallengeService;
      userId: UserId;
      methodId: string;
      recovery: RecoveryCodes;
      audited: ObjectLiteral[];
    }

    /** A verification service over a real store whose session and audit stubs succeed. */
    const makeLogin = (): Login => {
      const { source, service: recovery } = buildWorld();
      const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
        source.getRepository(entity) as unknown as Repository<T>;
      const challenges = new MfaChallengeService(
        repo<MfaChallengeRecord>(MfaChallengeRecord),
        source as unknown as DataSource,
      );
      const now = new Date();
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
      const methodId = '33333333-3333-4333-8333-333333333333';
      source.insert(MfaMethodRecord, {
        id: methodId,
        userId,
        type: MfaMethodType.TOTP,
        label: 'phone',
        totpSecret: FAKE_TOTP_SEED,
        totpLastStep: null,
        webauthnCredentialId: null,
        webauthnPublicKey: null,
        webauthnCounter: null,
        confirmedAt: now,
        lastUsedAt: null,
        createdAt: now,
      });
      const audited: ObjectLiteral[] = [];
      const sessions = {
        begin: async () => ({
          session: { id: 'session-1' },
          accessToken: STUB_ACCESS,
          refreshToken: STUB_RENEWAL,
        }),
      } as unknown as SessionService;
      const audit = {
        record: async (entry: ObjectLiteral) => {
          audited.push(entry);
        },
      } as unknown as AuditService;
      const verification = new MfaVerificationService(
        repo<MfaMethodRecord>(MfaMethodRecord),
        challenges,
        new TotpVerifier(),
        sessions,
        audit,
        repo<UserRecord>(UserRecord),
        recovery,
      );
      return { verification, challenges, userId, methodId, recovery, audited };
    };

    const mint = (w: Login): Promise<string> =>
      w.challenges.mint(w.userId, MfaChallengePurpose.LOGIN, null);

    it('opens a session for a recovery code and records which proof it was', async () => {
      const w = makeLogin();
      const [code] = await w.recovery.generate(w.userId);

      const done = await w.verification.completeLoginWithRecoveryCode(await mint(w), code, CLIENT);

      expect(done.userId).toBe(w.userId);
      // The spend, the sign-in, and the second factor that gated it: three
      // facts, three entries, in the order they happened.
      expect(w.audited.map((entry) => entry.action)).toEqual([
        AuditAction.RECOVERY_CODE_CONSUMED,
        AuditAction.LOGIN_SUCCEEDED,
        AuditAction.MFA_CHALLENGE_SUCCEEDED,
      ]);
      expect(w.audited[1].metadata).toEqual({ sessionId: 'session-1', proof: 'recovery_code' });
      expect(w.audited[2]).toMatchObject({
        actorId: w.userId,
        metadata: { sessionId: 'session-1', proof: 'recovery_code' },
      });
      // The code is never written down, in whatever form.
      expect(JSON.stringify(w.audited)).not.toContain(code.replace(/\s+/g, ''));
    });

    it('records a recovery code that was already spent, with the reason', async () => {
      const w = makeLogin();
      const [code] = await w.recovery.generate(w.userId);
      await w.verification.completeLoginWithRecoveryCode(await mint(w), code, CLIENT);
      w.audited.length = 0;

      await expect(w.verification.completeLoginWithRecoveryCode(await mint(w), code, CLIENT))
        .rejects.toBeInstanceOf(RecoveryCodeAlreadyConsumedError);

      expect(w.audited).toHaveLength(1);
      expect(w.audited[0]).toMatchObject({
        actorId: w.userId,
        action: AuditAction.MFA_CHALLENGE_FAILED,
        metadata: { reason: 'recovery_code_already_consumed', proof: 'recovery_code' },
        clientAddress: CLIENT.address,
      });
    });

    it('spends the code it signed in with', async () => {
      const w = makeLogin();
      const [code] = await w.recovery.generate(w.userId);
      await w.verification.completeLoginWithRecoveryCode(await mint(w), code, CLIENT);

      await expect(w.verification.completeLoginWithRecoveryCode(await mint(w), code, CLIENT))
        .rejects.toBeInstanceOf(RecoveryCodeAlreadyConsumedError);
    });

    it('does not accept a recovery code presented as a TOTP code', async () => {
      const w = makeLogin();
      const [code] = await w.recovery.generate(w.userId);

      await expect(w.verification.completeLogin(await mint(w), w.methodId, code, CLIENT))
        .rejects.toBeInstanceOf(MfaVerificationFailedError);
      expect(w.audited).toHaveLength(1);
      expect(w.audited[0]).toMatchObject({
        actorId: w.userId,
        action: AuditAction.MFA_CHALLENGE_FAILED,
        metadata: { reason: 'verification_failed', proof: 'totp' },
      });
      // Still unspent: nothing on the TOTP path so much as looked at it.
      await expect(w.recovery.consume(w.userId, code)).resolves.toBeUndefined();
    });

    it('does not accept a TOTP code presented as a recovery code', async () => {
      const w = makeLogin();
      await w.recovery.generate(w.userId);

      await expect(
        w.verification.completeLoginWithRecoveryCode(
          await mint(w),
          currentCodeFor(FAKE_TOTP_SEED),
          CLIENT,
        ),
      ).rejects.toBeInstanceOf(MfaVerificationFailedError);
      expect(w.audited).toHaveLength(1);
      expect(w.audited[0]).toMatchObject({
        actorId: w.userId,
        action: AuditAction.MFA_CHALLENGE_FAILED,
        metadata: { reason: 'verification_failed', proof: 'recovery_code' },
      });
    });

    it('refuses a recovery code issued to another account', async () => {
      const w = makeLogin();
      const [theirs] = await w.recovery.generate(OTHER);

      await expect(w.verification.completeLoginWithRecoveryCode(await mint(w), theirs, CLIENT))
        .rejects.toBeInstanceOf(MfaVerificationFailedError);

      // Recorded against the account whose challenge it was, not the one the
      // code was issued to: nothing has been established about the other one.
      expect(w.audited).toHaveLength(1);
      expect(w.audited[0]).toMatchObject({
        actorId: w.userId,
        action: AuditAction.MFA_CHALLENGE_FAILED,
        metadata: { reason: 'verification_failed', proof: 'recovery_code' },
      });
    });
  });
});
