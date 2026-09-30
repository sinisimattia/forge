import { MfaMethod } from '../entities/MfaMethod';
import { MfaMethodAlreadyConfirmedError } from '../errors/MfaMethodAlreadyConfirmedError';
import { MfaMethodNotFoundError } from '../errors/MfaMethodNotFoundError';
import { MfaReauthenticationRequiredError } from '../errors/MfaReauthenticationRequiredError';
import { MfaVerificationFailedError } from '../errors/MfaVerificationFailedError';
import { RecoveryCodeAlreadyConsumedError } from '../errors/RecoveryCodeAlreadyConsumedError';
import type { MfaMethodId } from '../types/MfaMethodId';
import type { RecoveryCodeBatch } from '../types/RecoveryCodeBatch';
import type { IMfaServiceContractDeps, MfaServiceContractContext } from './IMfaServiceContractDeps';

/**
 * The behavior every {@link IMfaService} implementation must exhibit.
 *
 * Each implementation drives this suite with its own runner's
 * `describe`/`it`/`expect`, which is what makes "they behave the same" a
 * fact the build checks rather than a claim a reviewer makes. The suite
 * asserts behavior only: who is *allowed* to call these methods is enforced
 * where the implementation lives, and is held to its own suite there.
 *
 * ## What is deliberately not here (DEC-1)
 *
 * One property of a correct implementation is missing on purpose, and moves
 * to a server-only suite instead: that recovery codes are stored as digests
 * rather than in the clear. No `IMfaService` method returns a persisted
 * value, so nothing here could read the store's own row to check it — that
 * is exactly what a transport boundary exists to keep a caller from doing,
 * and a stub built to satisfy the assertion anyway could only do so by
 * asserting something it cannot actually observe, i.e. by lying. See
 * `runIMfaServiceSecurityContract` and `libs/core/README.md`'s note on DEC-1.
 *
 * What is *not* excluded on that basis: a method belonging to another user
 * being indistinguishable from one that does not exist. That property needs
 * no state a caller cannot produce — a second user's confirmed method is
 * built through the same two public calls `listMethods`'s own test uses,
 * `beginTotpEnrollment` then `confirmTotpEnrollment` — so any implementation
 * reached over a network can demonstrate it honestly, and DEC-1 restricting
 * this suite to what can be demonstrated honestly is exactly the reason it
 * belongs here rather than in the security suite.
 *
 * @param deps - the host runner's primitives and a fresh-world factory
 */
export function runIMfaServiceContract(deps: IMfaServiceContractDeps): void {
  const { describe, it, expect, makeContext } = deps;

  /**
   * Enrols and confirms one method through the contract, the way any caller
   * would. `batch` is non-`null` only for the account's first.
   */
  async function confirmedMethod(
    context: MfaServiceContractContext,
    label: string,
  ): Promise<{ methodId: MfaMethodId; batch: RecoveryCodeBatch | null }> {
    const offer = await context.service.beginTotpEnrollment(context.actorId, label);
    const batch = await context.service.confirmTotpEnrollment(
      context.actorId,
      offer.methodId,
      context.validCodeFor(offer),
    );
    return { methodId: offer.methodId, batch };
  }

  /** Which of the actor's methods are listed, by id. */
  async function listedIds(context: MfaServiceContractContext): Promise<string[]> {
    const listed = await context.service.listMethods(context.actorId);
    return listed.map((method) => String(method.id));
  }

  /**
   * What a refused recovery-code proof throws: a code that was spent, or one a
   * superseded batch no longer holds. Which of the two an implementation says is
   * its own to decide — a retired code is not evidence of anything — so the
   * property asserted is only that it is one of the two, and never a success.
   */
  async function refusalOf(attempt: () => Promise<unknown>): Promise<unknown> {
    return attempt().then(
      () => undefined,
      (error: unknown) => error,
    );
  }

  /**
   * Whether `refusal` is one of the two refusals a recovery-code proof may raise.
   *
   * `some` over a list rather than `a instanceof X || a instanceof Y`: this suite
   * is driven against implementations that each say only one of the two, so the
   * second operand of a written-out `||` is reached by whichever driver says the
   * other, and never by the other driver — a branch one implementation cannot
   * take, counted against a gate that runs this file for both. The list has no
   * branch to count, and asserts exactly what the `||` did.
   */
  const isRecoveryProofRefusal = (refusal: unknown): boolean =>
    [MfaVerificationFailedError, RecoveryCodeAlreadyConsumedError]
      .some((kind) => refusal instanceof kind);

  describe('IMfaService conformance', () => {
    describe('listMethods', () => {
      it('returns the actor\'s own methods, and nothing else, as real entities', async () => {
        const { service, actorId, otherUserId, validCodeFor } = await makeContext();

        const actorOffer = await service.beginTotpEnrollment(actorId, 'Actor\'s phone');
        await service.confirmTotpEnrollment(actorId, actorOffer.methodId, validCodeFor(actorOffer));

        const otherOffer = await service.beginTotpEnrollment(otherUserId, 'Someone else\'s phone');
        await service.confirmTotpEnrollment(
          otherUserId,
          otherOffer.methodId,
          validCodeFor(otherOffer),
        );

        const listed = await service.listMethods(actorId);

        const impostors = listed.filter((method) => !(method instanceof MfaMethod));
        expect.equal(impostors.length, 0, 'listMethods must return real entities');

        const listedIds = listed.map((method) => String(method.id));
        expect.equal(
          listedIds.includes(String(actorOffer.methodId)),
          true,
          'the actor\'s own method must come back',
        );
        expect.equal(
          listedIds.includes(String(otherOffer.methodId)),
          false,
          'another user\'s method must never appear',
        );
      });
    });

    describe('confirmTotpEnrollment', () => {
      it(
        'returns a recovery code batch for the account\'s first confirmation, and null after',
        async () => {
          const { service, actorId, validCodeFor } = await makeContext();

          const firstOffer = await service.beginTotpEnrollment(actorId, 'First method');
          const firstBatch = await service.confirmTotpEnrollment(
            actorId,
            firstOffer.methodId,
            validCodeFor(firstOffer),
          );
          expect.ok(firstBatch !== null, 'the first confirmed method must mint recovery codes');
          // A type assertion, not a runtime branch: the check above already
          // failed the test if this does not hold, so narrowing any further
          // here would be a branch nothing can ever take the other side of.
          const firstCodes = (firstBatch as RecoveryCodeBatch).codes;
          expect.ok(firstCodes.length > 0, 'a minted batch must actually hold codes');

          const secondOffer = await service.beginTotpEnrollment(actorId, 'Second method');
          const secondBatch = await service.confirmTotpEnrollment(
            actorId,
            secondOffer.methodId,
            validCodeFor(secondOffer),
          );
          expect.equal(
            secondBatch,
            null,
            'an account\'s recovery codes are minted once, not once per method (spec §9.3)',
          );
        },
      );

      it('refuses to confirm a method that is already confirmed', async () => {
        const { service, actorId, validCodeFor } = await makeContext();

        const offer = await service.beginTotpEnrollment(actorId, 'Phone');
        const code = validCodeFor(offer);
        await service.confirmTotpEnrollment(actorId, offer.methodId, code);

        await expect.rejects(
          () => service.confirmTotpEnrollment(actorId, offer.methodId, code),
          MfaMethodAlreadyConfirmedError,
        );
      });
    });

    describe('removeMethod', () => {
      it('refuses an id that does not exist', async () => {
        const { service, actorId, absentMethodId } = await makeContext();

        await expect.rejects(
          () => service.removeMethod(actorId, absentMethodId, null),
          MfaMethodNotFoundError,
        );
      });

      // Built through the contract, the same way `listMethods`'s own test
      // builds a second user's method — which is what makes this a shared
      // assertion rather than a server-only one (see this file's own TSDoc).
      //
      // `otherUserId`'s method is left as their ONLY confirmed one, and that
      // is what gives the test its teeth. Removing an account's last
      // confirmed method is the one case `decideMfaRemoval` does not allow
      // on the strength of the requesting session alone, so an
      // implementation that resolved "does this id exist, and what would
      // removing it cost" *before* "is it the actor's" answers
      // `MfaReauthenticationRequiredError` to a foreign id instead of
      // `MfaMethodNotFoundError` — leaking that the id both exists and is
      // somebody's last confirmed method.
      it('answers identically for another user\'s method and a missing one', async () => {
        const { service, actorId, otherUserId, validCodeFor, absentMethodId } = await makeContext();

        const otherOffer = await service.beginTotpEnrollment(otherUserId, 'Someone else\'s phone');
        await service.confirmTotpEnrollment(
          otherUserId,
          otherOffer.methodId,
          validCodeFor(otherOffer),
        );

        const foreign: unknown = await service
          .removeMethod(actorId, otherOffer.methodId, null)
          .catch((error: unknown) => error);
        const missing: unknown = await service
          .removeMethod(actorId, absentMethodId, null)
          .catch((error: unknown) => error);

        expect.ok(
          foreign instanceof MfaMethodNotFoundError,
          'another user\'s method must be reported as not found',
        );
        expect.ok(
          missing instanceof MfaMethodNotFoundError,
          'a missing method must be reported as not found',
        );
        // Documentation rather than a guard: the two checks above already fix
        // both constructors. Kept because the property under test is "these
        // two cases are the same error", and a reader should find that
        // written down rather than inferred from two separate instanceof
        // checks.
        expect.equal(
          (foreign as Error).constructor,
          (missing as Error).constructor,
          'the two cases must be indistinguishable to the caller',
        );
      });

      it('removes an unconfirmed method without any proof', async () => {
        const context = await makeContext();
        const { service, actorId } = context;
        const offer = await service.beginTotpEnrollment(actorId, 'Never finished');

        await service.removeMethod(actorId, offer.methodId, null);

        expect.equal(
          (await listedIds(context)).includes(String(offer.methodId)),
          false,
          'an unconfirmed method was never a gate, so it comes off for free',
        );
      });

      it('removes a confirmed method on the session alone while another remains', async () => {
        const context = await makeContext();
        const first = await confirmedMethod(context, 'First');
        await confirmedMethod(context, 'Second');

        await context.service.removeMethod(context.actorId, first.methodId, null);

        expect.equal(
          (await listedIds(context)).includes(String(first.methodId)),
          false,
          'the method must be gone',
        );
      });

      it('refuses to remove the last confirmed method without a proof', async () => {
        const context = await makeContext();
        const only = await confirmedMethod(context, 'Only');

        await expect.rejects(
          () => context.service.removeMethod(context.actorId, only.methodId, null),
          MfaReauthenticationRequiredError,
        );

        expect.equal(
          (await listedIds(context)).includes(String(only.methodId)),
          true,
          'a refused removal must leave the method in place',
        );
      });

      it('refuses a proof that does not verify, and leaves the method in place', async () => {
        const context = await makeContext();
        const only = await confirmedMethod(context, 'Only');

        await expect.rejects(
          () => context.service.removeMethod(
            context.actorId,
            only.methodId,
            { methodId: only.methodId, code: 'not-a-code' },
          ),
          MfaVerificationFailedError,
        );

        expect.equal(
          (await listedIds(context)).includes(String(only.methodId)),
          true,
          'a wrong proof must not remove anything',
        );
      });

      // The account's only option when it signed up through a provider and lost
      // its phone. The batch is the one `confirmTotpEnrollment` returned, so the
      // proof is built from what any caller of this contract holds.
      it('accepts a recovery code as the proof for the last confirmed method', async () => {
        const context = await makeContext();
        const only = await confirmedMethod(context, 'Only');
        const codes = (only.batch as RecoveryCodeBatch).codes;

        await context.service.removeMethod(
          context.actorId,
          only.methodId,
          { recoveryCode: codes[0] },
        );

        expect.equal(
          (await listedIds(context)).includes(String(only.methodId)),
          false,
          'a recovery code is a live proof, so the removal must go through',
        );
      });

      it('refuses a proof that is another user\'s recovery code', async () => {
        const context = await makeContext();
        const only = await confirmedMethod(context, 'Only');

        const otherOffer = await context.service.beginTotpEnrollment(context.otherUserId, 'Theirs');
        const otherBatch = await context.service.confirmTotpEnrollment(
          context.otherUserId,
          otherOffer.methodId,
          context.validCodeFor(otherOffer),
        );
        const stolen = (otherBatch as RecoveryCodeBatch).codes[0];

        const refusal = await refusalOf(
          () => context.service.removeMethod(
            context.actorId,
            only.methodId,
            { recoveryCode: stolen },
          ),
        );

        expect.ok(
          isRecoveryProofRefusal(refusal),
          'somebody else\'s recovery code must be refused as a proof, and by a domain error',
        );
        expect.equal(
          (await listedIds(context)).includes(String(only.methodId)),
          true,
          'the method must survive',
        );
      });
    });

    describe('regenerateRecoveryCodes', () => {
      it('refuses a proof that does not verify', async () => {
        const context = await makeContext();
        const only = await confirmedMethod(context, 'Only');

        await expect.rejects(
          () => context.service.regenerateRecoveryCodes(
            context.actorId,
            { methodId: only.methodId, code: 'not-a-code' },
          ),
          MfaVerificationFailedError,
        );
      });

      it('replaces the batch on a recovery-code proof, and the old codes stop working', async () => {
        const context = await makeContext();
        const only = await confirmedMethod(context, 'Only');
        const oldCodes = (only.batch as RecoveryCodeBatch).codes;

        const fresh = await context.service.regenerateRecoveryCodes(
          context.actorId,
          { recoveryCode: oldCodes[0] },
        );

        expect.ok(fresh.codes.length > 0, 'a regenerated batch must actually hold codes');
        expect.equal(
          fresh.codes.some((code) => oldCodes.includes(code)),
          false,
          'a regenerated batch must not repeat a code from the one it replaced',
        );

        // A code from the superseded batch that was never spent: retired with it.
        const superseded = await refusalOf(
          () => context.service.regenerateRecoveryCodes(
            context.actorId,
            { recoveryCode: oldCodes[1] },
          ),
        );
        expect.ok(
          isRecoveryProofRefusal(superseded),
          'a code from a superseded batch must be refused',
        );

        // And the new batch is the live one.
        const again = await context.service.regenerateRecoveryCodes(
          context.actorId,
          { recoveryCode: fresh.codes[0] },
        );
        expect.ok(again.codes.length > 0, 'a code from the current batch must be accepted');
      });

      it('refuses a recovery code that has already been spent', async () => {
        const context = await makeContext();
        const only = await confirmedMethod(context, 'Only');
        const spent = (only.batch as RecoveryCodeBatch).codes[0];
        await context.service.regenerateRecoveryCodes(context.actorId, { recoveryCode: spent });

        const refusal = await refusalOf(
          () => context.service.regenerateRecoveryCodes(context.actorId, { recoveryCode: spent }),
        );

        expect.ok(
          isRecoveryProofRefusal(refusal),
          'a recovery code proves once',
        );
      });
    });
  });
}
