import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { generateOpaqueToken, hashOpaqueToken } from '../../common/crypto';
import {
  FEDERATED_ADDRESS,
  REFRESH_COOKIE_NAME,
  currentCodeFor,
  makeMfaWorld,
  type MfaWorld,
  type SeededMfaUser,
} from '../../common/testing';
import { MfaChallengeRecord } from '../../mfa/entities/mfa-challenge-record.entity';
import { MfaRecoveryCodeRecord } from '../../mfa/entities/mfa-recovery-code-record.entity';
import { MfaMethodRecord } from '../../mfa/entities/mfa-method-record.entity';
import { MfaChallengePurpose } from '../../mfa/enums/MfaChallengePurpose';
import { UserRecord } from '../../users/user-record.entity';

/**
 * D10 — "an MFA-enrolled account that submits CORRECT credentials receives a
 * challenge and never a session."
 *
 * ## Why the absence takes three assertions and not one
 *
 * The property is negative, and a negative property is only as strong as the
 * places it looks. The obvious two — no access credential in the body, no
 * renewal cookie in the headers — are both statements about **what the caller
 * was told**, and an implementation that calls `sessions.begin` and then
 * simply declines to mention the result satisfies both of them completely.
 * That implementation has issued a real, usable session row to somebody who
 * has produced one factor of two; the renewal credential is written down, the
 * session appears in `GET /auth/sessions`, and nothing in the response says
 * so.
 *
 * The third assertion — `sessions` gained no row — is the one that sees it,
 * and it is the reason this file exists rather than an assertion or two added
 * to `auth.controller.spec.ts`. It is also the assertion the second fault
 * injection below was watched failing under: letting the `MFA_REQUIRED` branch
 * of `AuthService.signIn` fall through to `sessions.begin` leaves the first
 * two green and turns only this one red.
 *
 * ## The enrolled account is seeded directly, on purpose
 *
 * `seedUserWithConfirmedTotp` writes the `mfa_methods` row rather than driving
 * the enrollment endpoint (`POST /mfa/totp/enroll`), which this file must not
 * come to depend on: a discriminating test that runs through
 * two features fails for either of them, and a failure that could have two
 * causes is a failure nobody can read. The password identity is the one part
 * driven through real code, because `POST /auth/login` really does check an
 * argon2 derivation and a hand-written hash would be one this application
 * never produced.
 *
 * ## Review Focus 2: the cross-user hole
 *
 * `POST /auth/mfa/verify` takes a challenge token and a `methodId`. If it
 * resolves that method by id alone, anybody who can enrol a factor of their
 * own can complete **anybody else's** second one: they hold a working method
 * and a working code for it, and the only thing they need from the victim is
 * a challenge token. The method lookup is therefore scoped by the challenge
 * row's own `userId`, so a method belonging to somebody else is
 * indistinguishable from one that does not exist. The `refuses a methodId
 * belonging to a different user` case below is what fails when that scoping
 * goes — it was watched failing with `userId` dropped from the predicate.
 *
 * ## The boundary owes non-disclosure, and this file is where that is asserted
 *
 * `MfaChallengeService.consume` tells five refusals apart — absent, expired,
 * already consumed, a purpose it does not model, and a purpose that is not the
 * one asked for — and raises a distinct error for each, deliberately: the
 * audit trail needs the distinction and the domain is the right place to make
 * it. Whoever puts that service behind a route owes one answer for all five,
 * exactly as `AuthController.login` has `AuthenticationOutcome.reason` in
 * scope and refuses to read it. `answers every refusal identically` is that
 * obligation, asserted against the response bytes rather than against the
 * route's source. It covers more than the five: a `methodId` that is not a
 * UUID is a sixth way to make this route answer, and the recovery-code
 * causes are seven more — a code never issued, one already spent (which the
 * service names `RecoveryCodeAlreadyConsumedError` and the route must not),
 * one issued to somebody else, a recovery code in the TOTP field, a TOTP code
 * in the recovery field, both fields at once, and neither. The malformed
 * `methodId` cannot fail on this store, for the reason given where it is built.
 *
 * Note what that implies about `common/filters/http-exception.filter.ts`: the
 * three challenge errors are **not** in its `DOMAIN_ERRORS` table. Its nearest
 * neighbours, `ConsumedTokenError` and `ExpiredTokenError`, deliberately carry
 * different `messageKey`s and different `code`s, and a row copied from either
 * would put the distinction straight back into the response body. The
 * controller collapses them before the filter ever sees them.
 *
 * ## The property is about the account, not about `POST /auth/login`
 *
 * The cases above all arrive by password, because that is the door the
 * two-phase flow was designed at. It is not the only one. An account may hold
 * a confirmed second factor **and** a linked federated identity, and a
 * provider round trip for that identity reaches session issuance by a
 * completely different route — one that never consults the policy unless it
 * is made to. ADR-0012 states the rule structurally for that reason: whether a
 * second factor is owed is decided about the account, in one place, and a
 * session is opened only where `SecondFactorSettled` evidence says that
 * question was settled first.
 *
 * `the federated door` below is that rule asserted where it can actually
 * fail. It is in this file rather than beside D11 because it is D10's own
 * property — a second factor owed is a challenge and never a session —
 * arriving by a second route, and a reader who has just read the three
 * assertions above is the reader who needs to know they are not the whole of
 * it. It was watched failing before the federated path consulted the policy:
 * a session row existed and the browser was sent to the ordinary landing
 * page, with nothing anywhere having asked for a second factor.
 *
 * ## What this file cannot see
 *
 * `FakeDataSource`'s own numbered inventory — read it there, not here. Two
 * items bear directly: there are no unique constraints, so nothing below is
 * evidence about `uq_mfa_challenges_token_hash`, and no foreign keys, so
 * nothing is evidence that a challenge dies with its user. Neither is
 * anything D10 claims.
 */
describe('D10 — a second factor owed is a challenge, never a session', () => {
  let world: MfaWorld;

  beforeEach(async () => {
    world = await makeMfaWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  const login = (user: SeededMfaUser) => request(world.app.getHttpServer())
    .post('/auth/login')
    .send({ email: user.email, secret: user.secret });

  it('returns a challenge token and NOTHING that grants access', async () => {
    const user = await world.seedUserWithConfirmedTotp();
    const sessionsBefore = world.sessionCount();

    const response = await login(user).expect(200);

    // 1. No access credential in the body.
    expect(response.body.accessToken).toBeUndefined();
    expect(response.body.status).toBe(AuthenticationStatus.MFA_REQUIRED);
    expect(response.body.challengeToken).toEqual(expect.any(String));

    // 2. No renewal cookie.
    expect(response.headers['set-cookie'] ?? []).toEqual(
      expect.not.arrayContaining([expect.stringContaining(REFRESH_COOKIE_NAME)]),
    );

    // 3. No session row. The first two alone pass a system that creates the
    //    session and merely declines to mention it — this is the one that
    //    would have caught that.
    expect(world.sessionCount()).toBe(sessionsBefore);
  });

  it('names the enrolled methods without handing over anything that proves one', async () => {
    const user = await world.seedUserWithConfirmedTotp();

    const response = await login(user).expect(200);

    // The client has to know what to offer. It must not learn anything that
    // would help produce a proof: the shared secret lives only on the record
    // (see `MfaMethodRecord`'s own TSDoc), and this body carries neither it
    // nor the whole of `MfaMethod.toJSON()`.
    expect(response.body.methods).toEqual([
      { id: user.methodId, type: 'TOTP', label: 'Phone' },
    ]);
    expect(JSON.stringify(response.body)).not.toContain(user.totpSecret);
  });

  it('still issues a session outright for an account that has enrolled nothing', async () => {
    // The control. Without it every assertion above passes for an
    // implementation that refuses everybody a session, which would be a
    // sign-in endpoint that does not work rather than one that is careful.
    const email = 'unenrolled@example.test';
    const enrolled = await world.seedUserWithConfirmedTotp();

    await request(world.app.getHttpServer())
      .post('/auth/register')
      .send({ email, displayName: 'Nobody', secret: enrolled.secret })
      .expect(202);
    world.source.update(UserRecord, { email }, { emailVerifiedAt: new Date() });

    const response = await request(world.app.getHttpServer())
      .post('/auth/login')
      .send({ email, secret: enrolled.secret })
      .expect(200);

    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.challengeToken).toBeUndefined();
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(REFRESH_COOKIE_NAME)]),
    );
    expect(world.sessionCount()).toBe(1);
  });

  it('still signs in an account carrying a half-written unconfirmed method', async () => {
    // `decideAuthenticationStep` counts only confirmed methods, so mapping the
    // unconfirmed ones buys the policy nothing — and `mapMfaMethodRecord`
    // throws for a row whose kind and columns disagree. Mapping every row
    // therefore converts one half-written record into a 500 on **every login
    // attempt for that account, with no path to recovery**: the person cannot
    // sign in to delete the row that stops them signing in.
    //
    // No enrollment path writes such a row: WebAuthn enrollment writes nothing
    // until the attestation has verified, and then writes a full, confirmed
    // row. So the row below is seeded, not produced — the predicate is here
    // because nothing in the schema or the code makes that stay true, and the
    // cost of one such row arriving by any other route is the account's whole
    // ability to sign in.
    const user = await world.seedUserWithConfirmedTotp();
    world.source.insert(MfaMethodRecord, {
      userId: user.userId,
      type: 'WEBAUTHN',
      label: 'Half-written',
      totpSecret: null,
      totpLastStep: null,
      // Not a state any enrollment reaches — seeded, as a restore or a hand
      // edit would leave it: no credential id, no key.
      webauthnCredentialId: null,
      webauthnPublicKey: null,
      webauthnCounter: null,
      confirmedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    });

    const response = await login(user).expect(200);

    // The confirmed TOTP method is still the one gate, and it still works.
    expect(response.body.status).toBe(AuthenticationStatus.MFA_REQUIRED);
    expect(response.body.methods).toEqual([
      { id: user.methodId, type: 'TOTP', label: 'Phone' },
    ]);
    expect(world.sessionCount()).toBe(0);
  });

  describe('POST /auth/mfa/verify', () => {
    it('completes the sign-in for the account the challenge names', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const challenged = await login(user).expect(200);

      const response = await request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({
          challengeToken: challenged.body.challengeToken,
          methodId: user.methodId,
          code: currentCodeFor(user.totpSecret),
        })
        .expect(200);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.user.id).toBe(user.userId);
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining(REFRESH_COOKIE_NAME)]),
      );
      expect(world.sessionCount()).toBe(1);
    });

    it('refuses a methodId belonging to a different user', async () => {
      const victim = await world.seedUserWithConfirmedTotp();
      const attacker = await world.seedUserWithConfirmedTotp();

      const challenged = await login(victim).expect(200);

      // The attacker holds their OWN method and its secret, and a challenge
      // token for the victim. `currentCodeFor` verifies its own output, so
      // this code is genuinely valid — the refusal below cannot be an
      // ordinary wrong-code refusal wearing this test's name. If the method
      // were looked up by id alone, this succeeds, and anybody who can enrol
      // a factor can complete anybody's second one.
      await request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({
          challengeToken: challenged.body.challengeToken,
          methodId: attacker.methodId,
          code: currentCodeFor(attacker.totpSecret),
        })
        .expect(401);

      expect(world.sessionCount()).toBe(0);
    });

    it('refuses a method of the challenged account that was never confirmed', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const unconfirmed = world.source.insert(
        MfaMethodRecord,
        {
          // A real UUID: this row's id is sent as `methodId`, and the shape
          // check in front of the lookup is part of what is under test.
          id: randomUUID(),
          userId: user.userId,
          type: 'TOTP',
          label: 'Abandoned',
          totpSecret: user.totpSecret,
          totpLastStep: null,
          webauthnCredentialId: null,
          webauthnPublicKey: null,
          webauthnCounter: null,
          confirmedAt: null,
          lastUsedAt: null,
          createdAt: new Date(),
        },
      );
      const challenged = await login(user).expect(200);

      // `decideAuthenticationStep` counts only confirmed methods, so an
      // abandoned enrollment must not be a second factor either — including
      // for the account that owns it, presenting a code that really does
      // verify against the seed on the row.
      await request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({
          challengeToken: challenged.body.challengeToken,
          methodId: unconfirmed.identifiers[0].id,
          code: currentCodeFor(user.totpSecret),
        })
        .expect(401);

      expect(world.sessionCount()).toBe(0);
    });

    it('refuses the same code twice', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const code = currentCodeFor(user.totpSecret);

      const first = await login(user).expect(200);
      await request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({ challengeToken: first.body.challengeToken, methodId: user.methodId, code })
        .expect(200);

      const second = await login(user).expect(200);
      await request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({ challengeToken: second.body.challengeToken, methodId: user.methodId, code })
        .expect(401);

      // One session, from the first exchange. `totp_last_step` was written,
      // which is the only thing that makes the second presentation of a code
      // that is still inside its own 30-second window a refusal.
      expect(world.sessionCount()).toBe(1);
    });

    describe('a recovery code', () => {
      /** A challenge for `user`, freshly minted. */
      const challengeFor = (user: SeededMfaUser): Promise<string> =>
        world.challenges.mint(user.userId, MfaChallengePurpose.LOGIN, null);

      const verify = (body: Record<string, unknown>) => request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send(body);

      it('completes the sign-in when presented in its own field', async () => {
        const user = await world.seedUserWithConfirmedTotp();
        const [recoveryCode] = await world.recoveryCodes.generate(user.userId);

        const response = await verify({
          challengeToken: await challengeFor(user),
          recoveryCode,
        }).expect(200);

        expect(response.body.user.id).toBe(user.userId);
        expect(world.sessionCount()).toBe(1);
      });

      it('signs in once and no more', async () => {
        const user = await world.seedUserWithConfirmedTotp();
        const [recoveryCode] = await world.recoveryCodes.generate(user.userId);
        await verify({ challengeToken: await challengeFor(user), recoveryCode }).expect(200);

        await verify({ challengeToken: await challengeFor(user), recoveryCode }).expect(401);
        expect(world.sessionCount()).toBe(1);
      });

      it('does not work presented in the TOTP code field', async () => {
        const user = await world.seedUserWithConfirmedTotp();
        const [recoveryCode] = await world.recoveryCodes.generate(user.userId);

        await verify({
          challengeToken: await challengeFor(user),
          methodId: user.methodId,
          code: recoveryCode,
        }).expect(401);
        expect(world.sessionCount()).toBe(0);
      });

      it('is not what a TOTP code presented in its field is taken for', async () => {
        const user = await world.seedUserWithConfirmedTotp();
        await world.recoveryCodes.generate(user.userId);

        await verify({
          challengeToken: await challengeFor(user),
          recoveryCode: currentCodeFor(user.totpSecret),
        }).expect(401);
        expect(world.sessionCount()).toBe(0);
      });

      it('is refused outright beside a method and code, and neither proof is used', async () => {
        const user = await world.seedUserWithConfirmedTotp();
        const [recoveryCode] = await world.recoveryCodes.generate(user.userId);

        // Both proofs are GOOD. A route that preferred either would sign in.
        await verify({
          challengeToken: await challengeFor(user),
          methodId: user.methodId,
          code: currentCodeFor(user.totpSecret),
          recoveryCode,
        }).expect(401);
        expect(world.sessionCount()).toBe(0);

        // ...and the recovery code was not spent by being refused.
        await verify({ challengeToken: await challengeFor(user), recoveryCode }).expect(200);
      });

      it('is refused when the request carries no proof at all', async () => {
        const user = await world.seedUserWithConfirmedTotp();
        await verify({ challengeToken: await challengeFor(user) }).expect(401);
        await verify({ challengeToken: await challengeFor(user), methodId: user.methodId })
          .expect(401);
        expect(world.sessionCount()).toBe(0);
      });
    });

    it('answers every refusal identically, byte for byte', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const code = currentCodeFor(user.totpSecret);

      /** A token no challenge answers to. */
      const absent = generateOpaqueToken().token;

      // **Every `mint` happens before any row is damaged, and the order is
      // load-bearing.** `mint` sweeps expired rows first — see the assertion
      // below, which is what would catch this being reordered.
      const expired = await world.challenges.mint(user.userId, MfaChallengePurpose.LOGIN, null);
      const consumed = await world.challenges.mint(user.userId, MfaChallengePurpose.LOGIN, null);
      const wrongPurpose = await world.challenges.mint(
        user.userId,
        MfaChallengePurpose.WEBAUTHN_ENROLLMENT,
        null,
      );
      // The sixth case's challenge is minted **here**, with the others, and not
      // beside the comment that explains it. Minted later it would sweep the
      // expired row away, leaving `expired` a token no row answers to — the
      // absent cause presented twice and the expired cause never — and the
      // comparison would go on passing. That is exactly what happened when this
      // case was first added below, under the guard comment warning against it.
      const sixthChallenge = await world.challenges.mint(
        user.userId,
        MfaChallengePurpose.LOGIN,
        null,
      );

      // The recovery-code causes. Every challenge is a good one and every
      // recovery code is presented in the field it belongs in — except where
      // the cause IS the field — so what varies is only the proof.
      const other = await world.seedUserWithConfirmedTotp();
      const [ownCode, spentCode] = await world.recoveryCodes.generate(user.userId);
      const [othersCode] = await world.recoveryCodes.generate(other.userId);
      await world.recoveryCodes.consume(user.userId, spentCode);
      const recoveryChallenges = [
        await world.challenges.mint(user.userId, MfaChallengePurpose.LOGIN, null),
        await world.challenges.mint(user.userId, MfaChallengePurpose.LOGIN, null),
        await world.challenges.mint(user.userId, MfaChallengePurpose.LOGIN, null),
        await world.challenges.mint(user.userId, MfaChallengePurpose.LOGIN, null),
        await world.challenges.mint(user.userId, MfaChallengePurpose.LOGIN, null),
        await world.challenges.mint(user.userId, MfaChallengePurpose.LOGIN, null),
        await world.challenges.mint(user.userId, MfaChallengePurpose.LOGIN, null),
      ];

      /** A distinctive instant, so the sweep assertion below names one row and not "some expired one". */
      const PAST = new Date(Date.now() - 60_000);

      world.source.update(
        MfaChallengeRecord,
        { tokenHash: hashOpaqueToken(expired) },
        { expiresAt: PAST },
      );
      world.source.update(
        MfaChallengeRecord,
        { tokenHash: hashOpaqueToken(consumed) },
        { consumedAt: new Date() },
      );

      // `purpose` is plain `text` with no CHECK, so a value neither
      // `MfaChallengePurpose` member names is reachable — corruption, a
      // botched migration, a future writer. Seeded directly because nothing
      // in this application can write one.
      const unmodelled = generateOpaqueToken();
      world.source.insert(MfaChallengeRecord, {
        userId: user.userId,
        tokenHash: unmodelled.hash,
        purpose: 'SOMETHING_ELSE',
        webauthnChallenge: null,
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: null,
        createdAt: new Date(),
      });

      // The guard for all of this is **immediately below, after the last mint
      // and just before the first request** — deliberately, and not here where
      // the rows are built. `mint` sweeps expired rows on its way in,
      // unconditionally (`MfaChallengeService.mint`, and deliberately — "a
      // sweep on a path nothing calls is a sweep that does not exist"), so any
      // mint reached after the expired row is damaged deletes it, and this case
      // goes on passing while presenting the absent cause twice and the expired
      // cause never.
      //
      // An assertion placed *here* would not catch that: it would run before
      // the offending mint and see the row still standing. That is not a
      // hypothesis — this test shipped exactly that way for a round, with the
      // sixth case's mint added below an assertion warning against it, and the
      // suite stayed green while testing four causes and calling it five.

      // The first five vary the challenge and hold the method valid. **The
      // sixth varies the other axis**: a good challenge and a `methodId` that
      // is not a UUID at all.
      //
      // That case is here because `mfa_methods.id` is a `uuid` column, so
      // against Postgres the lookup does not miss — it raises `22P02 invalid
      // input syntax for type uuid`, which leaves the service as a
      // `QueryFailedError` rather than a refusal and is answered `500`. A
      // sixth answer, on the one route whose entire premise is that every
      // refusal looks the same, reachable by anyone holding a challenge —
      // including a legitimate user with a buggy client — and it burns the
      // challenge on the way.
      //
      // **On this store that case cannot fail for that reason, and saying so is
      // the point.** `FakeDataSource` does not type its columns: a malformed id
      // simply matches no row, so it produces the intended 401 whether or not
      // the shape check exists. Deleting the check leaves this green.
      //
      // It is here because the comparison should cover every way this route can
      // be made to answer, not because it is the evidence. The evidence is
      // `mfa/__tests__/mfa-verification.service.spec.ts`, which builds the
      // service over a repository that throws if it is consulted at all, and so
      // asserts the thing that actually matters: the refusal happens *before*
      // the lookup. That test fails when the check goes; this one does not.
      const attempts: Record<string, string>[] = [
        { challengeToken: absent, methodId: user.methodId, code },
        { challengeToken: expired, methodId: user.methodId, code },
        { challengeToken: consumed, methodId: user.methodId, code },
        { challengeToken: unmodelled.token, methodId: user.methodId, code },
        { challengeToken: wrongPurpose, methodId: user.methodId, code },
        { challengeToken: sixthChallenge, methodId: 'not-a-uuid', code },
        // The recovery-code causes, each on a good challenge.
        // 7. a code this account was never issued
        { challengeToken: recoveryChallenges[0], recoveryCode: generateOpaqueToken().token },
        // 8. one that was issued and has been spent — the cause the service
        //    names and the route must not
        { challengeToken: recoveryChallenges[1], recoveryCode: spentCode },
        // 9. one issued to somebody else
        { challengeToken: recoveryChallenges[2], recoveryCode: othersCode },
        // 10. a recovery code in the TOTP field
        {
          challengeToken: recoveryChallenges[3],
          methodId: user.methodId,
          code: ownCode,
        },
        // 11. a TOTP code in the recovery field
        { challengeToken: recoveryChallenges[4], recoveryCode: code },
        // 12. both fields, both good
        {
          challengeToken: recoveryChallenges[5],
          methodId: user.methodId,
          code,
          recoveryCode: ownCode,
        },
        // 13. neither
        { challengeToken: recoveryChallenges[6] },
      ];

      // **The guard, after every mint and before any request.** Two assertions,
      // because they fail to different things: the first says an expired row
      // survived whatever minting happened above, the second says the token
      // about to be presented as the expired cause is the one that answers to
      // it. They come apart exactly when a sweep takes the row.
      //
      // Note what neither can do, and what nothing here can: the comparison
      // below asserts every answer is *identical*, so it can never notice
      // which cause it presented. Swapping one token for another leaves it
      // green by construction — that is the property, not a weakness in it, and
      // it is why the state of the rows has to be asserted separately rather
      // than inferred from the responses.
      expect(world.source.all(MfaChallengeRecord)
        .filter((row) => row.expiresAt === PAST)).toHaveLength(1);
      expect(world.source.all(MfaChallengeRecord)
        .find((row) => row.tokenHash === hashOpaqueToken(expired))?.expiresAt).toBe(PAST);

      // **The same guard, for the recovery fixtures.** The expired-row guard
      // above covers one row. Nothing else stops a later edit from spending or
      // sweeping one of these, after which the comparison would present a
      // different cause than its name says and still be green — thirteen names
      // over fewer distinct answers. So: the three codes' state as each cause
      // needs it, and every one of the seven challenges live and unspent.
      const recoveryRow = (issued: string): MfaRecoveryCodeRecord | undefined =>
        world.source.all(MfaRecoveryCodeRecord)
          .find((row) => row.codeHash === hashOpaqueToken(issued.replace(/\s+/g, ''))) as
          MfaRecoveryCodeRecord | undefined;
      expect(recoveryRow(ownCode)?.consumedAt).toBeNull();
      expect(recoveryRow(othersCode)?.consumedAt).toBeNull();
      expect(recoveryRow(spentCode)?.consumedAt).toBeInstanceOf(Date);
      for (const token of recoveryChallenges) {
        const row = world.source.all(MfaChallengeRecord)
          .find((held) => held.tokenHash === hashOpaqueToken(token)) as
          MfaChallengeRecord | undefined;
        expect(row?.consumedAt).toBeNull();
        expect(row?.purpose).toBe(MfaChallengePurpose.LOGIN);
        expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now());
      }

      const answers: {
        status: number;
        body: string;
        contentType: string;
        setCookie: string[];
      }[] = [];
      for (const attempt of attempts) {
        // A valid `code` throughout the first six, so any difference between the
        // answers is a difference this route disclosed about the one thing that varied.
        const response = await request(world.app.getHttpServer())
          .post('/auth/mfa/verify')
          .send(attempt);
        answers.push({
          status: response.status,
          body: response.text,
          contentType: response.headers['content-type'],
          setCookie: [response.headers['set-cookie'] ?? []].flat(),
        });
      }

      expect(answers).toHaveLength(attempts.length);
      expect(answers).toHaveLength(13);
      expect(answers[0].status).toBe(401);
      // Not a key: the placeholder this replaced threw a bare
      // `UnauthorizedException`, which renders as an untranslated
      // "Unauthorized". A `messageKey` is what makes this prose.
      expect(JSON.parse(answers[0].body)).toEqual({
        error: 'Unauthorized',
        message: expect.stringMatching(/[a-z]{3,} [a-z]{3,}/i),
      });
      // No `code`: the filter emits one only for a row in its `DOMAIN_ERRORS`
      // table, and putting the challenge errors there would give each of
      // each of the thirteen causes above a name of its own — the leak, re-opened one field down
      // from the status.
      expect(JSON.parse(answers[0].body).code).toBeUndefined();
      for (const answer of answers.slice(1)) expect(answer).toEqual(answers[0]);

      expect(world.sessionCount()).toBe(0);
    });

    it('refuses once the account may no longer authenticate, even mid-ceremony', async () => {
      // `signIn` checks `canAuthenticate()` before minting. If nothing checks
      // it again before the session is opened, a suspension landing inside the
      // challenge's window is simply not honoured — and "suspend this account"
      // is a security control, so a control that takes minutes to bind is a
      // control with a documented bypass. The window is narrow and the first
      // factor really did pass at mint time; neither makes the session right.
      const user = await world.seedUserWithConfirmedTotp();
      const challenged = await login(user).expect(200);

      world.source.update(UserRecord, { id: user.userId }, { status: UserStatus.SUSPENDED });

      await request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({
          challengeToken: challenged.body.challengeToken,
          methodId: user.methodId,
          code: currentCodeFor(user.totpSecret),
        })
        .expect(401);

      expect(world.sessionCount()).toBe(0);
    });

    it('refuses a challenge that has already been spent, without a second session', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const challenged = await login(user).expect(200);
      const present = () => request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({
          challengeToken: challenged.body.challengeToken,
          methodId: user.methodId,
          code: currentCodeFor(user.totpSecret),
        });

      await present().expect(200);
      await present().expect(401);

      expect(world.sessionCount()).toBe(1);
    });
  });

  describe('the federated door', () => {
    /**
     * Follows a `302` this application issued back into this same
     * application, keeping only the path and query — the host on the
     * `Location` header is the harness's own public API URL, which nothing
     * here listens on. The same idiom `d11-federated-email-match.spec.ts`
     * uses, for the same reason.
     */
    const follow = (location: string): request.Test => {
      const target = new URL(location);
      return request(world.app.getHttpServer()).get(`${target.pathname}${target.search}`);
    };

    /**
     * Begins a federated sign-in and presents the callback the provider
     * redirects to, returning the callback's own response. `DevOAuthProvider`
     * registers as `OIDC` and needs no page, no network and no human step, so
     * these two requests are the whole of a provider round trip.
     */
    const completeProviderCallback = async (): Promise<request.Response> => {
      const begin = await request(world.app.getHttpServer())
        .get(`/auth/oauth/${AuthProvider.OIDC}`)
        .expect(302);
      return follow(begin.headers.location as string);
    };

    it('does not issue a session to an enrolled account arriving through a provider', async () => {
      const user = await world.seedUserWithConfirmedTotp(FEDERATED_ADDRESS);
      world.linkFederatedIdentity(user.userId);
      const sessionsBefore = world.sessionCount();

      const callback = await completeProviderCallback();

      // The same three assertions the password case makes, against the
      // artefacts this door produces instead: a redirect rather than a body.
      // The session count is first because it is the one that sees the fault
      // — a callback that issues the session and merely redirects elsewhere
      // satisfies every other assertion here.
      expect(world.sessionCount()).toBe(sessionsBefore);
      expect(callback.status).toBe(302);
      expect(callback.headers['set-cookie']).toBeUndefined();

      // **And the fourth, which is this case's own.** A refusal that goes
      // nowhere is a refusal nobody is ever shown: the enrolled account's
      // owner has proven a provider assertion and is owed the prompt for the
      // factor they deliberately enrolled, not a landing page with nothing on
      // it. Asserting the challenge exists and asserting the browser is sent
      // somewhere are two halves that can both be green while never meeting —
      // this is the assertion that they meet.
      const landing = new URL(callback.headers.location as string);
      expect(landing.pathname).toBe('/mfa/challenge');
      expect(landing.searchParams.get('challengeToken')).toEqual(expect.any(String));
    });

    it('lands with a token that really finishes the sign-in', async () => {
      // The remedy beside the refusal, the same pairing D11 makes: without
      // this, every assertion above is satisfied by a callback that mints
      // nothing and redirects to a page carrying a string that opens nothing.
      const user = await world.seedUserWithConfirmedTotp(FEDERATED_ADDRESS);
      world.linkFederatedIdentity(user.userId);

      const callback = await completeProviderCallback();
      const challengeToken = new URL(callback.headers.location as string)
        .searchParams.get('challengeToken');

      const verified = await request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({ challengeToken, methodId: user.methodId, code: currentCodeFor(user.totpSecret) })
        .expect(200);

      expect(verified.body.user.id).toBe(user.userId);
      expect(world.sessionCount()).toBe(1);
    });

    it('still signs in outright through the provider when nothing is enrolled', async () => {
      // The control. Without it the refusal above passes for a federated
      // callback that is simply broken — one that issues no session to
      // anybody, ever, which would be a sign-in flow that does not work
      // rather than one that is careful.
      const callback = await completeProviderCallback();

      expect(callback.status).toBe(302);
      expect(new URL(callback.headers.location as string).pathname).toBe('/oauth/callback');
      expect(callback.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining(REFRESH_COOKIE_NAME)]),
      );
      expect(world.sessionCount()).toBe(1);
    });
  });
});
