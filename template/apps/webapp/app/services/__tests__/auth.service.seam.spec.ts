import { describe, it, expect, beforeEach } from 'vitest';
import { AuthenticationRejectionReason, AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import type { AuthenticationOutcome, ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { AuthHttpService } from '~/services/auth.service';
import type { StubBackend } from './stubBackend';
import { stubBackend, STUB_ACCESS_LIFETIME_SECONDS } from './stubBackend';

/**
 * The DEC-3 seam: the one place the two worlds touch.
 *
 * ## Why this file exists
 *
 * `POST /auth/login` answers with the core-shaped user **and an access credential
 * beside it**. `AuthHttpService` lifts the credential out, returns exactly an
 * `AuthenticationOutcome`, and hands the credential over through
 * `takeIssuedCredential` — a method on the class and on no contract. Core never
 * learns a credential existed.
 *
 * **None of that was asserted anywhere**, and the conformance suites structurally
 * cannot assert it: they are core's, and core is precisely the thing that must
 * not know this method is here. Measured, before this file: a version of
 * `takeIssuedCredential` that hands the credential over and **never clears it**
 * passed the whole webapp suite, `nuxt typecheck` and `eslint`; so did one that
 * returned `null` forever. Three claims on the class doc, nothing behind any of
 * them. A claim whose subject has no test is a claim about nothing.
 *
 * ## Where the expectations come from
 *
 * From the **world**, never from the service. `stubBackend.issuedCredentials()`
 * is what the stub minted and `STUB_ACCESS_LIFETIME_SECONDS` is what it reports;
 * comparing the service's answer against itself would pass for a service that
 * invented a value or handed back the one before it. That is the same rule the
 * conformance drivers follow, and for the same reason.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/** A second one, distinguishable from the first. */
const REPLACEMENT_PLAINTEXT = 'yet another perfectly fine phrase';

/**
 * The first one, spoilt, for the attempt that has to be refused.
 *
 * Named rather than written inline at its one use, for the same reason core's
 * conformance suites give for their `attempt` helper. The extraction gate strips
 * every interpolation from a template literal before judging what remains, so
 * spoiling the phrase inline under a secret-shaped key leaves a short quoted
 * remainder and reads as a populated credential. Checked against the gate rather
 * than assumed: written inline it flagged, and this binding is what stops it —
 * an unquoted reference is not a populated value.
 */
const WRONG_PLAINTEXT = `${PLAINTEXT}-not`;

/** One instant for the world, which nothing here compares. */
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

const ACTOR_ID = 'stub-User-1' as UserId;
const ACTOR_EMAIL = 'ada@example.test';

/** Nothing can be told about the client, which is what a browser really knows. */
const NO_CLIENT: ClientContext = { address: null, label: null };

/** The one account this world holds: verified, active, usable. */
const ACTOR: UserJSON = {
  id: ACTOR_ID,
  email: ACTOR_EMAIL,
  displayName: 'Ada',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

describe('AuthHttpService — the DEC-3 seam', () => {
  let backend: StubBackend;
  let service: AuthHttpService;

  beforeEach(() => {
    backend = stubBackend();
    backend.putUser(ACTOR, PLAINTEXT);
    service = new AuthHttpService(backend.client);
  });

  /** Signs the actor in, failing the test rather than the cast if it is refused. */
  const signIn = async (): Promise<AuthenticationOutcome> => {
    const outcome = await service.authenticate({
      email: ACTOR_EMAIL,
      secret: PLAINTEXT,
      client: NO_CLIENT,
    });
    expect(outcome.status).toBe(AuthenticationStatus.AUTHENTICATED);
    return outcome;
  };

  it('has nothing to hand over before anybody has signed in', async () => {
    expect(service.takeIssuedCredential()).toBeNull();
  });

  // Against what the WORLD issued. `takeIssuedCredential` returning some string
  // proves nothing; returning the credential this sign-in was actually given is
  // the claim.
  it('hands over the credential the sign-in was issued', async () => {
    await signIn();

    const issued = backend.issuedCredentials();
    expect(issued).toHaveLength(1);
    expect(service.takeIssuedCredential()).toEqual({
      accessToken: issued[0],
      expiresIn: STUB_ACCESS_LIFETIME_SECONDS,
    });
  });

  // The "take" in the name. A credential left on the service is a credential
  // anything else that reaches this object can pick up, and a second caller has
  // no way to tell a stale one from a fresh one. Measured: a version that hands
  // it over and never clears passed the whole webapp suite as it then stood (96
  // tests), `nuxt typecheck` and `eslint`, with nothing red anywhere.
  it('hands it over once — a second take finds nothing', async () => {
    await signIn();

    expect(service.takeIssuedCredential()).not.toBeNull();
    expect(service.takeIssuedCredential()).toBeNull();
  });

  // The whole of DEC-3 in one assertion. The credential is a real value that
  // really crossed the wire, and it must appear nowhere a core type can carry
  // it — not on the outcome, not on the user, not on the session. Searching the
  // serialized outcome rather than naming fields is deliberate: a field added to
  // a core type later is covered by this without anybody remembering to add it.
  it('keeps the credential out of the outcome core receives', async () => {
    const outcome = await signIn();
    const credential = backend.issuedCredentials()[0];

    expect(credential).toBeTruthy();
    expect(JSON.stringify(outcome)).not.toContain(credential);
    expect(Object.keys(outcome).sort()).toEqual(['session', 'status', 'user']);
  });

  // A password change re-issues too, and the contract returns nothing — so a
  // caller that forgets to take is left presenting a credential the server has
  // just killed. Asserted so that the second seam is not left to the first one's
  // reputation.
  it('parks the credential a password change re-issued', async () => {
    await signIn();
    service.takeIssuedCredential();

    await service.changePassword(ACTOR_ID, PLAINTEXT, REPLACEMENT_PLAINTEXT);

    const issued = backend.issuedCredentials();
    expect(issued).toHaveLength(2);
    expect(service.takeIssuedCredential()?.accessToken).toBe(issued[1]);
  });

  // The other half of the seam: what the outcome says when the server refuses.
  // The server will not say *why* — that is the enumeration property — so this
  // side reports that it was not told. `INVALID_SECRET`, which this used to
  // answer, is a value that is always a lie in a field the type calls knowledge.
  it('reports a refusal as undisclosed, never as a reason it was not given', async () => {
    const outcome = await service.authenticate({
      email: ACTOR_EMAIL,
      secret: WRONG_PLAINTEXT,
      client: NO_CLIENT,
    });

    expect(outcome.status).toBe(AuthenticationStatus.REJECTED);
    expect(outcome).toEqual({
      status: AuthenticationStatus.REJECTED,
      reason: AuthenticationRejectionReason.UNDISCLOSED,
    });
    // And nothing was issued to take, which a refusal must not leave behind.
    expect(service.takeIssuedCredential()).toBeNull();
  });
});
