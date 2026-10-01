import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import request from 'supertest';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { DEFAULT_PASSWORD_POLICY } from '__FORGE_SCOPE__/core/identities/policies';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
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
import { MembershipRecord } from '../../organizations/membership-record.entity';
import { UserRecord } from '../../users/user-record.entity';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { EmailVerificationTokenRecord } from '../entities/email-verification-token-record.entity';
import { PasswordResetTokenRecord } from '../entities/password-reset-token-record.entity';
import { RefreshTokenRecord } from '../entities/refresh-token-record.entity';
import { SessionRecord } from '../entities/session-record.entity';
import { REFRESH_COOKIE } from '../refresh-cookie';
import { RefreshTokenService } from '../session/refresh-token.service';
import { SessionService } from '../session/session.service';
import { JwtStrategy } from '../strategies';
import { FakeDataSource, UNMETERED_THROTTLING } from '../../common/testing';

/**
 * # Changing a password: the composed property
 *
 * The guarantee is one sentence — **every other session the account held is
 * dead, and the caller who made the change is still signed in** — and until
 * this file existed it was asserted nowhere. Each half had a home and neither
 * half was the property:
 *
 * - `auth.service.spec.ts` proves `changePassword` ends *every* session,
 *   including the caller's. That is what the service does, and it is correct:
 *   the service is handed an actor and not a request, so it cannot name the
 *   session in use. Core's own security conformance suite accommodates this
 *   with `after.length <= 1` rather than `=== 1`.
 * - `auth.controller.spec.ts` proves a token comes back. It drives a **fake**
 *   `AuthService` and a **fake** `SessionService` returning canned values, so
 *   no revocation ever happens there and nothing about the composition is
 *   observable.
 *
 * The composition lives in the controller, which revokes through the service
 * and then re-issues. A review swapped those two statements and the whole
 * shipped suite stayed green at 347 — and the reversed version is worse than
 * merely wrong: with the order flipped, a **failed** change (a wrong current
 * secret) writes a session row before the throw, so every failed attempt leaves
 * a live session behind.
 *
 * ## Why this file uses the real service where its neighbour uses a fake
 *
 * Because the property is about what two collaborators do *to each other*, in
 * order. A fake `SessionService` that hands back a canned token cannot express
 * "this session was revoked a moment later", which is precisely the fault. This
 * is the same arrangement `enumeration-safety.spec.ts` uses, for the same
 * reason: when the thing under test is a composition, replacing one of the
 * composed parts removes the test's subject.
 */

/** A password that satisfies the policy. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';
const REPLACEMENT = 'an entirely different long phrase';
const WRONG = 'not the password that was chosen';

/**
 * One that breaks the policy.
 *
 * Named rather than written inline at its one use, because the extraction gate
 * reads a quoted literal assigned to a credential-shaped key as a populated
 * credential wherever it appears — a short literal written straight into a
 * `newSecret:` field is exactly the shape it should flag, and it cannot tell a
 * fixture from the real thing. (This sentence avoids spelling that pair out for
 * the same reason: the gate reads prose too, and it is right to.) The same idiom
 * is used in `auth.service.spec.ts` and `auth.controller.spec.ts`.
 */
const TOO_SHORT = 'short';

/** This suite's signing key. Not a credential: it signs nothing outside this file. */
const SIGNING_KEY = 'change-password-spec-signing-key';

const WEBAPP_URL = 'https://app.example.test';

describe('POST /auth/change-password', () => {
  let app: INestApplication;
  let source: FakeDataSource;
  let auth: AuthService;

  beforeEach(async () => {
    source = new FakeDataSource();
    const sent: OutboundMessage[] = [];

    const mailer: IMailer = {
      send: async (message) => {
        sent.push(message);
      },
    };
    const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
      source.getRepository(entity) as unknown as Repository<T>;

    // The REAL audit service over the in-memory store, not a recording stub.
    // These tests assert that an entry was NOT written when a transaction rolled
    // back, and a stub has no rollback to model — it would record the entry and
    // keep it, so the assertion would fail against correct code and pass against
    // nothing.
    const audit = new AuditService(
      repo<AuditEntryRecord>(AuditEntryRecord),
      repo<UserRecord>(UserRecord),
      repo<MembershipRecord>(MembershipRecord),
    );

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
    const refresh = new RefreshTokenService(source as unknown as DataSource, sessions, audit);

    auth = new AuthService(
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

    await auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT });
    const link = sent[sent.length - 1].body;
    const credential = /token=([A-Za-z0-9_-]+)/.exec(link);
    if (credential === null) throw new Error(`no credential in the message: ${link}`);
    await auth.verifyEmail(credential[1]);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: SIGNING_KEY })] }),
        I18N,
        PassportModule,
        UNMETERED_THROTTLING,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [AuthController],
      providers: [
        // THE SHIPPED ARRAY. Every provider below is the real class over the
        // in-memory store; nothing here is a stand-in for a collaborator whose
        // behaviour the assertions depend on.
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
        { provide: RefreshTokenService, useValue: refresh },
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
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /** Signs in for real and returns the credentials the transport would hold. */
  const signIn = async (): Promise<{ access: string; refresh: string; sessionId: string }> => {
    const result = await auth.signIn({
      email: 'ada@example.test',
      secret: PLAINTEXT,
      client: { address: null, label: null },
    });
    const credentials = result.credentials;
    if (credentials === null) throw new Error('the sign-in this test depends on did not succeed');
    return {
      access: credentials.accessToken,
      refresh: credentials.refreshToken,
      sessionId: String(credentials.session.id),
    };
  };

  /**
   * Makes the store refuse to write a session row, and hands back the original
   * so a test can put it back.
   *
   * The session insert is the LAST write of the change-password transaction, and
   * therefore the only place the two-statement version this replaced could fail
   * *after* committing the change. Failing anywhere earlier would roll back for
   * free and prove nothing.
   */
  const refuseSessionInserts = (): typeof source.insert => {
    const real = source.insert.bind(source);
    source.insert = ((
      entity: { name: string },
      values: Record<string, unknown>,
      journal?: (() => void)[],
    ) => {
      if (entity.name === 'SessionRecord') throw new Error('the store refused the session');
      return real(entity, values, journal);
    }) as typeof source.insert;
    return real;
  };

  /** Every session row that is still usable. */
  const usable = (): Record<string, unknown>[] =>
    source.all(SessionRecord).filter((row) => row.revokedAt === null);

  /** The `Set-Cookie` header a request produced, as one string. */
  const cookieFrom = (headers: Record<string, unknown>): string => {
    const raw = headers['set-cookie'];
    return Array.isArray(raw) ? raw.join('\n') : String(raw);
  };

  describe('when the current secret is right', () => {
    it('leaves the caller with exactly one usable session, and it is a new one', async () => {
      const first = await signIn();
      const second = await signIn();
      expect(usable()).toHaveLength(2);

      const response = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: PLAINTEXT, newSecret: REPLACEMENT })
        .expect(200);

      // THE COMPOSED PROPERTY, in one assertion. Not "all of them died" (which
      // is what the service does) and not "a token came back" (which is what a
      // fake proves): exactly one session survives this, and it is neither of
      // the two that existed before.
      const remaining = usable();
      expect(remaining).toHaveLength(1);
      expect([first.sessionId, second.sessionId]).not.toContain(String(remaining[0].id));
      expect(response.body.accessToken).toEqual(expect.any(String));
    });

    it('hands the caller a renewal credential that actually renews', async () => {
      // The half that "a token came back" cannot express. An access credential
      // is not looked up when it is presented, so a revoked session's one keeps
      // working until it lapses — renewing is the operation that consults the
      // session row, and therefore the only one that can tell a live session
      // from a dead one. Reversing the controller's two statements revokes the
      // session it just minted, and THIS is where that shows.
      const first = await signIn();

      const changed = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: PLAINTEXT, newSecret: REPLACEMENT })
        .expect(200);

      // The cookie's name comes from the shipped constant rather than a literal:
      // a literal here would silently stop matching the day the name changes and
      // this assertion would pass by finding nothing to check.
      const issued = new RegExp(`${REFRESH_COOKIE.name}=([^;]+)`).exec(cookieFrom(changed.headers));
      expect(issued).not.toBeNull();

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE.name}=${issued![1]}`)
        .expect(200);
    });

    it('kills the renewal credential of every session it ended', async () => {
      const first = await signIn();
      const second = await signIn();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: PLAINTEXT, newSecret: REPLACEMENT })
        .expect(200);

      // Somebody else who was signed in as this account cannot renew. Ending the
      // session without killing its renewal credential would leave them able to.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE.name}=${second.refresh}`)
        .expect(401);
    });

    it('makes the replacement the secret that works', async () => {
      const first = await signIn();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: PLAINTEXT, newSecret: REPLACEMENT })
        .expect(200);

      await expect(
        auth.authenticate({
          email: 'ada@example.test',
          secret: REPLACEMENT,
          client: { address: null, label: null },
        }),
      ).resolves.toMatchObject({ status: 'AUTHENTICATED' });
    });

    it('records the change', async () => {
      const first = await signIn();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: PLAINTEXT, newSecret: REPLACEMENT })
        .expect(200);

      // Read off the store's rows rather than a recording stub, so that this and
      // its negative counterpart below — "records nothing about a change that
      // did not happen" — are measured the same way and one cannot pass while
      // the other is measuring something else.
      expect(
        source.all(AuditEntryRecord).filter((row) => row.action === AuditAction.PASSWORD_CHANGED),
      ).toHaveLength(1);
    });
  });

  describe('when the re-issue itself fails', () => {
    it('leaves the caller neither changed nor signed out', async () => {
      // THE ATOMICITY PROPERTY. This was two statements — change, then re-issue
      // — and everything about that reads correctly while leaving a window two
      // awaits wide in which the password has changed, every session is dead,
      // and the new one has not been written. The person is then signed out of
      // the account they just changed the password on, with the old password no
      // longer working: they cannot get back in with either.
      //
      // The failure is injected at the session insert, which is the last write
      // of the transaction and therefore the only place the old two-statement
      // version could fail *after* committing the change.
      const first = await signIn();
      const realInsert = refuseSessionInserts();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: PLAINTEXT, newSecret: REPLACEMENT })
        .expect(500);

      source.insert = realInsert;

      // Not signed out: the session they came in on is still usable. Asserted
      // FIRST, because `authenticate` opens a session on success and would
      // otherwise be the second one this counts.
      expect(usable()).toHaveLength(1);
      expect(String(usable()[0].id)).toBe(first.sessionId);

      // Not changed: the password they still hold is the one that works.
      await expect(
        auth.authenticate({
          email: 'ada@example.test',
          secret: PLAINTEXT,
          client: { address: null, label: null },
        }),
      ).resolves.toMatchObject({ status: 'AUTHENTICATED' });
      await expect(
        auth.authenticate({
          email: 'ada@example.test',
          secret: REPLACEMENT,
          client: { address: null, label: null },
        }),
      ).resolves.toMatchObject({ status: 'REJECTED' });
    });

    it('records nothing about a change that did not happen', async () => {
      // The least reversible half. `audit_entries` refuses UPDATE and DELETE to
      // the role this process connects as, so a PASSWORD_CHANGED entry written
      // outside the transaction would be a permanent record of something that
      // was rolled back — the defect `resetPassword` shipped once, in the one
      // table nobody can correct.
      const first = await signIn();
      const realInsert = refuseSessionInserts();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: PLAINTEXT, newSecret: REPLACEMENT })
        .expect(500);

      source.insert = realInsert;

      // Read off the store's own rows, not the recording stub: the stub cannot
      // roll back, and rolling back is the property.
      expect(
        source.all(AuditEntryRecord).filter((row) => row.action === AuditAction.PASSWORD_CHANGED),
      ).toEqual([]);
    });

    it('sets no renewal cookie', async () => {
      const first = await signIn();
      const realInsert = refuseSessionInserts();

      const response = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: PLAINTEXT, newSecret: REPLACEMENT })
        .expect(500);

      source.insert = realInsert;

      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('when the current secret is wrong', () => {
    it('refuses, and creates no session doing it', async () => {
      // The ordering fault, from the side that makes it a security defect rather
      // than an inconvenience. With `sessions.begin` moved ahead of
      // `auth.changePassword`, the row is written before the throw — so every
      // failed password-change attempt leaves a live session behind, and a
      // failed attempt is what somebody probing a borrowed session produces.
      const first = await signIn();
      const before = source.all(SessionRecord).length;

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: WRONG, newSecret: REPLACEMENT })
        .expect(401);

      expect(source.all(SessionRecord)).toHaveLength(before);
      expect(usable()).toHaveLength(1);
    });

    it('sets no renewal cookie', async () => {
      const first = await signIn();

      const response = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: WRONG, newSecret: REPLACEMENT })
        .expect(401);

      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('leaves the original secret working', async () => {
      const first = await signIn();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: WRONG, newSecret: REPLACEMENT })
        .expect(401);

      await expect(
        auth.authenticate({
          email: 'ada@example.test',
          secret: PLAINTEXT,
          client: { address: null, label: null },
        }),
      ).resolves.toMatchObject({ status: 'AUTHENTICATED' });
    });

    it('refuses a replacement that breaks the policy without ending anything', async () => {
      const first = await signIn();
      await signIn();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: PLAINTEXT, newSecret: TOO_SHORT })
        .expect(422);

      expect(usable()).toHaveLength(2);
    });

    it('tells the person what was wrong with the password, in prose and in code', async () => {
      // The whole point of `WeakPasswordError` carrying a list. Asserted over the
      // wire and through the shipped translation setup, because that is where it
      // was lost: core built the list, the filter dropped it, and the person was
      // told only that something was wrong with a password they could not see.
      const first = await signIn();

      const response = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: PLAINTEXT, newSecret: TOO_SHORT })
        .expect(422);

      expect(response.body.violations).toEqual([
        { code: 'TOO_SHORT', message: 'Use at least 12 characters' },
      ]);
      // Prose, not a translation key, and the number is the policy's own.
      expect(response.body.violations[0].message).not.toMatch(/^errors\./);
      expect(response.body.violations[0].message).toContain(
        String(DEFAULT_PASSWORD_POLICY.minLength),
      );
      // One reason, so it becomes the message too.
      expect(response.body.message).toBe('Use at least 12 characters');
    });

    it('says nothing about the account, only about the password just typed', async () => {
      // `violations` describes what the person typed and never anything about an
      // account, so it adds no oracle: D7's property is untouched by it.
      const first = await signIn();

      const response = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${first.access}`)
        .send({ currentSecret: PLAINTEXT, newSecret: TOO_SHORT })
        .expect(422);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('ada@example.test');
      expect(body).not.toContain(TOO_SHORT);
      expect(body).not.toContain(PLAINTEXT);
    });
  });
});
