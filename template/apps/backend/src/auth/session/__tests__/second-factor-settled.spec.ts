import type { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import { MfaMethodType, MfaStep } from '__FORGE_SCOPE__/core/mfa/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { FakeDataSource } from '../../../common/testing';
import { MfaMethodRecord } from '../../../mfa/entities/mfa-method-record.entity';
import { mapMfaMethodRecord } from '../../../mfa/mapMfaMethodRecord';
import { SecondFactorSettled } from '../second-factor-settled';
import type { SessionService } from '../session.service';

/**
 * The evidence `SessionService.begin` will not open a session without.
 *
 * ## Two kinds of assertion live here, and the second kind does not run
 *
 * The `it` blocks under **"the query"** are ordinary: they drive
 * `SecondFactorSettled.settle` over a store and read what came back. The block
 * under **"the type"** asserts things about what does *not* compile, and every
 * assertion in it is a `@ts-expect-error` directive rather than an `expect`.
 *
 * That is not a trick, it is the only form the property has. The rule this
 * class exists for — every path that opens a session settled the second factor
 * first — is enforced by a required parameter whose type has no public
 * constructor. A runtime test cannot observe a call site that omitted it,
 * because such a call site does not build. `@ts-expect-error` is the assertion
 * that fits: it **fails** when the line beneath it compiles, so each directive
 * turns red on exactly the change that would reopen the hole — a parameter made
 * optional, a constructor made public, the union flattened so evidence is
 * readable without narrowing.
 *
 * **One tier holds them, and it is not jest.** `tsconfig.base.json` sets
 * `isolatedModules`, which `ts-jest` honours by transpiling only: a deliberate
 * type error in this file passes the suite silently, so a green jest run is no
 * evidence about any directive below. What holds them is the `typecheck` target
 * — `tsc --noEmit`, whose `include` covers every TypeScript file under `src`,
 * this one included — which CI runs through
 * `nx affected` (`.github/workflows/ci.yml`). That is a standing guard rather
 * than a comment about a compiler, but it is the only one: a change that dropped
 * the typecheck step would take these assertions with it and no other tier would
 * notice.
 *
 * ## What the store here cannot express
 *
 * `FakeDataSource` does not isolate transactions — a reader outside one sees
 * its uncommitted writes (item 1 of that class's own inventory). So the reason
 * `settleIn` exists at all, that `OAuthService.provisionAndSignIn` must read
 * through its own transaction to see the account it just inserted, is not
 * expressible here: `settle` would answer identically against this store and
 * not against Postgres. The case below pins that `settleIn` reads through the
 * manager it is handed, which is the part a fake can honestly report.
 */
describe('SecondFactorSettled', () => {
  const OWNER = 'user-with-methods' as UserId;
  /** Not a credential: nothing here verifies a code. The named constant is the
   *  convention `mapMfaMethodRecord.spec.ts` and its siblings already follow. */
  const FAKE_TOTP_SEED = 'JBSWY3DPEHPK3PXP';
  const EPOCH = new Date('2026-09-30T10:00:00.000Z');

  let source: FakeDataSource;

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  const methods = (): Repository<MfaMethodRecord> => repo<MfaMethodRecord>(MfaMethodRecord);

  /** One `mfa_methods` row, in the shape the table holds it. */
  const row = (over: Record<string, unknown>): Record<string, unknown> => ({
    id: `method-${String(over.label ?? 'x')}`,
    userId: OWNER,
    type: MfaMethodType.TOTP,
    label: 'an authenticator',
    totpSecret: FAKE_TOTP_SEED,
    totpLastStep: null,
    webauthnCredentialId: null,
    webauthnPublicKey: null,
    webauthnCounter: null,
    confirmedAt: EPOCH,
    lastUsedAt: null,
    createdAt: EPOCH,
    ...over,
  });

  beforeEach(() => {
    source = new FakeDataSource();
  });

  describe('the query', () => {
    it('answers ISSUE_SESSION, carrying evidence, for an account holding nothing', async () => {
      const outcome = await SecondFactorSettled.settle(methods(), OWNER);

      expect(outcome.step).toBe(MfaStep.ISSUE_SESSION);
      // Narrowed, because that is the only way to reach the evidence — which is
      // the whole point of the union and is asserted as a type below.
      if (outcome.step !== MfaStep.ISSUE_SESSION) throw new Error('unreachable');
      expect(outcome.settled).toBeInstanceOf(SecondFactorSettled);
    });

    it('answers REQUIRE_SECOND_FACTOR, naming the methods, for a confirmed one', async () => {
      source.seed(MfaMethodRecord, [row({ label: 'confirmed' })]);

      const outcome = await SecondFactorSettled.settle(methods(), OWNER);

      expect(outcome.step).toBe(MfaStep.REQUIRE_SECOND_FACTOR);
      if (outcome.step !== MfaStep.REQUIRE_SECOND_FACTOR) throw new Error('unreachable');
      expect(outcome.methods.map((method) => method.label)).toEqual(['confirmed']);
      // No evidence anywhere on this arm, at runtime as well as in the type: an
      // implementation that attached it "for convenience" would hand a caller
      // the one value that opens a session on the branch that must not.
      expect(Object.keys(outcome)).toEqual(['step', 'methods']);
    });

    it('ignores an enrollment that was begun and never confirmed', async () => {
      source.seed(MfaMethodRecord, [row({ label: 'abandoned', confirmedAt: null })]);

      const outcome = await SecondFactorSettled.settle(methods(), OWNER);

      // A method nobody has proven can answer a challenge is not a stronger
      // gate but a lock nobody holds a key to. ADR-0012 argues it; this is the
      // assertion that fails if the predicate is dropped.
      expect(outcome.step).toBe(MfaStep.ISSUE_SESSION);
    });

    it('never reads a half-written row, which is the predicate\'s second reason', async () => {
      // A row whose kind and columns disagree. No enrollment path here writes
      // one — WebAuthn writes nothing until the attestation verifies, and then
      // writes a full, confirmed row — so this is seeded rather than produced.
      // The predicate exists because nothing makes that stay true.
      const halfWritten = row({
        label: 'not-reachable-by-enrollment',
        type: MfaMethodType.WEBAUTHN,
        totpSecret: null,
        confirmedAt: null,
      });
      source.seed(MfaMethodRecord, [halfWritten]);

      // What the predicate is preventing, stated rather than implied: mapping
      // this row throws. Without `confirmedAt: Not(IsNull())` in the *query*,
      // one such row turns every sign-in attempt for this account into a 500,
      // and its owner cannot sign in to remove the row that stops them.
      expect(() => mapMfaMethodRecord(halfWritten as unknown as MfaMethodRecord)).toThrow();

      await expect(SecondFactorSettled.settle(methods(), OWNER))
        .resolves.toEqual({ step: MfaStep.ISSUE_SESSION, settled: expect.anything() });
    });

    it('reads through the manager it is handed, not around it', async () => {
      const outcome = await source.transaction(async (manager) => {
        await manager.insert(MfaMethodRecord, row({ label: 'inserted in here' }));
        return SecondFactorSettled.settleIn(manager as unknown as EntityManager, OWNER);
      });

      expect(outcome.step).toBe(MfaStep.REQUIRE_SECOND_FACTOR);
    });
  });

  describe('the type', () => {
    it('refuses every way of reaching `begin` without having asked', () => {
      // NOTHING IN HERE RUNS. `unbuildable` is never called; the assertions are
      // the `@ts-expect-error` directives, each of which fails the build when
      // the line beneath it starts compiling. Read them as: "this is what a
      // path that skipped the policy would look like, and here is the error it
      // gets instead of a session."
      const unbuildable = async (
        sessions: SessionService,
        manager: EntityManager,
        userId: UserId,
        client: ClientContext,
      ): Promise<void> => {
        // @ts-expect-error — no evidence at all. The shape a new call site has
        // before anybody tells it about the rule, and the one this whole design
        // exists to turn into a compile error.
        await sessions.begin(userId, client);

        // @ts-expect-error — the same omission inside somebody else's
        // transaction, which is the variant an impersonation or magic-link path
        // would more likely reach for.
        await sessions.beginIn(manager, userId, client);

        // @ts-expect-error — evidence typed out at the call site. TypeScript is
        // structural, so this is what a `boolean`, a string literal or a marker
        // interface would all have permitted; the private member is what makes
        // the class nominal and this line an error.
        await sessions.begin(userId, client, { premise: 'I checked, honest' });

        // @ts-expect-error — and not by way of the constructor either, which is
        // private, so the only values in existence are the factories'.
        await sessions.begin(userId, client, new SecondFactorSettled('forged'));

        const outcome = await SecondFactorSettled.settle(
          undefined as unknown as Repository<MfaMethodRecord>,
          userId,
        );
        // @ts-expect-error — `settled` lives only on the ISSUE_SESSION arm, so
        // the evidence cannot be reached without writing the narrowing that
        // handles `REQUIRE_SECOND_FACTOR`. This directive is the one that makes
        // the challenge branch impossible to forget rather than merely
        // documented.
        await sessions.begin(userId, client, outcome.settled);
      };

      expect(unbuildable).toBeInstanceOf(Function);
    });
  });
});
