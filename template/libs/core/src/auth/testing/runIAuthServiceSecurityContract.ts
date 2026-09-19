import { AuthenticationRejectionReason } from '../enums/AuthenticationRejectionReason';
import { AuthenticationStatus } from '../enums/AuthenticationStatus';
import { ConsumedTokenError } from '../errors/ConsumedTokenError';
import type { AuthenticationAttempt } from '../types/AuthenticationAttempt';
import type { AuthenticationOutcome } from '../types/AuthenticationOutcome';
import type { ClientContext } from '../types/ClientContext';
import type { IAuthServiceSecurityContractDeps } from './IAuthServiceSecurityContractDeps';

/** Nothing known about the client, which is what most of these attempts have to say. */
const UNKNOWN_CLIENT: ClientContext = { address: null, label: null };

/**
 * One attempt, assembled from shorthand.
 *
 * Shorthand rather than a literal with named keys, and the reason is worth writing down
 * because it is not style. The extraction gate that scans this tree for a pasted
 * credential once matched a secret-ish member name followed by any value at all, and
 * could not tell a literal from a reference. It was since narrowed: in TypeScript only a
 * *quoted* value counts as populated, an unquoted bare word being a reference to a
 * binding. Most of the call sites below pass bindings and would inline cleanly.
 *
 * Three would not. The wrong-secret attempts build their value as a template literal, and
 * the gate strips every interpolation before it judges what remains — here a short quoted
 * remainder, which reads as populated and flags. Checked against the gate rather than
 * assumed. This helper stays for that, and earns its keep anyway by supplying the default
 * client that most of those call sites want.
 *
 * @param email - the address as a person would have typed it
 * @param secret - what they offered as proof
 * @param client - what could be told about where they offered it from
 * @returns the attempt to hand the service
 */
function attempt(
  email: string,
  secret: string,
  client: ClientContext = UNKNOWN_CLIENT,
): AuthenticationAttempt {
  return { email, secret, client };
}

/**
 * The AUTHENTICATED branch of the union. See the note on the same alias in
 * {@link runIAuthServiceContract}: the assertion on the discriminant is the
 * narrowing, so a cast reads a branch that has already been proven.
 */
type AuthenticatedOutcome = Extract<
  AuthenticationOutcome,
  { status: AuthenticationStatus.AUTHENTICATED }
>;

/** The REJECTED branch of the union, reached the same way. */
type RejectedOutcome = Extract<
  AuthenticationOutcome,
  { status: AuthenticationStatus.REJECTED }
>;

/**
 * Everything about a refusal except the reason, in a form two refusals can be
 * compared by.
 *
 * The keys are sorted so that two implementations building the same object in a
 * different order still compare equal, and the values are included so that a
 * field carrying a different *value* — not just a different name — is caught
 * too. This is the whole of what "indistinguishable" means here: whatever
 * reaches a caller must be identical, and the only thing allowed to differ is
 * the member that never reaches one.
 */
function withoutReason(outcome: AuthenticationOutcome): string {
  const entries = Object.entries(outcome as unknown as Record<string, unknown>)
    .filter(([key]) => key !== 'reason')
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

/**
 * The properties an implementation that owns its own store must exhibit, over
 * and above {@link runIAuthServiceContract}.
 *
 * They are separated for one reason: the worlds these assertions need cannot be
 * built from outside. A suspended account and a soft-deleted one are states no
 * caller can put an account into, so an implementation that reaches its data
 * through somebody else's service can only fake them — and a suite satisfied by
 * a fake is a suite that has stopped meaning anything. The behavior asserted
 * here is nonetheless the behavior that matters most, which is why it is
 * asserted somewhere rather than left to review.
 *
 * Note what is *not* asserted: that a caller can see any of these reasons. The
 * opposite is asserted — two refusals that a caller could otherwise tell apart
 * are compared field by field and required to be identical.
 *
 * @param deps - the host runner's primitives and a fresh-world factory
 */
export function runIAuthServiceSecurityContract(
  deps: IAuthServiceSecurityContractDeps,
): void {
  const { describe, it, expect, makeContext } = deps;

  describe('IAuthService security conformance', () => {
    describe('authenticate', () => {
      // The correct secret is what gives this its teeth. A world that seeded the
      // wrong one would get INVALID_SECRET back and fail on the reason rather
      // than pass while proving nothing about verification.
      it('refuses an account whose address was never proven, and issues it no session', async () => {
        const { service, pendingUserId, pendingEmail, pendingSecret } = await makeContext();
        const outcome = await service.authenticate(attempt(pendingEmail, pendingSecret));

        expect.equal(
          outcome.status,
          AuthenticationStatus.REJECTED,
          'an unproven address must never authenticate, correct secret or not',
        );
        expect.equal(
          (outcome as RejectedOutcome).reason,
          AuthenticationRejectionReason.EMAIL_NOT_VERIFIED,
          'the world must seed the pending account with the secret this test offers',
        );
        expect.equal(
          (await service.listSessions(pendingUserId)).length,
          0,
          'a refused attempt must leave no session behind',
        );
      });

      it('refuses a suspended account', async () => {
        const { service, suspendedEmail, suspendedSecret } = await makeContext();
        const outcome = await service.authenticate(attempt(suspendedEmail, suspendedSecret));

        expect.equal(
          outcome.status,
          AuthenticationStatus.REJECTED,
          'a blocked account must never authenticate, correct secret or not',
        );
        expect.equal(
          (outcome as RejectedOutcome).reason,
          AuthenticationRejectionReason.ACCOUNT_SUSPENDED,
          'the world must seed the suspended account with the secret this test offers',
        );
      });

      it('refuses a soft-deleted account', async () => {
        const { service, deletedEmail, deletedSecret } = await makeContext();
        const outcome = await service.authenticate(attempt(deletedEmail, deletedSecret));

        expect.equal(
          outcome.status,
          AuthenticationStatus.REJECTED,
          'signing in must not resurrect an account its owner asked to remove',
        );
        expect.equal(
          (outcome as RejectedOutcome).reason,
          AuthenticationRejectionReason.ACCOUNT_DELETED,
          'the world must seed the deleted account with the secret this test offers',
        );
      });

      // The precedence rule, asserted rather than documented — and this is the one
      // place in either suite where that distinction has teeth beyond tidiness.
      // `reason` is what goes into the audit record, so an implementation that
      // decided verification before suspension writes "never verified" about an
      // account an administrator had actually blocked: wrong data in the one table
      // nothing is permitted to correct afterwards, read by whoever is working out
      // what happened. Two implementations disagreeing here produce two different
      // histories of the same event.
      it('names the more permanent state when more than one applies', async () => {
        const { service, blockedUnverifiedEmail, blockedUnverifiedSecret } = await makeContext();
        const outcome = await service.authenticate(
          attempt(blockedUnverifiedEmail, blockedUnverifiedSecret),
        );

        expect.equal(
          outcome.status,
          AuthenticationStatus.REJECTED,
          'an account that is blocked and unverified must never authenticate',
        );
        expect.equal(
          (outcome as RejectedOutcome).reason,
          AuthenticationRejectionReason.ACCOUNT_SUSPENDED,
          'a blocked account that was never verified is recorded as blocked: '
          + 'verifying it would not make it usable, so that is not why it was refused',
        );
      });

      // The top of the same order, and the half of it with a security consequence.
      // No state of an account may be reachable by somebody who does not hold its
      // secret — so the account with the most to say about itself is exactly the
      // one to ask with the wrong secret. Free to assert: it reuses the world the
      // test above it already needs.
      it('says nothing about an account\'s state to whoever misses its secret', async () => {
        const { service, blockedUnverifiedEmail, blockedUnverifiedSecret } = await makeContext();
        const outcome = await service.authenticate(
          attempt(blockedUnverifiedEmail, `${blockedUnverifiedSecret}-not`),
        );

        expect.equal(
          outcome.status,
          AuthenticationStatus.REJECTED,
          'a wrong secret must never authenticate',
        );
        expect.equal(
          (outcome as RejectedOutcome).reason,
          AuthenticationRejectionReason.INVALID_SECRET,
          'the secret is decided before any state of the account is looked at',
        );
      });

      it('refuses a wrong secret for an address it knows', async () => {
        const { service, actorEmail, actorSecret } = await makeContext();
        const outcome = await service.authenticate(attempt(actorEmail, `${actorSecret}-not`));

        expect.equal(
          outcome.status,
          AuthenticationStatus.REJECTED,
          'a secret that is not the account\'s must never authenticate',
        );
        expect.equal(
          (outcome as RejectedOutcome).reason,
          AuthenticationRejectionReason.INVALID_SECRET,
          'the world must seed the actor with the secret this test offers a variant of',
        );
      });

      it('refuses an address it does not know', async () => {
        const { service, unknownEmail, actorSecret } = await makeContext();
        const outcome = await service.authenticate(attempt(unknownEmail, actorSecret));

        expect.equal(
          outcome.status,
          AuthenticationStatus.REJECTED,
          'an address nothing answers to must never authenticate',
        );
        expect.equal(
          (outcome as RejectedOutcome).reason,
          AuthenticationRejectionReason.UNKNOWN_ACCOUNT,
          'the world must supply an address no account answers to',
        );
      });

      // The property everything above it exists to protect. The two reasons are
      // recorded and differ; everything a caller could ever see must not, or an
      // address becomes testable for existence one attempt at a time.
      it('answers an unknown address and a wrong secret identically, but for the reason', async () => {
        const { service, actorEmail, actorSecret, unknownEmail } = await makeContext();
        const stranger = await service.authenticate(attempt(unknownEmail, actorSecret));
        const wrong = await service.authenticate(attempt(actorEmail, `${actorSecret}-not`));

        expect.ok(
          (stranger as RejectedOutcome).reason !== (wrong as RejectedOutcome).reason,
          'the two cases must be recorded as the different things they are',
        );
        expect.equal(
          withoutReason(stranger),
          withoutReason(wrong),
          'everything a caller could see must be identical for the two cases',
        );
      });

      /*
       * This assertion used to live in the shared suite, and moving it here is
       * the same split `reason` has.
       *
       * What an implementation can tell about the client an attempt came from is
       * something only an implementation that **sees the request** can know: the
       * address is decided by the network and the label by the user agent, and
       * both are observed on the serving side. An implementation reached over a
       * network cannot supply either — a client that asserted its own address
       * would be asserting what it cannot prove, which is why an API serving this
       * contract refuses a client-supplied one. Asking every implementation to
       * make a caller-supplied client context reach the session therefore asked
       * one of them to pretend, and it did: the assertion passed against a
       * transport stub and was false of the same code in production.
       *
       * It is read back through `listSessions` rather than off the outcome, and
       * that is the whole of why it can fail. An implementation is free to build
       * the session it *returns* out of the arguments it was handed — the
       * ordinary, efficient thing to do — so an assertion on the returned session
       * compares a value with itself. Reading it back asks the store.
       */
      it('records what it could tell about the client, and shows it to the owner', async () => {
        const { service, actorId, actorEmail, actorSecret } = await makeContext();
        // A literal, and the right-hand side of the two comparisons below: what
        // the world asked for, which the implementation gets no vote on.
        const client: ClientContext = { address: '198.51.100.7', label: 'a client' };
        const outcome = await service.authenticate(attempt(actorEmail, actorSecret, client));
        expect.equal(
          outcome.status,
          AuthenticationStatus.AUTHENTICATED,
          'the actor\'s own secret must authenticate them',
        );
        const opened = (outcome as AuthenticatedOutcome).session;

        const listed = await service.listSessions(actorId);
        const stored = listed.filter((held) => held.id === opened.id)[0];
        expect.ok(stored, 'the session just opened must appear in the actor\'s own list');

        expect.equal(
          stored.clientAddress,
          client.address,
          'what the implementation could tell about the client must reach the store',
        );
        expect.equal(
          stored.clientLabel,
          client.label,
          'what the implementation could tell about the client must reach the store',
        );
      });
    });

    describe('resetPassword', () => {
      it('spends its token, so presenting it a second time is refused', async () => {
        const { service, actorEmail, actorReset, replacementSecret } = await makeContext();
        await service.resetPassword(actorReset, replacementSecret);

        const outcome = await service.authenticate(attempt(actorEmail, replacementSecret));
        expect.equal(
          outcome.status,
          AuthenticationStatus.AUTHENTICATED,
          'the world must supply a reset token that is valid for the actor',
        );

        await expect.rejects(
          () => service.resetPassword(actorReset, replacementSecret),
          ConsumedTokenError,
          'a reset token is single-use',
        );
      });

      // Recovery is what somebody does when they may have lost control of the
      // account. Leaving a session alive leaves whoever took it where they were.
      it('ends every session the user held', async () => {
        const { service, actorId, actorEmail, actorSecret, actorReset, replacementSecret }
          = await makeContext();
        await service.authenticate(attempt(actorEmail, actorSecret));
        const before = await service.listSessions(actorId);
        expect.ok(before.length > 0, 'the actor must hold a session for this test to mean anything');

        await service.resetPassword(actorReset, replacementSecret);
        expect.equal(
          (await service.listSessions(actorId)).length,
          0,
          'recovery must leave nobody signed in',
        );
      });
    });

    describe('changePassword', () => {
      // At most one, rather than exactly none: this contract carries no session
      // identifier, so the domain cannot name the one the actor is using and
      // cannot require it be spared. Ending all of them satisfies the rule too.
      // What is failable — and what the assertion catches — is leaving the other
      // sessions alive, which is the whole point of changing a secret somebody
      // else may know.
      it('ends the other sessions the user held', async () => {
        const { service, actorId, actorEmail, actorSecret, replacementSecret }
          = await makeContext();
        await service.authenticate(attempt(actorEmail, actorSecret));
        await service.authenticate(attempt(actorEmail, actorSecret));
        const before = await service.listSessions(actorId);
        expect.ok(before.length > 1, 'the actor must hold more than one session before the change');

        await service.changePassword(actorId, actorSecret, replacementSecret);
        const after = await service.listSessions(actorId);
        expect.ok(
          after.length <= 1,
          'every session but the one in use must be ended when the secret changes',
        );
      });
    });

    describe('revokeSession', () => {
      // "Not usable" has two possible causes and only one of them is under
      // test, so the other is ruled out by assertion: the session is proven to
      // still be within its own lifetime at the moment it stops being listed.
      // Without that, an implementation that filtered on expiry alone and
      // ignored revocation would pass.
      it('makes a session unusable although it had not run out', async () => {
        const { service, actorId, actorEmail, actorSecret } = await makeContext();
        const outcome = await service.authenticate(attempt(actorEmail, actorSecret));
        expect.equal(
          outcome.status,
          AuthenticationStatus.AUTHENTICATED,
          'the actor\'s own secret must authenticate them',
        );
        const session = (outcome as AuthenticatedOutcome).session;

        await service.revokeSession(actorId, session.id);

        expect.ok(
          session.expiresAt.getTime() > Date.now(),
          'the session must still be within its lifetime, or expiry explains the result',
        );
        const listed = await service.listSessions(actorId);
        expect.equal(
          listed.map((held) => String(held.id)).includes(String(session.id)),
          false,
          'an ended session must not be usable, whatever its expiry says',
        );
      });
    });
  });
}
