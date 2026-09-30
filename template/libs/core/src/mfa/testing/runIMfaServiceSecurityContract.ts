import { MfaVerificationFailedError } from '../errors/MfaVerificationFailedError';
import type { IMfaServiceSecurityContractDeps } from './IMfaServiceSecurityContractDeps';

/**
 * The properties an implementation that owns its own store must exhibit,
 * over and above {@link runIMfaServiceContract}.
 *
 * Three assertions live here, and the reason is narrower than "this
 * suite is for cross-user behavior" — it is for behavior that needs a state
 * no caller of the contract can produce or a value no method of the
 * contract returns. The store's own row for a recovery-code batch is such a
 * value: no `IMfaService` method hands it back, so only an implementation
 * that owns the store can show it to a test honestly, and a stub built to
 * fake it could only assert something it cannot actually observe. A second
 * user's confirmed method does *not* meet that bar — it is built from two
 * ordinary calls to the public contract, so the cross-user "not found"
 * assertion lives in {@link runIMfaServiceContract} instead, and so do the
 * removal and regeneration assertions that can be proven with a recovery code —
 * the batch `confirmTotpEnrollment` returns is in every caller's hands. What a
 * caller cannot hold is a **live TOTP code**: confirming a method spends the
 * code that confirmed it, so the two assertions here about a code proving once
 * need the seeded method whose current code nothing has yet used. See
 * `libs/core/README.md`'s note on DEC-1 and
 * `IMfaServiceSecurityContractDeps`'s own TSDoc for why the one field this
 * suite still needs has to be seeded directly rather than through
 * `IMfaService` itself.
 *
 * @param deps - the host runner's primitives and a fresh-world factory
 */
export function runIMfaServiceSecurityContract(deps: IMfaServiceSecurityContractDeps): void {
  const { describe, it, expect, makeContext } = deps;

  describe('IMfaService security conformance', () => {
    describe('regenerateRecoveryCodes', () => {
      // What spec §9.3's "stored hashed" is worth: a store an attacker
      // could merely read from — a backup, a misconfigured replica, a stray
      // log — must not hand them a usable code. This is the property no
      // caller of the contract could ever check on its own, which is why it
      // lives here rather than in the shared suite.
      it('stores recovery codes as digests, never their plaintext', async () => {
        const {
          service,
          actorId,
          actorMethodId,
          computeActorCode,
          readStoredRecoveryCodeValues,
        } = await makeContext();

        const batch = await service.regenerateRecoveryCodes(
          actorId,
          { methodId: actorMethodId, code: computeActorCode() },
        );
        expect.ok(batch.codes.length > 0, 'a minted batch must actually hold codes');

        const stored = await readStoredRecoveryCodeValues();
        expect.equal(
          stored.length,
          batch.codes.length,
          'the store must hold exactly one row per issued code',
        );

        const leaked = batch.codes.filter((code) => stored.includes(code));
        expect.equal(
          leaked.length,
          0,
          'a plaintext recovery code must never be the value the store holds',
        );
      });

      // A code is only a proof once. What a caller cannot build is the state this
      // needs — a confirmed method whose current code has not been used for
      // anything: confirming a method spends the code that confirmed it, so
      // through the contract alone every code a caller can compute is already
      // spent, and no caller could present a live one to be refused the second time.
      it('accepts a live code once, and refuses the same code presented again', async () => {
        const { service, actorId, actorMethodId, computeActorCode } = await makeContext();
        // One value, presented twice: a second call to `computeActorCode` could
        // fall in the next step and be a different, live, code.
        const code = computeActorCode();

        await service.regenerateRecoveryCodes(actorId, { methodId: actorMethodId, code });

        await expect.rejects(
          () => service.regenerateRecoveryCodes(actorId, { methodId: actorMethodId, code }),
          MfaVerificationFailedError,
        );
      });
    });

    describe('removeMethod', () => {
      // The same missing state, from the removal side: the one method is
      // seeded with a code nothing has yet spent, so the proof can be live.
      it('removes the last confirmed method when a live code accompanies it', async () => {
        const { service, actorId, actorMethodId, computeActorCode } = await makeContext();

        await service.removeMethod(
          actorId,
          actorMethodId,
          { methodId: actorMethodId, code: computeActorCode() },
        );

        const remaining = await service.listMethods(actorId);
        expect.equal(
          remaining.some((method) => method.id === actorMethodId),
          false,
          'a live proof of the second factor must be enough to remove its last method',
        );
      });
    });
  });
}
