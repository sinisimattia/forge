import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import request from 'supertest';
import type { Response } from 'supertest';
import type { RecordAuditEntryInput } from '__FORGE_SCOPE__/core/audit/types';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { AuditService } from '../../audit/audit.service';

import { AuthIdentityRecord } from '../../identities/auth-identity-record.entity';
import { NoOpBreachedPasswordRegistry } from '../../identities/breached-passwords';
import { Argon2PasswordHasher } from '../../identities/hashing';
import { IdentitiesService } from '../../identities/identities.service';
import type { IMailer, OutboundMessage } from '../../mail';
import { MfaChallengeRecord } from '../../mfa/entities/mfa-challenge-record.entity';
import { MfaMethodRecord } from '../../mfa/entities/mfa-method-record.entity';
import { MfaRecoveryCodeRecord } from '../../mfa/entities/mfa-recovery-code-record.entity';
import { RecoveryCodes } from '../../mfa/recovery/recovery-codes';
import { MfaChallengeService } from '../../mfa/mfa-challenge.service';
import { MfaVerificationService } from '../../mfa/mfa-verification.service';
import { TotpVerifier } from '../../mfa/totp/TotpVerifier';
import { UserRecord } from '../../users/user-record.entity';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { EmailVerificationTokenRecord } from '../entities/email-verification-token-record.entity';
import { PasswordResetTokenRecord } from '../entities/password-reset-token-record.entity';
import { RefreshTokenRecord } from '../entities/refresh-token-record.entity';
import { SessionRecord } from '../entities/session-record.entity';
import { RefreshTokenService } from '../session/refresh-token.service';
import { SessionService } from '../session/session.service';
import { JwtStrategy } from '../strategies';
import { FakeDataSource, UNMETERED_THROTTLING, recordingAudit } from '../../common/testing';

/**
 * # D7 — a known address and an unknown one are indistinguishable
 *
 * **Four** endpoints take an address from somebody who has proven nothing:
 * signing in, asking for a recovery link, registering, and asking for
 * verification to be sent again. Each of them knows something a stranger would
 * like to learn — whether that address has an account here — and each of them
 * must answer without carrying it.
 *
 * **This file exercises the first three.** It went on saying "three" after the
 * fourth was added, which is the kind of sentence that quietly becomes a
 * coverage claim nobody checks, so where the fourth is held is written down
 * rather than left to be assumed:
 *
 * - `AuthService.resendVerification` answers alike for an unknown address, an
 *   address already proven, and one whose account has been closed — asserted in
 *   `auth.service.spec.ts`, and again by core's shared conformance suite
 *   (`no enumeration oracle › resends verification for an address nothing
 *   answers to`). Injecting a `UserNotFoundError` for an unknown address turns
 *   both red.
 * - `AuthController.resendVerification` does not branch — asserted in
 *   `auth.controller.spec.ts` (`answers a known and an unknown address
 *   identically`), against a stubbed service, which is what that test claims.
 *
 * What no test covers for the fourth is the shape this file is built to check:
 * the **whole** response, headers included, compared between the two cases. If
 * this file grows a fourth endpoint, that is the gap it closes.
 *
 * ## Why every assertion here compares two responses instead of checking one
 *
 * The obvious form of this test is two assertions against the same expected
 * literal. It is weaker, and it fails in a specific way: the day somebody
 * changes one branch and updates "its" expectation, both assertions still pass
 * and the property is gone. A comparison of one whole response against the
 * other cannot be satisfied that way — there is no literal to update, and the
 * only way to make it pass is for the two to be the same.
 *
 * So nothing below names a status code or a message. Each test makes two real
 * requests and compares what came back.
 *
 * ## What is under test, and why it is not a fake service
 *
 * The real `AuthService` over an in-memory store, driven through the real
 * `AuthController` behind {@link GLOBAL_PROVIDERS} — the shipped array, so the
 * validation pipe, the exception filter and the translation interceptor are the
 * application's own and not ones this file assembled.
 *
 * That matters more than it looks, though **not** for the reason first given
 * here. The original argument — that a fake service makes every comparison
 * below unfailable — was tested and is wrong: a fake modelling
 * `REJECTED/UNKNOWN_ACCOUNT` against `REJECTED/INVALID_SECRET` catches a
 * controller that renders the difference, which is what two of the three
 * injections in this file's history were.
 *
 * The real argument is **coverage surface**, and it was measured. The
 * enumeration decisions that matter do not live in the controller; they live in
 * the service — the duplicate-registration silence, the dummy derivation spent
 * on an unknown address, the deleted-account branch. Two faults demonstrate it:
 * making `AuthService.register` throw for an address already taken, and removing
 * `requestPasswordReset` altogether, both turn tests in this file red. Under an
 * arrangement where the service is a fake, **both of those faults are outside
 * the system under test** — the fake replaces exactly the code that leaks.
 *
 * So the difference here is real at the point where it is decided: one address
 * has an account and the other does not, and the whole stack has to decline to
 * carry it.
 *
 * ## What this does NOT cover — timing
 *
 * **Nothing here measures how long anything took, and the property therefore is
 * not covered by this file.** An endpoint that returns the same body and returns
 * it in a tenth of the time for an unknown address is the same oracle, read off
 * a stopwatch instead of a response. A timing assertion in a unit suite is
 * flaky — it fails on a loaded machine and passes on a fast one — and a flaky
 * assertion about a security property is deleted within a month by somebody who
 * is right to delete it.
 *
 * What protects timing instead is `identities.spendVerificationOnNobody`, which
 * `auth.service.spec.ts` asserts by **counting derivations** rather than by
 * measuring: the cost is the property, and the cost is not visible in any
 * answer. Read that suite's "the cost of a failed attempt does not reveal
 * whether the address is known" block as the other half of D7. Neither half is
 * the whole.
 */

/** A password that satisfies the policy. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/** A wrong guess at it, long enough to pass validation. */
const WRONG_PLAINTEXT = 'not the password that was chosen';

/** This suite's signing key. Not a credential: it signs nothing outside this file. */
const SIGNING_KEY = 'enumeration-safety-spec-signing-key';

const WEBAPP_URL = 'https://app.example.test';

/** The address the world holds an account for. */
const KNOWN = 'ada@example.test';

/** One it holds nothing for. Well-formed, so nothing but existence tells them apart. */
const UNKNOWN = 'nobody@example.test';

/**
 * Everything about a response that a client can see, except the values that
 * cannot be equal.
 *
 * Header **names** rather than header values: `Date` differs between two
 * requests by construction, and so would any timing header a proxy adds. What is
 * worth pinning is that one response does not carry a header the other lacks —
 * a `Set-Cookie` on one branch, a `Retry-After` on the other — because a header
 * present in one case and absent in the other is exactly as good an oracle as a
 * different message.
 */
const visibleTo = (response: Response): { status: number; body: unknown; headers: string[] } => ({
  status: response.status,
  body: response.body,
  headers: Object.keys(response.headers).sort(),
});

describe('D7: a known address and an unknown one are indistinguishable', () => {
  let app: INestApplication;
  let source: FakeDataSource;
  let sent: OutboundMessage[];

  beforeEach(async () => {
    source = new FakeDataSource();
    sent = [];
    const recorded: RecordAuditEntryInput[] = [];

    const mailer: IMailer = {
      send: async (message) => {
        sent.push(message);
      },
    };
    const audit = recordingAudit(recorded);

    const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
      source.getRepository(entity) as unknown as Repository<T>;

    const identities = new IdentitiesService(
      repo<AuthIdentityRecord>(AuthIdentityRecord),
      new Argon2PasswordHasher(),
      audit,
    );
    const jwt = new JwtService({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } });
    const sessions = new SessionService(
      repo<SessionRecord>(SessionRecord),
      repo<RefreshTokenRecord>(RefreshTokenRecord),
      jwt,
      source as unknown as DataSource,
    );

    const auth = new AuthService(
      repo<UserRecord>(UserRecord),
      repo<EmailVerificationTokenRecord>(EmailVerificationTokenRecord),
      repo<PasswordResetTokenRecord>(PasswordResetTokenRecord),
      identities,
      sessions,
      audit,
      source as unknown as DataSource,
      mailer,
      new NoOpBreachedPasswordRegistry(),
      repo<MfaMethodRecord>(MfaMethodRecord),
      new MfaChallengeService(
        repo<MfaChallengeRecord>(MfaChallengeRecord),
        source as unknown as DataSource,
      ),
      new ConfigService({ PUBLIC_WEBAPP_URL: WEBAPP_URL }),
    );

    // The account the world knows about. Registered and verified through the
    // real service, so it is a real account and not a row this file wrote —
    // an account assembled by hand could differ from a registered one in some
    // field that the endpoints under test happen to read.
    await auth.register({ email: KNOWN, displayName: 'Ada Lovelace', secret: PLAINTEXT });
    const link = sent[sent.length - 1].body;
    const credential = /token=([A-Za-z0-9_-]+)/.exec(link);
    if (credential === null) throw new Error(`no credential in the verification message: ${link}`);
    await auth.verifyEmail(credential[1]);
    sent.length = 0;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: SIGNING_KEY })] }),
        // The application's own translation registration. These comparisons are
        // of RENDERED bodies, so they have to be rendered the way the
        // application renders them — two identical translation keys compare
        // equal for a reason that has nothing to do with the property.
        I18N,
        PassportModule,
        UNMETERED_THROTTLING,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [AuthController],
      providers: [
        // THE SHIPPED ARRAY, not a copy. The global validation pipe, the
        // exception filter and the response interceptor are what turn a refusal
        // into the bytes compared below; assembling substitutes for them here
        // would make this a comparison of responses the application does not
        // produce.
        ...GLOBAL_PROVIDERS,
        // `GLOBAL_PROVIDERS` carries `PlatformAdminOverrideInterceptor`, which
        // needs this. Nothing in this file passes through `PlatformAdminGuard`,
        // so the interceptor never writes anything here — but it is constructed,
        // which is the point: a probe application registering the shipped array
        // has to be able to build every provider in it, so one added there with
        // an unsatisfiable dependency fails here rather than at start-up.
        { provide: AuditService, useValue: audit },
        JwtStrategy,
        { provide: AuthService, useValue: auth },
        { provide: SessionService, useValue: sessions },
        { provide: RefreshTokenService, useValue: {} as RefreshTokenService },
        // `AuthController` names it, and a controller whose constructor cannot
        // be satisfied mounts none of its routes. Nothing in this file drives
        // `POST /auth/mfa/verify`; the real service is provided rather than a
        // stub so that this application is the one `AuthModule` builds.
        {
          provide: MfaVerificationService,
          useValue: new MfaVerificationService(
            repo<MfaMethodRecord>(MfaMethodRecord),
            new MfaChallengeService(
              repo<MfaChallengeRecord>(MfaChallengeRecord),
              source as unknown as DataSource,
            ),
            new TotpVerifier(),
            sessions,
            audit,
            repo<UserRecord>(UserRecord),
            new RecoveryCodes(
              repo<MfaRecoveryCodeRecord>(MfaRecoveryCodeRecord),
              source as unknown as DataSource,
            ),
          ),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('signing in', () => {
    const attempt = (email: string, secret: string): Promise<Response> =>
      request(app.getHttpServer()).post('/auth/login').send({ email, secret });

    it('answers a known address with a wrong secret exactly as it answers an unknown one', async () => {
      const known = await attempt(KNOWN, WRONG_PLAINTEXT);
      const unknown = await attempt(UNKNOWN, WRONG_PLAINTEXT);

      // One comparison of two whole responses. No literal to drift.
      expect(visibleTo(known)).toStrictEqual(visibleTo(unknown));
    });

    it('is comparing two responses that were really refused, not two errors', async () => {
      // Without this the comparison above is satisfied by a stack that answers
      // 500 to everything. It names a status, which is exactly what the
      // comparisons must not do — which is why it is a separate test about the
      // world rather than an assertion inside one of them.
      const known = await attempt(KNOWN, WRONG_PLAINTEXT);
      expect(known.status).toBe(401);
      // And the one that must succeed does, so "everything is refused" cannot
      // satisfy the file either.
      const correct = await attempt(KNOWN, PLAINTEXT);
      expect(correct.status).toBe(200);
    });
  });

  describe('asking for a recovery link', () => {
    const ask = (email: string): Promise<Response> =>
      request(app.getHttpServer()).post('/auth/forgot-password').send({ email });

    it('answers a known address exactly as it answers an unknown one', async () => {
      const known = await ask(KNOWN);
      const unknown = await ask(UNKNOWN);

      expect(visibleTo(known)).toStrictEqual(visibleTo(unknown));
    });

    it('is comparing two responses one of which really issued a credential', async () => {
      // The difference the endpoint is declining to carry has to exist, or the
      // comparison above proves nothing. One of these two requests puts a
      // recovery credential in a mailbox and the other does not.
      await ask(UNKNOWN);
      expect(sent).toHaveLength(0);

      await ask(KNOWN);
      expect(sent).toHaveLength(1);
      expect(source.all(PasswordResetTokenRecord)).toHaveLength(1);
    });
  });

  describe('registering', () => {
    const attempt = (email: string): Promise<Response> =>
      request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, displayName: 'Somebody', secret: PLAINTEXT });

    it('answers an address that already has an account exactly as it answers a fresh one', async () => {
      const taken = await attempt(KNOWN);
      const fresh = await attempt('grace@example.test');

      expect(visibleTo(taken)).toStrictEqual(visibleTo(fresh));
    });

    it('is comparing two responses only one of which created an account', async () => {
      const before = source.all(UserRecord).length;
      await attempt(KNOWN);
      expect(source.all(UserRecord)).toHaveLength(before);

      await attempt('grace@example.test');
      expect(source.all(UserRecord)).toHaveLength(before + 1);
    });
  });
});
