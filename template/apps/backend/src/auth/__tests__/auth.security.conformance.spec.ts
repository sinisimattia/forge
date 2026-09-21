import { runIAuthServiceSecurityContract } from '__FORGE_SCOPE__/core/auth/testing';
import { UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { adaptJestToConformanceExpect, makeIdentityWorld } from '../../common/testing';

/**
 * `AuthService` against core's **backend-only** `IAuthService` security suite.
 *
 * ## DEC-1: the webapp does not drive this suite, and must not be made to
 *
 * DEC-1 splits conformance in two. The *shared* suite
 * (`auth.conformance.spec.ts`) is driven by this backend under jest **and** by
 * the webapp under vitest, because behaviour both implementations genuinely
 * share — outcome discrimination, error mapping, wire shape — is worth checking
 * on both. This suite is driven here and nowhere else.
 *
 * The reason is not workload. The webapp's `IAuthService` is an HTTP client
 * exercised against a stub of this backend's wire shape, so a webapp "proof"
 * that a suspended account cannot sign in would be proving that a stub somebody
 * wrote returns what they told it to return. Worse, it would be a *green* proof:
 * the asymmetry between the two drivers looks like an oversight, and the obvious
 * fix — add a webapp driver, the suites are shared after all — produces a test
 * that passes for ever and asserts nothing about any security property.
 *
 * So: **the missing webapp driver is the design.** Anybody tempted to add one
 * should read the world this suite needs. A suspended account and a soft-deleted
 * one are states no caller of `IAuthService` can produce; they exist here only
 * because this implementation owns its store and writes the columns
 * (`IdentityWorld.patchUser`). An implementation that reaches its data through
 * somebody else's service can only fake them, and a suite satisfied by a fake
 * has stopped meaning anything. The suite's own preamble says the same thing
 * from core's side.
 *
 * ## The world
 *
 * Five accounts, each seeded with its **correct** secret, which is what gives
 * every assertion its teeth: a world that seeded the wrong one would be answered
 * `INVALID_SECRET` and fail on the reason rather than pass while proving nothing
 * about the state it meant to test.
 *
 * Every account is created by driving the real `AuthService.register`. Only the
 * three states registration cannot produce — blocked, blocked-and-unverified,
 * soft-deleted — are written as columns, and the accounts whose addresses must
 * be proven are proven by driving the real `verifyEmail`.
 *
 * One promise here the suite says it cannot check: `blockedUnverifiedEmail` must
 * be blocked **and** unverified, and nothing a caller can do distinguishes a
 * verified blocked account from an unverified one, so seeding a verified one
 * would pass while proving nothing about precedence. It is registered and never
 * verified below, which is the obligation met rather than merely asserted.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/** A replacement, different from every seeded value in the world. */
const REPLACEMENT_PLAINTEXT = 'yet another perfectly fine phrase';

runIAuthServiceSecurityContract({
  describe,
  it,
  expect: adaptJestToConformanceExpect(),
  makeContext: async () => {
    const world = makeIdentityWorld();

    const actorEmail = 'ada@example.test';
    const actorId = await world.registerAndVerify(actorEmail, 'Ada', PLAINTEXT);

    const pendingEmail = 'pending@example.test';
    const pending = await world.registerOnly(pendingEmail, 'Pending', PLAINTEXT);

    const suspendedEmail = 'suspended@example.test';
    const suspendedId = await world.registerAndVerify(suspendedEmail, 'Suspended', PLAINTEXT);
    world.patchUser(suspendedId, { status: UserStatus.SUSPENDED });

    // Registered and deliberately never verified, so that two reasons apply to
    // one attempt and the precedence rule is actually under test.
    const blockedUnverifiedEmail = 'blocked@example.test';
    const blocked = await world.registerOnly(blockedUnverifiedEmail, 'Blocked', PLAINTEXT);
    world.patchUser(blocked.userId, { status: UserStatus.SUSPENDED });

    const deletedEmail = 'gone@example.test';
    const deletedId = await world.registerAndVerify(deletedEmail, 'Gone', PLAINTEXT);
    world.patchUser(deletedId, { deletedAt: new Date() });

    // Issued through the real `requestPasswordReset`, and read out of the mail
    // it sent — the same path a person's credential travels. Asked for last, so
    // that the soft delete above is already in place and this is unambiguously
    // the actor's.
    await world.auth.requestPasswordReset(actorEmail);
    const actorReset = world.credentialFromLastLink();

    return {
      service: world.auth,

      actorId,
      actorEmail,
      actorSecret: PLAINTEXT,
      actorReset,

      pendingUserId: pending.userId,
      pendingEmail,
      pendingSecret: PLAINTEXT,

      suspendedEmail,
      suspendedSecret: PLAINTEXT,

      blockedUnverifiedEmail,
      blockedUnverifiedSecret: PLAINTEXT,

      deletedEmail,
      deletedSecret: PLAINTEXT,

      unknownEmail: 'nobody@example.test',
      replacementSecret: REPLACEMENT_PLAINTEXT,
    };
  },
});
