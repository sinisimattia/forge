import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { OptionalJwtAuthGuard } from '../../../auth/guards';
import {
  WEBAUTHN,
  currentCodeFor,
  previousStepCodeFor,
  makeMfaWorld,
  type MfaWorld,
  type SeededAccount,
  type SeededMfaUser,
} from '../../../common/testing';
import { AuditEntryRecord } from '../../../audit/audit-entry-record.entity';
import { hashOpaqueToken } from '../../../common/crypto';
import { MfaChallengeRecord } from '../../entities/mfa-challenge-record.entity';
import { MfaMethodRecord } from '../../entities/mfa-method-record.entity';
import { MfaChallengePurpose } from '../../enums/MfaChallengePurpose';
import { MAX_MFA_METHODS } from '../../mfa-limits';
import { RECOVERY_CODE_COUNT } from '../../recovery/recovery-codes';

/**
 * The library's two verifiers, replaced. Everything else in the package —
 * `generateRegistrationOptions` and `generateAuthenticationOptions`, and so the
 * nonce this backend stores and checks against — is the real thing.
 *
 * See the suite's own TSDoc for why this is the honest arrangement rather than
 * a shortcut, and for the list of what it therefore does and does not prove.
 */
jest.mock('@simplewebauthn/server', () => ({
  ...jest.requireActual('@simplewebauthn/server'),
  verifyRegistrationResponse: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

const registrationVerifier = verifyRegistrationResponse as unknown as jest.Mock;
const authenticationVerifier = verifyAuthenticationResponse as unknown as jest.Mock;

/**
 * A credential id shaped the way a real one is — base64url, no padding —
 * because `generateRegistrationOptions` puts these into `excludeCredentials`
 * and `generateAuthenticationOptions` into `allowCredentials`, and both are
 * declared as `Base64URLString`.
 */
const CREDENTIAL_ID = 'Q3JlZGVudGlhbE9uZQ';

/** A second one, for the cross-account case. */
const OTHER_CREDENTIAL_ID = 'Q3JlZGVudGlhbFR3bw';

/**
 * A signing key no world in this file is built with.
 *
 * Hoisted out of the `JwtService` call rather than written inline, for the
 * reason `mfa-world.ts` gives for `FIRST_FACTOR`: a quoted literal sitting
 * against a key named `secret` is indistinguishable from a real credential to
 * a text-based secret scan, whatever the string says about itself.
 */
const FOREIGN_SIGNING_KEY = 'a-key-no-world-here-signs-with';

/** Stand-in key material. Not a key: nothing in this suite verifies a signature with it. */
const PUBLIC_KEY_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

/** The same bytes as the column stores them — base64url, which is what the service writes. */
const PUBLIC_KEY_STORED = Buffer.from(PUBLIC_KEY_BYTES).toString('base64url');

/**
 * Every property an `mfa_methods` row may carry. The `and no more` half of
 * `stores the credential id, public key and counter, and no more` compares
 * against this, and `FakeDataSource` stores whatever it is handed (its item 5),
 * so a service that also wrote the attestation's AAGUID, transports, device
 * type or backup flag would show up here as an extra key.
 */
const METHOD_COLUMNS = [
  'confirmedAt',
  'createdAt',
  'id',
  'label',
  'lastUsedAt',
  'totpLastStep',
  'totpSecret',
  'type',
  'userId',
  'webauthnCounter',
  'webauthnCredentialId',
  'webauthnPublicKey',
];

/**
 * # WebAuthn: two endpoints, two ceremonies, one rule about which is which
 *
 * `POST /mfa/webauthn/options` and `POST /mfa/webauthn/verify` each serve an
 * enrollment and a login, which is the shape that produced this backend's worst
 * defect — a single endpoint dispatching two purposes, where everything that
 * was not the one tested-for value fell through to the sign-in branch.
 * `webAuthnCallerOf` is the answer to that and this file is what holds it:
 * **the ceremony is fixed by which credential the request carried**, a session
 * or a challenge token, and a request carrying both is refused rather than
 * resolved.
 *
 * ## What this suite proves, and what it cannot
 *
 * **The ceremony itself is not verified here, and no test below claims it is.**
 * An attestation and an assertion are judged by `@simplewebauthn/server`
 * against a public key and a signature, and the other half of a ceremony —
 * `navigator.credentials.create()` and `.get()`, inside a browser, talking to
 * hardware — is not reachable from a jest process at all. The two verifiers are
 * therefore mocked, and a test here that appeared to show "a forged assertion
 * is rejected" would be showing it about the mock. That evidence is the
 * library's own suite's, and the end-to-end evidence is a person with a
 * security key.
 *
 * What this template owns is everything around the ceremony, and that is what
 * is covered:
 *
 * 1. **The purpose is fixed by the credential.** `treats a challenge-token
 *    caller as a login, never an enrollment` and `refuses a request carrying
 *    both a session and a challenge token`.
 * 2. **The challenge is single-use.** `spends the login challenge the options
 *    were fetched with` and `refuses a second presentation of the challenge a
 *    sign-in was completed with`.
 * 3. **The credential is registered once.** `refuses a credential id already
 *    registered to any account` — with the caveat below.
 * 4. **Only the three columns an assertion needs are stored.**
 *
 * ## What `FakeDataSource` cannot see
 *
 * Read the numbered list on the class rather than this summary. Two items bear
 * on this file:
 *
 * - **Unique constraints (item 4). There are none, anywhere.** So
 *   `refuses a credential id already registered to any account` passes because
 *   `WebAuthnCeremonies` looks the credential up and refuses it, and **not**
 *   because `uq_mfa_methods_webauthn_credential` exists. A test asserting the
 *   uniqueness *property* here would pass for the wrong reason; the real check
 *   is the constraint, it covers the concurrent case this one cannot, and only
 *   a database can show it. `auth/oauth/__tests__/oauth.service.begin.spec.ts`
 *   writes the same caveat about `uq_oauth_authorization_requests_state`.
 * - **No blocking between transactions (items 1 and 2).** Nothing here runs two
 *   presentations of one challenge at once, so the single-use tests below assert
 *   the sequential refusal only. That the row is read under
 *   `pessimistic_write` is `mfa-challenge.service.spec.ts`'s subject.
 */
describe('WebAuthn ceremonies', () => {
  let world: MfaWorld;

  beforeEach(async () => {
    world = await makeMfaWorld();
    // Refusing by default. A verifier left over from a previous test, or one
    // whose `mockResolvedValue` a new test forgets, must not be the reason a
    // ceremony completes.
    registrationVerifier.mockReset().mockResolvedValue({ verified: false });
    authenticationVerifier.mockReset().mockResolvedValue({ verified: false });
  });

  afterEach(async () => {
    await world.close();
  });

  /** Signs in with the first factor alone; only valid for an account with no confirmed method. */
  async function accessTokenOf(account: SeededAccount): Promise<string> {
    const login = await request(world.app.getHttpServer())
      .post('/auth/login')
      .send({ email: account.email, secret: account.secret })
      .expect(200);
    return login.body.accessToken as string;
  }

  /**
   * Signs in as far as the password takes an account that holds a confirmed
   * method, and hands back the challenge that finishes it.
   */
  async function challengeTokenOf(account: SeededAccount): Promise<string> {
    const login = await request(world.app.getHttpServer())
      .post('/auth/login')
      .send({ email: account.email, secret: account.secret })
      .expect(200);
    expect(login.body.accessToken).toBeUndefined();
    return login.body.challengeToken as string;
  }

  /**
   * Writes a confirmed passkey straight into the store.
   *
   * A row, not a drive through the enrollment endpoint: a test of *login* that
   * enrolled first would stop being able to fail for a reason of its own the
   * day enrollment broke — the reasoning `MfaWorld.seedUserWithConfirmedTotp`
   * already gives.
   */
  function seedPasskey(userId: UserId, credentialId: string): string {
    const now = new Date();
    const inserted = world.source.insert(MfaMethodRecord, {
      // A real UUID: `mfa_methods.id` is a `uuid` column and the store's own
      // synthetic ids are not.
      id: randomUUID(),
      userId,
      type: MfaMethodType.WEBAUTHN,
      label: 'Security key',
      totpSecret: null,
      totpLastStep: null,
      webauthnCredentialId: credentialId,
      webauthnPublicKey: PUBLIC_KEY_STORED,
      webauthnCounter: '0',
      confirmedAt: now,
      lastUsedAt: null,
      createdAt: now,
    });
    return inserted.identifiers[0].id;
  }

  /** Every challenge row this account holds, whatever its purpose or state. */
  const challengesOf = (userId: UserId): MfaChallengeRecord[] =>
    world.source.all(MfaChallengeRecord)
      .filter((row) => row.userId === userId) as unknown as MfaChallengeRecord[];

  /** Every method row this account holds. */
  const methodsOf = (userId: UserId): MfaMethodRecord[] =>
    world.source.all(MfaMethodRecord)
      .filter((row) => row.userId === userId) as unknown as MfaMethodRecord[];

  const options = (): request.Test =>
    request(world.app.getHttpServer()).post('/mfa/webauthn/options');

  const verify = (): request.Test =>
    request(world.app.getHttpServer()).post('/mfa/webauthn/verify');

  const bearer = (token: string): string => `Bearer ${token}`;

  describe('which ceremony a request is', () => {
    it('mints a WEBAUTHN_ENROLLMENT challenge for a session-authenticated caller', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);

      const answered = await options()
        .set('Authorization', bearer(token))
        .send({})
        .expect(200);

      const rows = challengesOf(account.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0].purpose).toBe(MfaChallengePurpose.WEBAUTHN_ENROLLMENT);

      // The nonce rides on that row, and it is the one the browser is about to
      // be given — not a second value kept somewhere else.
      expect(rows[0].webauthnChallenge).toBe(answered.body.publicKey.challenge);
      expect(answered.body.publicKey.rp).toEqual({ id: WEBAUTHN.rpId, name: WEBAUTHN.rpName });

      // And no token came back. An enrollment's second leg carries the session
      // again; a token here would be a credential its holder could never
      // present, since a request carrying both is refused.
      expect(answered.body.challengeToken).toBeNull();
    });

    it('treats a challenge-token caller as a login, never an enrollment', async () => {
      const account = await world.seedUserWithoutMfa();
      seedPasskey(account.userId, CREDENTIAL_ID);

      const first = await challengeTokenOf(account);
      const answered = await options().send({ challengeToken: first }).expect(200);

      // An assertion ceremony, for this account's own credential, and a fresh
      // token to finish it with.
      expect(answered.body.publicKey.allowCredentials)
        .toEqual([{ id: CREDENTIAL_ID, type: 'public-key' }]);
      expect(answered.body.challengeToken).toEqual(expect.any(String));
      expect(answered.body.challengeToken).not.toBe(first);

      // The same call again, now with a body field claiming to be an
      // enrollment. **Today the validation pipe refuses the unknown field
      // before the handler sees it** (`forbidNonWhitelisted`), so the status
      // here is deliberately not asserted: this request is not about the answer
      // it gets, it is about what it must not be able to cause. The assertion
      // that follows holds either way and is what turns red the day a `purpose`
      // field is declared and read.
      const second = await challengeTokenOf(account);
      await options().send({ challengeToken: second, purpose: 'WEBAUTHN_ENROLLMENT' });

      // Nothing this account holds was ever minted as an enrollment, and no
      // method was created. A challenge-token caller is a login, whatever the
      // body says.
      expect(challengesOf(account.userId).map((row) => row.purpose))
        .toEqual(challengesOf(account.userId).map(() => MfaChallengePurpose.LOGIN));
      expect(methodsOf(account.userId).map((row) => row.webauthnCredentialId))
        .toEqual([CREDENTIAL_ID]);
    });

    it('refuses a request carrying both a session and a challenge token', async () => {
      const enroller = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(enroller);

      const signingIn = await world.seedUserWithoutMfa();
      seedPasskey(signingIn.userId, CREDENTIAL_ID);
      const challengeToken = await challengeTokenOf(signingIn);

      const before = challengesOf(signingIn.userId).length;

      await options()
        .set('Authorization', bearer(token))
        .send({ challengeToken })
        .expect(400);

      await verify()
        .set('Authorization', bearer(token))
        .send({ challengeToken, response: { id: CREDENTIAL_ID }, label: 'Key' })
        .expect(400);

      // Refused outright: nothing was minted, nothing was spent, nothing was
      // enrolled. A refusal that had already consumed the challenge would be a
      // way to burn somebody else's pending sign-in.
      expect(challengesOf(signingIn.userId)).toHaveLength(before);
      expect(challengesOf(signingIn.userId).every((row) => row.consumedAt === null)).toBe(true);
      expect(methodsOf(enroller.userId)).toHaveLength(0);
    });

    it('refuses a request carrying neither a session nor a challenge token', async () => {
      await options().send({}).expect(400);
      await verify().send({ response: { id: CREDENTIAL_ID }, label: 'Key' }).expect(400);
    });

    it('refuses a LOGIN-purpose challenge presented to the enrollment path', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);

      // The account has a sign-in in flight on another device: one pending
      // LOGIN challenge, and no enrollment challenge at all. Minted through the
      // real service, so the row is the one a sign-in would have written.
      await world.challenges.mint(account.userId, MfaChallengePurpose.LOGIN, 'a-login-nonce');

      const pending = challengesOf(account.userId);
      expect(pending).toHaveLength(1);
      expect(pending[0].purpose).toBe(MfaChallengePurpose.LOGIN);

      // The enrollment's second leg looks for *this account's* pending
      // enrollment challenge. A LOGIN row is not one, so there is nothing to
      // spend and nothing to register — even with a verifier that would have
      // said yes.
      //
      // **What refuses it is the query, not the dispatch.**
      // `consumePendingFor` puts `purpose: expected` into the `where`, so a
      // LOGIN row never reaches `consumeRow`'s allowlist or its
      // `found.purpose !== expected` comparison; this test would still pass
      // with both of those deleted. That is the point of the criterion, and
      // the two checks behind it are the redundancy that survives its removal
      // — `mfa-challenge.service.spec.ts` is what exercises them, through
      // `consume`, where the token selects a row of any purpose.
      registrationVerifier.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: CREDENTIAL_ID, publicKey: PUBLIC_KEY_BYTES, counter: 0 },
        },
      });

      await verify()
        .set('Authorization', bearer(token))
        .send({ response: { id: CREDENTIAL_ID }, label: 'A key' })
        .expect(422);

      expect(methodsOf(account.userId)).toHaveLength(0);

      // And the login challenge is untouched: a refused enrollment must not
      // cost the person the sign-in they had in flight.
      const after = challengesOf(account.userId);
      expect(after).toHaveLength(1);
      expect(after[0].consumedAt).toBeNull();
      expect(after[0].tokenHash).toBe(pending[0].tokenHash);
    });
  });

  /** Every audit entry of one action, oldest first. */
  const auditOf = (action: AuditAction): AuditEntryRecord[] =>
    (world.source.all(AuditEntryRecord) as unknown as AuditEntryRecord[])
      .filter((row) => row.action === action);

  describe('enrollment', () => {
    it('stores the credential id, public key and counter, and no more', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);

      await options().set('Authorization', bearer(token)).send({}).expect(200);

      registrationVerifier.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: CREDENTIAL_ID, publicKey: PUBLIC_KEY_BYTES, counter: 7 },
          // Everything the attestation also carries, and none of which this
          // template stores. Present here so that a service which started
          // writing one would be caught by the column comparison below.
          aaguid: '00000000-0000-0000-0000-000000000000',
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
          fmt: 'none',
        },
      });

      const answered = await verify()
        .set('Authorization', bearer(token))
        .send({ response: { id: CREDENTIAL_ID }, label: '  Yubikey  ' })
        .expect(200);

      const rows = methodsOf(account.userId);
      expect(rows).toHaveLength(1);
      const [row] = rows;

      expect(row.webauthnCredentialId).toBe(CREDENTIAL_ID);
      expect(row.webauthnPublicKey).toBe(PUBLIC_KEY_STORED);
      // `bigint`, which the Postgres driver hands back as a string — read
      // through `Number` so the assertion holds for either representation.
      expect(Number(row.webauthnCounter)).toBe(7);

      // Confirmed on the spot: the attestation is the proof a TOTP enrollment
      // needs a second round-trip for, and an unconfirmed WEBAUTHN row is one
      // `mapMfaMethodRecord` refuses on sight.
      expect(row.confirmedAt).toBeInstanceOf(Date);
      expect(row.totpSecret).toBeNull();
      expect(row.totpLastStep).toBeNull();
      expect(row.label).toBe('Yubikey');

      // And no more.
      expect(Object.keys(row).sort()).toEqual(METHOD_COLUMNS);

      // The account's first confirmed method, so its first batch of codes —
      // a passkey-only account with no way back in from a lost device is the
      // state `MfaService.confirmTotpEnrollment` calls the worst this feature
      // can produce.
      expect(answered.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
      expect(answered.body.method.type).toBe(MfaMethodType.WEBAUTHN);
      expect(answered.body.method.id).toBe(row.id);

      // Recorded against the account that enrolled, naming the method and never
      // the key material, and saying that this was the account's first factor.
      const [entry, ...rest] = auditOf(AuditAction.MFA_METHOD_ADDED);
      expect(rest).toHaveLength(0);
      expect(entry.actorUserId).toBe(account.userId);
      expect(entry.resourceId).toBe(row.id);
      expect(entry.metadata).toEqual({
        methodType: MfaMethodType.WEBAUTHN,
        recoveryCodesIssued: true,
      });
      expect(JSON.stringify(entry)).not.toContain(PUBLIC_KEY_STORED);
    });

    it('refuses a credential id already registered to any account', async () => {
      const owner = await world.seedUserWithoutMfa();
      seedPasskey(owner.userId, CREDENTIAL_ID);

      const other = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(other);

      await options().set('Authorization', bearer(token)).send({}).expect(200);

      registrationVerifier.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: CREDENTIAL_ID, publicKey: PUBLIC_KEY_BYTES, counter: 0 },
        },
      });

      await verify()
        .set('Authorization', bearer(token))
        .send({ response: { id: CREDENTIAL_ID }, label: 'Same key' })
        .expect(409);

      expect(methodsOf(other.userId)).toHaveLength(0);
      expect(methodsOf(owner.userId)).toHaveLength(1);
    });

    describe('when the unique index refuses the insert after the pre-write check passed', () => {
      /**
       * An error shaped like the `pg` driver's. `FakeDataSource` has no unique
       * constraints, so the violation is simulated rather than raced: the
       * lookup finds nothing, and only the write refuses.
       */
      const violation = (constraint: string): Error => Object.assign(
        new Error('duplicate key value violates unique constraint'),
        { code: '23505', constraint },
      );

      /** Makes the passkey's own insert reject with `error`; every other insert is the fake's. */
      const refuseMethodInsert = (error: Error): jest.SpyInstance => {
        const real = world.source.insert.bind(world.source);
        return jest.spyOn(world.source, 'insert').mockImplementation(
          (entity, values, journal) => {
            if (entity === MfaMethodRecord) throw error;
            return real(entity, values, journal);
          },
        );
      };

      const enrolling = async (): Promise<{ userId: UserId; token: string }> => {
        const account = await world.seedUserWithoutMfa();
        const token = await accessTokenOf(account);
        await options().set('Authorization', bearer(token)).send({}).expect(200);
        registrationVerifier.mockResolvedValue({
          verified: true,
          registrationInfo: {
            credential: { id: CREDENTIAL_ID, publicKey: PUBLIC_KEY_BYTES, counter: 0 },
          },
        });
        return { userId: account.userId, token };
      };

      it('answers 409, the status the pre-write check answers, and registers nothing', async () => {
        const { userId, token } = await enrolling();
        refuseMethodInsert(violation('uq_mfa_methods_webauthn_credential'));

        await verify()
          .set('Authorization', bearer(token))
          .send({ response: { id: CREDENTIAL_ID }, label: 'Raced key' })
          .expect(409);

        expect(methodsOf(userId)).toHaveLength(0);
        expect(auditOf(AuditAction.MFA_METHOD_ADDED)).toHaveLength(0);
      });

      it('does not swallow a unique violation on any other constraint', async () => {
        const { token } = await enrolling();
        refuseMethodInsert(violation('uq_some_other_constraint'));

        await verify()
          .set('Authorization', bearer(token))
          .send({ response: { id: CREDENTIAL_ID }, label: 'Other' })
          .expect(500);
      });
    });

    it('never issues a session, however the enrollment ends', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      const before = world.sessionCount();

      await options().set('Authorization', bearer(token)).send({}).expect(200);

      registrationVerifier.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: CREDENTIAL_ID, publicKey: PUBLIC_KEY_BYTES, counter: 0 },
        },
      });

      await verify()
        .set('Authorization', bearer(token))
        .send({ response: { id: CREDENTIAL_ID }, label: 'Key' })
        .expect(200);

      expect(world.sessionCount()).toBe(before);
    });

    it('refuses an attestation the library does not verify, and registers nothing', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);

      await options().set('Authorization', bearer(token)).send({}).expect(200);

      await verify()
        .set('Authorization', bearer(token))
        .send({ response: { id: CREDENTIAL_ID }, label: 'Key' })
        .expect(422);

      expect(methodsOf(account.userId)).toHaveLength(0);

      // The challenge was spent on the way — the price a failed proof pays
      // everywhere else in this module — so the same request cannot be retried
      // against the same nonce.
      const rows = challengesOf(account.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0].consumedAt).toBeInstanceOf(Date);
    });
  });

  describe('enrollment, for an account that already has a second factor', () => {
    /** A full two-phase sign-in, leaving the current step's code unspent for a proof. */
    async function signIn(user: SeededMfaUser): Promise<string> {
      const login = await request(world.app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, secret: user.secret })
        .expect(200);
      const verified = await request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({
          challengeToken: login.body.challengeToken,
          methodId: user.methodId,
          code: await previousStepCodeFor(user.totpSecret),
        })
        .expect(200);
      return verified.body.accessToken as string;
    }

    const attestationVerifies = (): void => {
      registrationVerifier.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: CREDENTIAL_ID, publicKey: PUBLIC_KEY_BYTES, counter: 0 },
        },
      });
    };

    const ownerProof = (user: SeededMfaUser): object => ({
      methodId: user.methodId,
      code: currentCodeFor(user.totpSecret),
    });

    it('refuses a passkey without a proof, registers nothing, and keeps the challenge for a retry', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      await options().set('Authorization', bearer(token)).send({}).expect(200);
      attestationVerifies();

      const refused = await verify()
        .set('Authorization', bearer(token))
        .send({ response: { id: CREDENTIAL_ID }, label: 'Attacker key' })
        .expect(403);

      expect(refused.body.code).toBe('MFA_REAUTHENTICATION_REQUIRED');
      expect(methodsOf(user.userId)).toHaveLength(1);
      expect(auditOf(AuditAction.MFA_METHOD_ADDED)).toHaveLength(0);
      // Refused before the ceremony was spent, so the person is not made to
      // start the ceremony again to supply what was missing.
      const [challenge] = challengesOf(user.userId)
        .filter((row) => row.purpose === MfaChallengePurpose.WEBAUTHN_ENROLLMENT);
      expect(challenge.consumedAt).toBeNull();
    });

    it('registers a passkey when a proof from the existing factor accompanies it, issuing no new codes', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      await options().set('Authorization', bearer(token)).send({}).expect(200);
      attestationVerifies();

      const answered = await verify()
        .set('Authorization', bearer(token))
        .send({
          response: { id: CREDENTIAL_ID },
          label: 'Second key',
          proof: ownerProof(user),
        })
        .expect(200);

      expect(answered.body.recoveryCodes).toBeNull();
      expect(methodsOf(user.userId)).toHaveLength(2);
    });

    it('refuses a proof that does not verify, and registers nothing', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      await options().set('Authorization', bearer(token)).send({}).expect(200);
      attestationVerifies();

      const refused = await verify()
        .set('Authorization', bearer(token))
        .send({
          response: { id: CREDENTIAL_ID },
          label: 'Second key',
          proof: { recoveryCode: 'not-a-code' },
        })
        .expect(422);

      expect(refused.body.code).toBe('MFA_VERIFICATION_FAILED');
      expect(methodsOf(user.userId)).toHaveLength(1);
    });

    it('does not spend the proof on an attestation that does not verify', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      const proof = ownerProof(user);

      await options().set('Authorization', bearer(token)).send({}).expect(200);
      // The library refuses (the default in this file), with a proof attached.
      await verify()
        .set('Authorization', bearer(token))
        .send({ response: { id: CREDENTIAL_ID }, label: 'Second key', proof })
        .expect(422);

      // The very same proof is still good for a ceremony that does verify.
      await options().set('Authorization', bearer(token)).send({}).expect(200);
      attestationVerifies();
      await verify()
        .set('Authorization', bearer(token))
        .send({ response: { id: CREDENTIAL_ID }, label: 'Second key', proof })
        .expect(200);

      expect(methodsOf(user.userId)).toHaveLength(2);
    });

    it('lets a passkey be the first factor with no proof, and gives it the recovery codes', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      await options().set('Authorization', bearer(token)).send({}).expect(200);
      attestationVerifies();

      const answered = await verify()
        .set('Authorization', bearer(token))
        .send({ response: { id: CREDENTIAL_ID }, label: 'First key' })
        .expect(200);

      expect(answered.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    });

    it('decides again under the lock: a factor confirmed since the first look is one that is owed a proof', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      await options().set('Authorization', bearer(token)).send({}).expect(200);
      // The attestation is verified between the first look at the account's
      // methods and the transaction. A factor confirmed in that gap — by the
      // other way in, or by a second tab — is what the first look could not see.
      registrationVerifier.mockImplementation(async () => {
        seedPasskey(account.userId, OTHER_CREDENTIAL_ID);
        return {
          verified: true,
          registrationInfo: {
            credential: { id: CREDENTIAL_ID, publicKey: PUBLIC_KEY_BYTES, counter: 0 },
          },
        };
      });

      const refused = await verify()
        .set('Authorization', bearer(token))
        .send({ response: { id: CREDENTIAL_ID }, label: 'Late' })
        .expect(403);

      expect(refused.body.code).toBe('MFA_REAUTHENTICATION_REQUIRED');
      expect(methodsOf(account.userId)).toHaveLength(1);
      expect(auditOf(AuditAction.MFA_METHOD_ADDED)).toHaveLength(0);
    });

    it('does not let a passkey and a TOTP method both be admitted as an account\'s first factor', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);

      const offered = await request(world.app.getHttpServer())
        .post('/mfa/totp/enroll')
        .set('Authorization', bearer(token))
        .send({ label: 'Phone' })
        .expect(201);
      await options().set('Authorization', bearer(token)).send({}).expect(200);
      attestationVerifies();

      // Both are owed nothing when they start, because the account holds no
      // confirmed method; only the decision re-made inside the transaction sees
      // the other one land.
      const [passkey, totp] = await Promise.all([
        verify()
          .set('Authorization', bearer(token))
          .send({ response: { id: CREDENTIAL_ID }, label: 'Key' }),
        request(world.app.getHttpServer())
          .post('/mfa/totp/confirm')
          .set('Authorization', bearer(token))
          .send({
            methodId: offered.body.methodId,
            code: currentCodeFor(offered.body.secret as string),
          }),
      ]);

      expect([passkey.status, totp.status].sort()).toEqual([200, 403]);
      const confirmed = methodsOf(account.userId).filter((row) => row.confirmedAt !== null);
      expect(confirmed).toHaveLength(1);
    });
  });

  describe('enrollment, at the most methods an account may hold', () => {
    async function signIn(user: SeededMfaUser): Promise<string> {
      const login = await request(world.app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, secret: user.secret })
        .expect(200);
      const verified = await request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({
          challengeToken: login.body.challengeToken,
          methodId: user.methodId,
          code: await previousStepCodeFor(user.totpSecret),
        })
        .expect(200);
      return verified.body.accessToken as string;
    }

    /** Begins unconfirmed TOTP enrollments until the account holds `total` rows. */
    async function fillTo(user: SeededMfaUser, total: number): Promise<void> {
      while (methodsOf(user.userId).length < total) {
        await world.mfa.beginTotpEnrollment(user.userId, 'Abandoned');
      }
    }

    const attestationVerifies = (): void => {
      registrationVerifier.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: CREDENTIAL_ID, publicKey: PUBLIC_KEY_BYTES, counter: 0 },
        },
      });
    };

    const proofOf = (user: SeededMfaUser): object => ({
      methodId: user.methodId,
      code: currentCodeFor(user.totpSecret),
    });

    it('refuses to start a ceremony for an account that holds the most it may', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      await fillTo(user, MAX_MFA_METHODS);

      const refused = await options().set('Authorization', bearer(token)).send({}).expect(409);

      expect(refused.body.code).toBe('MFA_TOO_MANY_METHODS');
      expect(challengesOf(user.userId).filter(
        (row) => row.purpose === MfaChallengePurpose.WEBAUTHN_ENROLLMENT,
      )).toHaveLength(0);
    });

    it('refuses to register the passkey that would be one too many, and writes nothing', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      await fillTo(user, MAX_MFA_METHODS - 1);
      await options().set('Authorization', bearer(token)).send({}).expect(200);
      // Another enrollment, begun between the options and the attestation.
      await fillTo(user, MAX_MFA_METHODS);
      attestationVerifies();

      const refused = await verify()
        .set('Authorization', bearer(token))
        .send({ response: { id: CREDENTIAL_ID }, label: 'One too many', proof: proofOf(user) })
        .expect(409);

      expect(refused.body.code).toBe('MFA_TOO_MANY_METHODS');
      expect(methodsOf(user.userId)).toHaveLength(MAX_MFA_METHODS);
      expect(auditOf(AuditAction.MFA_METHOD_ADDED)).toHaveLength(0);
    });

    it('still registers a passkey one short of the bound', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      await fillTo(user, MAX_MFA_METHODS - 1);
      await options().set('Authorization', bearer(token)).send({}).expect(200);
      attestationVerifies();

      await verify()
        .set('Authorization', bearer(token))
        .send({ response: { id: CREDENTIAL_ID }, label: 'Last one', proof: proofOf(user) })
        .expect(200);

      expect(methodsOf(user.userId)).toHaveLength(MAX_MFA_METHODS);
    });
  });

  describe('login', () => {
    /** Drives a whole passkey sign-in and returns the final response. */
    async function signInWithPasskey(account: SeededAccount): Promise<request.Response> {
      const challengeToken = await challengeTokenOf(account);
      const offered = await options().send({ challengeToken }).expect(200);

      authenticationVerifier.mockResolvedValue({
        verified: true,
        authenticationInfo: {
          credentialID: CREDENTIAL_ID,
          newCounter: 4,
          userVerified: true,
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
          origin: WEBAUTHN.origin,
          rpID: WEBAUTHN.rpId,
        },
      });

      return verify().send({
        challengeToken: offered.body.challengeToken,
        response: { id: CREDENTIAL_ID },
      });
    }

    it('opens a session and records the counter the authenticator reported', async () => {
      const account = await world.seedUserWithoutMfa();
      const methodId = seedPasskey(account.userId, CREDENTIAL_ID);
      const before = world.sessionCount();

      const answered = await signInWithPasskey(account);
      expect(answered.status).toBe(200);
      expect(answered.body.accessToken).toEqual(expect.any(String));
      expect(answered.body.user.email).toBe(account.email);
      expect(world.sessionCount()).toBe(before + 1);

      const [method] = methodsOf(account.userId).filter((row) => row.id === methodId);
      expect(Number(method.webauthnCounter)).toBe(4);
      expect(method.lastUsedAt).toBeInstanceOf(Date);

      const [entry, ...rest] = auditOf(AuditAction.MFA_CHALLENGE_SUCCEEDED);
      expect(rest).toHaveLength(0);
      expect(entry.actorUserId).toBe(account.userId);
      expect(entry.metadata).toMatchObject({ methodId, methodType: MfaMethodType.WEBAUTHN });
    });

    it('does not extend the challenge\'s life across ceremonies', async () => {
      const account = await world.seedUserWithoutMfa();
      seedPasskey(account.userId, CREDENTIAL_ID);
      const challengeToken = await challengeTokenOf(account);

      // The login challenge has a minute left, which is deliberately not the
      // default window: a replacement that is given a fresh window cannot land
      // on this value by accident.
      const remaining = new Date(Date.now() + 60_000);
      world.source.update(MfaChallengeRecord, {}, { expiresAt: remaining });

      const offered = await options().send({ challengeToken }).expect(200);
      const replacement = challengesOf(account.userId)
        .find((row) => row.tokenHash === hashOpaqueToken(offered.body.challengeToken as string));
      expect(replacement?.expiresAt.getTime()).toBe(remaining.getTime());

      // And again: the second replacement inherits it from the first.
      const again = await options()
        .send({ challengeToken: offered.body.challengeToken })
        .expect(200);
      const second = challengesOf(account.userId)
        .find((row) => row.tokenHash === hashOpaqueToken(again.body.challengeToken as string));
      expect(second?.expiresAt.getTime()).toBe(remaining.getTime());
    });

    it('spends the login challenge the options were fetched with', async () => {
      const account = await world.seedUserWithoutMfa();
      seedPasskey(account.userId, CREDENTIAL_ID);

      const challengeToken = await challengeTokenOf(account);
      await options().send({ challengeToken }).expect(200);

      // The same token again. It bought one set of options and is spent.
      await options().send({ challengeToken }).expect(401);
    });

    it('refuses a second presentation of the challenge a sign-in was completed with', async () => {
      const account = await world.seedUserWithoutMfa();
      seedPasskey(account.userId, CREDENTIAL_ID);

      const challengeToken = await challengeTokenOf(account);
      const offered = await options().send({ challengeToken }).expect(200);
      const second = offered.body.challengeToken as string;

      authenticationVerifier.mockResolvedValue({
        verified: true,
        authenticationInfo: {
          credentialID: CREDENTIAL_ID,
          newCounter: 4,
          userVerified: true,
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
          origin: WEBAUTHN.origin,
          rpID: WEBAUTHN.rpId,
        },
      });

      await verify().send({ challengeToken: second, response: { id: CREDENTIAL_ID } }).expect(200);
      const after = world.sessionCount();

      await verify().send({ challengeToken: second, response: { id: CREDENTIAL_ID } }).expect(401);
      expect(world.sessionCount()).toBe(after);
    });

    it('refuses a credential the account does not hold, with the same 401 as any other failure', async () => {
      const victim = await world.seedUserWithoutMfa();
      seedPasskey(victim.userId, CREDENTIAL_ID);

      const attacker = await world.seedUserWithoutMfa();
      seedPasskey(attacker.userId, OTHER_CREDENTIAL_ID);

      const challengeToken = await challengeTokenOf(victim);
      const offered = await options().send({ challengeToken }).expect(200);

      authenticationVerifier.mockResolvedValue({
        verified: true,
        authenticationInfo: {
          credentialID: OTHER_CREDENTIAL_ID,
          newCounter: 4,
          userVerified: true,
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
          origin: WEBAUTHN.origin,
          rpID: WEBAUTHN.rpId,
        },
      });

      const before = world.sessionCount();

      // The attacker's own credential, genuinely verifiable, against the
      // victim's challenge. The method lookup is scoped by the account the
      // challenge names, so it answers to nothing.
      await verify()
        .send({
          challengeToken: offered.body.challengeToken,
          response: { id: OTHER_CREDENTIAL_ID },
        })
        .expect(401);

      expect(world.sessionCount()).toBe(before);

      // Recorded against the account whose challenge it was — the victim, the
      // only account established — and not the one whose credential was offered.
      const [entry, ...rest] = auditOf(AuditAction.MFA_CHALLENGE_FAILED);
      expect(rest).toHaveLength(0);
      expect(entry.actorUserId).toBe(victim.userId);
      expect(entry.metadata).toEqual({ reason: 'verification_failed', proof: 'webauthn' });
    });

    it('refuses an account holding no confirmed passkey rather than offering any credential', async () => {
      const account = await world.seedUserWithConfirmedTotp();
      const challengeToken = await challengeTokenOf(account);

      // An empty `allowCredentials` tells a browser "any credential will do",
      // which for a second factor is exactly wrong.
      await options().send({ challengeToken }).expect(401);
    });
  });

  describe('a session credential that does not verify', () => {
    /*
     * `OptionalJwtAuthGuard`'s only two routes are these, so its property is
     * pinned here rather than in a file of its own.
     *
     * The property is one sentence: **a request that carried an
     * `Authorization` header and could not prove it is refused, and is never
     * quietly re-read as a login.** A guard that swallowed a bad credential
     * and continued would hand these routes a request with no actor — which
     * on a two-ceremony endpoint means the *more powerful* branch, chosen by
     * sending something broken.
     *
     * **The rule is enforced by more than one independent mechanism**, and the
     * tests below observe the outcome rather than any of them: the global guard
     * verifies a presented credential first (`@ReadsSession()`, which is what
     * the bad-bearer cases below now mostly pass through), the route's
     * `OptionalJwtAuthGuard` delegates to `AuthGuard('jwt')` whenever a header is
     * present, and `MfaController.callerOf` reads the header's *presence* rather
     * than `request.user`. Because they are independent, weakening any one alone
     * changes none of the answers the other cases here assert. That is the
     * point of the arrangement and also its cost: a weakening is invisible to
     * a test that only reads outcomes.
     *
     * `hands a present Authorization header to the jwt guard rather than waving
     * it through` buys part of it back by pinning the delegation itself, so a
     * guard that stopped calling `AuthGuard('jwt')` reds there and nowhere
     * else. It does not cover every way this guard could be loosened — a
     * `handleRequest` override returning passport's refusal as a user would
     * still delegate, and would still be green here, leaving only
     * `MfaController.callerOf` between that and a login minted from a request
     * carrying a broken session credential.
     */

    /** Two credentials that do not verify: one unparseable, one signed with the wrong key. */
    const badBearers: [string, string][] = [
      ['unparseable', 'not-a-token-at-all'],
      [
        'signed with a key this deployment does not use',
        new JwtService({ secret: FOREIGN_SIGNING_KEY })
          .sign({ sub: randomUUID(), sid: randomUUID() }),
      ],
    ];

    it.each(badBearers)('refuses a bearer that is %s, rather than reading the request as a login', async (_why, credential) => {
      const account = await world.seedUserWithoutMfa();
      seedPasskey(account.userId, CREDENTIAL_ID);

      // `401`, and specifically not the `400` a request carrying no
      // credential gets: the header was there, so this is a refused session
      // and not an absent one. A controller that decided `sessionPresented`
      // from `request.user` would answer `400` here.
      await options()
        .set('Authorization', bearer(credential))
        .send({})
        .expect(401);

      expect(challengesOf(account.userId)).toHaveLength(0);
      expect(world.sessionCount()).toBe(0);
    });

    it('refuses a bad bearer alongside a challenge token, and spends nothing', async () => {
      const account = await world.seedUserWithoutMfa();
      seedPasskey(account.userId, CREDENTIAL_ID);
      const challengeToken = await challengeTokenOf(account);
      const before = world.sessionCount();

      // Two credentials, one of them broken — never a login that got its way
      // by sending a session credential the server could not read.
      //
      // **`401` or `400`, and the test does not care which.** Today it is
      // `401`: the guard refuses the unreadable credential before the handler
      // runs, so `webAuthnCallerOf`'s both-refusal is never reached. Were the
      // order the other way round it would be `400`. Both are refusals, the
      // choice between them is an ordering detail of two layers that each
      // close this on their own, and pinning today's one would make this test
      // fail for a reason that is not the property.
      const offered = await options()
        .set('Authorization', bearer('not-a-token-at-all'))
        .send({ challengeToken });
      expect([400, 401]).toContain(offered.status);

      const finished = await verify()
        .set('Authorization', bearer('not-a-token-at-all'))
        .send({ challengeToken, response: { id: CREDENTIAL_ID } });
      expect([400, 401]).toContain(finished.status);
      expect(finished.body.accessToken).toBeUndefined();

      const rows = challengesOf(account.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0].consumedAt).toBeNull();
      expect(world.sessionCount()).toBe(before);
    });

    it('hands a present Authorization header to the jwt guard rather than waving it through', () => {
      const guard = new OptionalJwtAuthGuard();

      const contextWith = (headers: Record<string, string>): ExecutionContext => ({
        switchToHttp: () => ({
          getRequest: () => ({ get: (name: string) => headers[name.toLowerCase()] }),
        }),
      } as unknown as ExecutionContext);

      // `AuthGuard('jwt')` is a mixin class, so the inherited implementation
      // is an own property of this guard's own prototype chain — which is what
      // `super.canActivate` resolves to, and so what a spy here observes.
      const parent = Object.getPrototypeOf(OptionalJwtAuthGuard.prototype) as {
        canActivate: (context: ExecutionContext) => unknown;
      };
      const delegate = jest.spyOn(parent, 'canActivate').mockReturnValue(true);

      try {
        // No header: served with no actor, and passport never runs.
        expect(guard.canActivate(contextWith({}))).toBe(true);
        expect(delegate).not.toHaveBeenCalled();

        // A header, however bad: the ordinary credential check decides.
        guard.canActivate(contextWith({ authorization: 'Bearer not-a-token-at-all' }));
        expect(delegate).toHaveBeenCalledTimes(1);
      } finally {
        delegate.mockRestore();
      }
    });
  });

  describe('a deployment without WebAuthn', () => {
    it('refuses both routes, on both ceremonies, with a 404', async () => {
      const absent = await makeMfaWorld({ webauthn: null });
      const server = absent.app.getHttpServer();
      try {
        // The enrollment ceremony: a session, no token.
        const enroller = await absent.seedUserWithoutMfa();
        const signedIn = await request(server)
          .post('/auth/login')
          .send({ email: enroller.email, secret: enroller.secret })
          .expect(200);
        const token = signedIn.body.accessToken as string;

        await request(server)
          .post('/mfa/webauthn/options')
          .set('Authorization', `Bearer ${token}`)
          .send({})
          .expect(404);

        await request(server)
          .post('/mfa/webauthn/verify')
          .set('Authorization', `Bearer ${token}`)
          .send({ response: { id: CREDENTIAL_ID }, label: 'Key' })
          .expect(404);

        // The login ceremony: a challenge token, no session. A separate
        // account holding a passkey, so the sign-in really is two-phase and
        // the token is one `POST /auth/login` actually minted.
        //
        // **Both legs, and `404` on each, is the point.** The absence check
        // runs before the challenge is consumed, so this also shows a
        // deployment without WebAuthn cannot be used to burn a pending
        // sign-in — and `404` rather than the `401` every other login refusal
        // gives, because "this deployment has no WebAuthn" says nothing about
        // an account and is the one thing on this path a caller can act on.
        const passkeyOwner = await absent.seedUserWithoutMfa();
        const now = new Date();
        absent.source.insert(MfaMethodRecord, {
          id: randomUUID(),
          userId: passkeyOwner.userId,
          type: MfaMethodType.WEBAUTHN,
          label: 'Security key',
          totpSecret: null,
          totpLastStep: null,
          webauthnCredentialId: CREDENTIAL_ID,
          webauthnPublicKey: PUBLIC_KEY_STORED,
          webauthnCounter: '0',
          confirmedAt: now,
          lastUsedAt: null,
          createdAt: now,
        });

        const halfway = await request(server)
          .post('/auth/login')
          .send({ email: passkeyOwner.email, secret: passkeyOwner.secret })
          .expect(200);
        const challengeToken = halfway.body.challengeToken as string;
        expect(halfway.body.accessToken).toBeUndefined();

        await request(server)
          .post('/mfa/webauthn/options')
          .send({ challengeToken })
          .expect(404);

        await request(server)
          .post('/mfa/webauthn/verify')
          .send({ challengeToken, response: { id: CREDENTIAL_ID } })
          .expect(404);

        // Nothing was spent by either refusal.
        const rows = absent.source.all(MfaChallengeRecord)
          .filter((row) => row.userId === passkeyOwner.userId);
        expect(rows).toHaveLength(1);
        expect(rows[0].consumedAt).toBeNull();
      } finally {
        await absent.close();
      }
    });
  });
});
