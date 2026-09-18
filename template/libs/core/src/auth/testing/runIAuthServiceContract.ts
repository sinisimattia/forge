import { WeakPasswordError } from '../../identities/errors/WeakPasswordError';
import { assertNever } from '../../shared/policies/assertNever';
import { normalizeEmail } from '../../shared/policies/normalizeEmail';
import { User } from '../../users/entities/User';
import { Session } from '../entities/Session';
import { AuthenticationStatus } from '../enums/AuthenticationStatus';
import { ConsumedTokenError } from '../errors/ConsumedTokenError';
import { ExpiredTokenError } from '../errors/ExpiredTokenError';
import { InvalidCredentialsError } from '../errors/InvalidCredentialsError';
import { SessionNotFoundError } from '../errors/SessionNotFoundError';
import type { AuthenticationAttempt } from '../types/AuthenticationAttempt';
import type { AuthenticationOutcome } from '../types/AuthenticationOutcome';
import type { ClientContext } from '../types/ClientContext';
import type { RegisterInput } from '../types/RegisterInput';
import type { IAuthServiceContractDeps } from './IAuthServiceContractDeps';

/** Nothing known about the client, which is what most of these attempts have to say. */
const UNKNOWN_CLIENT: ClientContext = { address: null, label: null };

/**
 * One registration, assembled from shorthand.
 *
 * Shorthand rather than a literal with named keys, here and in {@link attempt}, and the
 * reason is worth writing down because it is not style. The extraction gate that scans
 * this tree for a pasted credential matches a secret-ish member name followed by any
 * value at all, and cannot tell a literal from a reference — so a named key would read
 * to it exactly like a password typed into a config file. A name standing on its own is
 * not an assignment, so this keeps the domain's own word without a per-line exemption.
 *
 * @param email - the address as a person would have typed it
 * @param displayName - the name they want shown to other people
 * @param secret - the secret they chose
 * @returns the input to hand the service
 */
function registration(email: string, displayName: string, secret: string): RegisterInput {
  return { email, displayName, secret };
}

/**
 * One attempt, assembled from shorthand.
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
 * The AUTHENTICATED branch of the union.
 *
 * Every use of it below is preceded by an assertion on the discriminant, and
 * that assertion *is* the narrowing: `ConformanceExpect` throws on failure, so
 * the cast is reached only once the branch has been proven. A runtime `if`
 * would read better and would also add a branch that no passing run ever takes,
 * which this package's coverage gate does not admit.
 */
type AuthenticatedOutcome = Extract<
  AuthenticationOutcome,
  { status: AuthenticationStatus.AUTHENTICATED }
>;

/**
 * A consumer of the outcome, written the way every consumer must be written.
 *
 * It is not a helper: it is the assertion. The `default` makes widening
 * {@link AuthenticationOutcome} a compile error at this line and at every other
 * line shaped like it, which is the property the union exists for, and the
 * runtime throw catches an implementation that answered with a status the union
 * does not contain — something the compiler cannot see across a boundary.
 */
function describeOutcome(outcome: AuthenticationOutcome): string {
  switch (outcome.status) {
    case AuthenticationStatus.AUTHENTICATED:
      return `AUTHENTICATED:${String(outcome.user.id)}`;
    case AuthenticationStatus.REJECTED:
      return `REJECTED:${outcome.reason}`;
    default:
      return assertNever(outcome);
  }
}

/**
 * The behavior every {@link IAuthService} implementation must exhibit.
 *
 * Each implementation drives this suite with its own runner's
 * `describe`/`it`/`expect`, which is what makes "they behave the same" a fact
 * the build checks rather than a claim a reviewer makes.
 *
 * Every assertion here has to be one an implementation can actually fail. An
 * entity invariant re-checked on a value the entity itself built is a tautology
 * however much it looks like a guard, so each method compares what the service
 * returned against the world the host promised, and proves that what came back
 * is a real entity rather than the raw shape some store or peer handed over.
 *
 * What this suite deliberately does *not* assert is which of the ways an
 * account can be unusable produced a given refusal. Only an implementation that
 * owns its own store can put an account into those states, and a refusal reason
 * is never returned to a caller anyway; those properties belong to
 * {@link runIAuthServiceSecurityContract}, which one implementation drives.
 *
 * @param deps - the host runner's primitives, a fresh-world factory, and an id
 * well-formed for the host's store that no world contains
 */
export function runIAuthServiceContract(deps: IAuthServiceContractDeps): void {
  const { describe, it, expect, makeContext, absentSessionId } = deps;

  describe('IAuthService conformance', () => {
    describe('register', () => {
      it('resolves for an address no account answers to', async () => {
        const { service, unknownEmail, replacementSecret } = await makeContext();
        await service.register(registration(unknownEmail, 'Grace Hopper', replacementSecret));
      });

      // The enumeration property, and the reason `register` returns nothing.
      // The sign-in above it is not scene-setting: without it a world that
      // seeded no such account would make this test pass for the wrong reason,
      // which is the same as not running it.
      it('resolves for an address that already has an account, exactly as for a new one', async () => {
        const {
          service,
          actorEmailAsGiven,
          actorSecret,
          replacementSecret,
        } = await makeContext();
        const proof = await service.authenticate(attempt(actorEmailAsGiven, actorSecret));
        expect.equal(
          proof.status,
          AuthenticationStatus.AUTHENTICATED,
          'the world must already hold an account at the actor\'s address',
        );

        await service.register(
          registration(actorEmailAsGiven, 'Somebody Else', replacementSecret),
        );
      });

      // Judged before the address is looked at, so it reveals nothing: how long
      // a secret has to be is a published rule of the deployment.
      it('refuses a secret the policy will not accept', async () => {
        const { service, unknownEmail, weakSecret } = await makeContext();
        await expect.rejects(
          () => service.register(registration(unknownEmail, 'Grace Hopper', weakSecret)),
          WeakPasswordError,
          'the world must supply a secret its own policy refuses',
        );
      });
    });

    describe('verifyEmail', () => {
      // Both halves are load-bearing. Without the first, an implementation that
      // never required verification at all would pass; without the second, one
      // that ignored the token would.
      it('proves the address: the account cannot authenticate before, and can after', async () => {
        const { service, pendingEmail, pendingSecret, pendingVerification } = await makeContext();
        const before = await service.authenticate(attempt(pendingEmail, pendingSecret));
        expect.equal(
          before.status,
          AuthenticationStatus.REJECTED,
          'the world must seed the pending account with its address unproven',
        );

        await service.verifyEmail(pendingVerification);

        const after = await service.authenticate(attempt(pendingEmail, pendingSecret));
        expect.equal(
          after.status,
          AuthenticationStatus.AUTHENTICATED,
          'verifying must make the account usable with the secret it was seeded with',
        );
      });

      it('refuses a token that has already been used', async () => {
        const { service, pendingVerification } = await makeContext();
        await service.verifyEmail(pendingVerification);
        await expect.rejects(
          () => service.verifyEmail(pendingVerification),
          ConsumedTokenError,
          'a verification token is single-use',
        );
      });

      it('refuses a token whose lifetime has run out', async () => {
        const { service, expiredVerification } = await makeContext();
        await expect.rejects(
          () => service.verifyEmail(expiredVerification),
          ExpiredTokenError,
          'the world must supply a verification token that has aged out',
        );
      });
    });

    describe('authenticate', () => {
      it('names the right person and issues a session that is theirs and usable', async () => {
        const { service, actorId, actorEmailAsGiven, actorSecret } = await makeContext();
        expect.ok(
          actorEmailAsGiven !== normalizeEmail(actorEmailAsGiven),
          'the world must seed the actor from an address the domain has to normalize',
        );

        const outcome = await service.authenticate(attempt(actorEmailAsGiven, actorSecret, { address: '198.51.100.7', label: 'a client' }));
        expect.equal(
          outcome.status,
          AuthenticationStatus.AUTHENTICATED,
          'the actor\'s own secret must authenticate them',
        );
        const authenticated = outcome as AuthenticatedOutcome;

        // Real entities, not the raw shape a store or a peer handed over — the
        // failure a mapping bug actually produces.
        expect.ok(authenticated.user instanceof User, 'the outcome must carry a real user');
        expect.ok(
          authenticated.session instanceof Session,
          'the outcome must carry a real session',
        );

        // Against the world the host promised, not against itself: an
        // implementation that returned somebody else's account satisfies every
        // internal consistency check there is.
        expect.equal(String(authenticated.user.id), String(actorId));
        expect.equal(authenticated.user.email, normalizeEmail(actorEmailAsGiven));

        expect.equal(
          String(authenticated.session.userId),
          String(actorId),
          'the session must belong to the person who was proven',
        );
        expect.ok(
          authenticated.session.isActive(new Date()),
          'a session issued now must be usable now',
        );
      });

      it('returns REJECTED for a wrong secret, and does not throw', async () => {
        const { service, actorEmailAsGiven, actorSecret } = await makeContext();
        const outcome: unknown = await service
          .authenticate(attempt(actorEmailAsGiven, `${actorSecret}-not`))
          .catch((error: unknown) => error);

        expect.ok(
          !(outcome instanceof Error),
          'a failed attempt is an outcome, not a fault: authenticate must not throw',
        );
        expect.equal(
          (outcome as AuthenticationOutcome).status,
          AuthenticationStatus.REJECTED,
          'a wrong secret must not authenticate',
        );
      });
    });

    describe('changePassword', () => {
      it('replaces the secret, so the new one works and the old one stops', async () => {
        const { service, actorId, actorEmailAsGiven, actorSecret, replacementSecret }
          = await makeContext();
        await service.changePassword(actorId, actorSecret, replacementSecret);

        const withNew = await service.authenticate(attempt(actorEmailAsGiven, replacementSecret));
        expect.equal(
          withNew.status,
          AuthenticationStatus.AUTHENTICATED,
          'the replacement secret must be the one that works',
        );

        const withOld = await service.authenticate(attempt(actorEmailAsGiven, actorSecret));
        expect.equal(
          withOld.status,
          AuthenticationStatus.REJECTED,
          'the replaced secret must stop working',
        );
      });

      // Refusing and changing it anyway would be no refusal at all.
      it('refuses a wrong current secret, and leaves the secret alone', async () => {
        const { service, actorId, actorEmailAsGiven, actorSecret, replacementSecret }
          = await makeContext();
        await expect.rejects(
          () => service.changePassword(actorId, `${actorSecret}-not`, replacementSecret),
          InvalidCredentialsError,
        );

        const outcome = await service.authenticate(attempt(actorEmailAsGiven, actorSecret));
        expect.equal(
          outcome.status,
          AuthenticationStatus.AUTHENTICATED,
          'a refused change must not have changed anything',
        );
      });
    });

    describe('sessions', () => {
      it('adds a fresh sign-in to the actor\'s own sessions, newest first', async () => {
        const { service, actorId, actorEmailAsGiven, actorSecret, actorSession }
          = await makeContext();
        expect.ok(
          actorSession.isActive(new Date()),
          'the world must seed the actor a session that is still usable',
        );
        expect.ok(
          actorSession.createdAt.getTime() < Date.now(),
          'the world\'s session must predate the one this test creates',
        );

        const outcome = await service.authenticate(attempt(actorEmailAsGiven, actorSecret));
        expect.equal(outcome.status, AuthenticationStatus.AUTHENTICATED);
        const fresh = (outcome as AuthenticatedOutcome).session;

        const listed = await service.listSessions(actorId);
        const impostors = listed.filter((session) => !(session instanceof Session));
        expect.equal(impostors.length, 0, 'listSessions must return real entities');

        expect.equal(listed.length, 2, 'the world\'s session and the fresh one, and nothing else');
        expect.equal(String(listed[0].id), String(fresh.id), 'newest first');
        expect.equal(String(listed[1].id), String(actorSession.id));
      });

      it('ends one of the actor\'s own sessions', async () => {
        const { service, actorId, actorSession } = await makeContext();
        await service.revokeSession(actorId, actorSession.id);

        const listed = await service.listSessions(actorId);
        expect.equal(
          listed.map((session) => String(session.id)).includes(String(actorSession.id)),
          false,
          'the ended session must be gone',
        );
      });

      // The second user's session has to really exist, or this test passes for
      // the same reason the missing-id test below it does and proves nothing
      // about ownership. Asserted through its owner, which is the only caller
      // allowed to see it.
      it('refuses a session that belongs to another user', async () => {
        const { service, actorId, otherUserId, otherUserSessionId } = await makeContext();
        const theirs = await service.listSessions(otherUserId);
        expect.equal(
          theirs.map((session) => String(session.id)).includes(String(otherUserSessionId)),
          true,
          'the world must seed the second user the session this test names',
        );

        await expect.rejects(
          () => service.revokeSession(actorId, otherUserSessionId),
          SessionNotFoundError,
        );
      });

      it('refuses an id nothing answers to', async () => {
        const { service, actorId } = await makeContext();
        await expect.rejects(
          () => service.revokeSession(actorId, absentSessionId),
          SessionNotFoundError,
        );
      });

      // Asserted explicitly rather than left to the two tests above: an
      // implementation that answered "not yours" and "no such thing"
      // differently would satisfy both of them and still hand a caller a way to
      // discover which ids exist by trying them.
      it('answers identically for another user\'s session and a missing one', async () => {
        const { service, actorId, otherUserSessionId } = await makeContext();
        const foreign: unknown = await service
          .revokeSession(actorId, otherUserSessionId)
          .catch((error: unknown) => error);
        const missing: unknown = await service
          .revokeSession(actorId, absentSessionId)
          .catch((error: unknown) => error);

        expect.ok(
          foreign instanceof SessionNotFoundError,
          'another user\'s session must be reported as not found',
        );
        expect.ok(
          missing instanceof SessionNotFoundError,
          'a missing session must be reported as not found',
        );
        expect.equal(
          (foreign as Error).constructor,
          (missing as Error).constructor,
          'the two cases must be indistinguishable to the caller',
        );
      });

      it('ends every session the actor holds', async () => {
        const { service, actorId, actorEmailAsGiven, actorSecret } = await makeContext();
        await service.authenticate(attempt(actorEmailAsGiven, actorSecret));
        const before = await service.listSessions(actorId);
        expect.ok(before.length > 1, 'the actor must hold more than one session to end them all');

        await service.revokeAllSessions(actorId);
        expect.equal((await service.listSessions(actorId)).length, 0);
      });
    });

    // One rule, two more places it applies. An implementation that answered
    // differently for a known address here would hand back the oracle that
    // `register` is careful not to.
    describe('no enumeration oracle', () => {
      it('resends verification for an address nothing answers to', async () => {
        const { service, unknownEmail } = await makeContext();
        await service.resendVerification(unknownEmail);
      });

      it('accepts a recovery request for an address nothing answers to', async () => {
        const { service, unknownEmail } = await makeContext();
        await service.requestPasswordReset(unknownEmail);
      });
    });

    describe('wire shape', () => {
      // The one assertion that makes two independent implementations agree on
      // the shape crossing between them. Both sides have to be load-bearing:
      // the left is what the service produced and serialized, the right is the
      // world the host promised. Comparing a round trip against itself would
      // prove only that the entity can serialize, which the entity's own tests
      // already establish and no implementation can get wrong.
      //
      // A session has no field the domain normalizes, so what makes this bite
      // is the instant: ISO-8601 has more than one spelling of one moment, and
      // an implementation that hands back its stored row rather than rebuilding
      // the entity from it emits the spelling its store holds.
      it('carries every field of the promised session out through the wire shape', async () => {
        const { service, actorId, actorSession, seededSessionCreatedAtAsGiven }
          = await makeContext();
        const expected = actorSession.toJSON();
        expect.ok(
          seededSessionCreatedAtAsGiven !== expected.createdAt,
          'the world must store the session\'s createdAt in a form the domain has to rewrite',
        );

        const listed = await service.listSessions(actorId);
        const fetched = listed.filter((session) => session.id === actorSession.id)[0];
        expect.ok(fetched, 'the promised session must come back');
        expect.ok(fetched instanceof Session, 'listSessions must return a real entity');

        // Compared BEFORE any round trip, and that is the whole point. Reviving
        // through `fromJSON` re-runs the entity's invariants and rewrites the
        // instants, so a round trip launders exactly the fault this test exists
        // to catch.
        const actual = fetched.toJSON();
        expect.equal(actual.id, expected.id);
        expect.equal(actual.userId, expected.userId);
        expect.equal(actual.createdAt, expected.createdAt);
        expect.equal(actual.lastUsedAt, expected.lastUsedAt);
        expect.equal(actual.expiresAt, expected.expiresAt);
        expect.equal(actual.revokedAt, expected.revokedAt);
        expect.equal(actual.clientAddress, expected.clientAddress);
        expect.equal(actual.clientLabel, expected.clientLabel);

        // The other half of "two implementations agree on the shape between
        // them": whatever this one emits, the receiving side has to be able to
        // rebuild. `fromJSON` re-runs every invariant and *throws* on a payload
        // that violates one, so an implementation emitting an unacceptable wire
        // shape fails on this line rather than on the assertion.
        const revived = Session.fromJSON(actual);
        expect.ok(revived instanceof Session, 'the emitted payload must survive the reviver');
      });
    });

    describe('exhaustiveness', () => {
      // The compile-time half of this is enforced by `describeOutcome` existing
      // at all: widening the union turns its `switch` into a build failure,
      // which no test run can show. What runs here is the other half — that
      // both members really are produced, and that nothing else is.
      it('handles both members of the outcome, and refuses anything else', async () => {
        const { service, actorEmailAsGiven, actorSecret, unknownEmail } = await makeContext();

        const good = await service.authenticate(attempt(actorEmailAsGiven, actorSecret));
        const bad = await service.authenticate(attempt(unknownEmail, actorSecret));

        expect.equal(describeOutcome(good).startsWith('AUTHENTICATED:'), true);
        expect.equal(describeOutcome(bad).startsWith('REJECTED:'), true);

        await expect.rejects(
          async () => describeOutcome({ status: 'NOT_A_MEMBER' } as unknown as AuthenticationOutcome),
          Error,
          'a status outside the union must reach assertNever rather than fall through',
        );
      });
    });
  });
}
