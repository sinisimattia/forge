import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { argon2id, hash as argon2Hash } from 'argon2';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { RecordAuditEntryInput } from '__FORGE_SCOPE__/core/audit/types';
import { AuthenticationRejectionReason, AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import { ConsumedTokenError, ExpiredTokenError } from '__FORGE_SCOPE__/core/auth/errors';
import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import type { IBreachedPasswordRegistry } from '__FORGE_SCOPE__/core/identities/contracts';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { WeakPasswordError } from '__FORGE_SCOPE__/core/identities/errors';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { AuditService } from '../../audit/audit.service';
import { hashOpaqueToken } from '../../common/crypto';
import { AuthIdentityRecord } from '../../identities/auth-identity-record.entity';
import { NoOpBreachedPasswordRegistry } from '../../identities/breached-passwords';
import { ARGON2ID, Argon2PasswordHasher, CURRENT_PARAMS } from '../../identities/hashing';
import type { IPasswordHasher, StoredSecret } from '../../identities/hashing';
import { DUMMY_STORED_SECRET, IdentitiesService } from '../../identities/identities.service';
import type { IMailer, OutboundMessage } from '../../mail';
import { UserRecord } from '../../users/user-record.entity';
import { AuthService } from '../auth.service';
import { EmailVerificationTokenRecord } from '../entities/email-verification-token-record.entity';
import { PasswordResetTokenRecord } from '../entities/password-reset-token-record.entity';
import { RefreshTokenRecord } from '../entities/refresh-token-record.entity';
import { SessionRecord } from '../entities/session-record.entity';
import { SessionService } from '../session/session.service';
import { FakeDataSource } from './fake-data-source';

/**
 * Registration, verification and sign-in.
 *
 * Two of the properties asserted here are invisible in every response body, and
 * they are the ones this file exists for:
 *
 * - **The cost of a failed sign-in does not depend on whether the address is
 *   known.** Asserted by counting derivations and by pinning what the dummy
 *   stored value actually is — not by measuring a response, which would be both
 *   flaky and satisfiable by an implementation that did nothing.
 * - **A derivation produced under weaker parameters is replaced on the next
 *   successful sign-in.** Asserted by reading the stored value back and seeing
 *   it change, not by observing that a method was called.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/** Another one, for the tests that need two. */
const OTHER_PLAINTEXT = 'an entirely different long phrase';

/** One that breaks the policy, for the tests about refusing it. */
const TOO_SHORT_PLAINTEXT = 'short';

/** This suite's signing key. Not a credential: it signs nothing outside this file. */
const SIGNING_KEY = 'auth-service-spec-signing-key';

const WEBAPP_URL = 'https://app.example.test';

const CLIENT: ClientContext = { address: '203.0.113.7', label: 'spec' };

/** Counts what the adapter underneath was asked to do, and forwards everything. */
class CountingHasher implements IPasswordHasher {
  public readonly verified: { secret: string; stored: StoredSecret }[] = [];
  public rehashes = 0;

  public constructor(private readonly inner: IPasswordHasher) {}

  public hash(secret: string): Promise<StoredSecret> {
    return this.inner.hash(secret);
  }

  public verify(secret: string, stored: StoredSecret): Promise<boolean> {
    this.verified.push({ secret, stored });
    return this.inner.verify(secret, stored);
  }

  public needsRehash(stored: StoredSecret): boolean {
    const answer = this.inner.needsRehash(stored);
    if (answer) this.rehashes += 1;
    return answer;
  }
}

describe('AuthService', () => {
  let source: FakeDataSource;
  let auth: AuthService;
  let identities: IdentitiesService;
  let hasher: CountingHasher;
  let sent: OutboundMessage[];
  let recorded: RecordAuditEntryInput[];
  let breached: IBreachedPasswordRegistry;

  const build = (): void => {
    source = new FakeDataSource();
    sent = [];
    recorded = [];
    hasher = new CountingHasher(new Argon2PasswordHasher());
    breached = new NoOpBreachedPasswordRegistry();

    const mailer: IMailer = {
      send: async (message) => {
        sent.push(message);
      },
    };
    const audit = {
      record: async (input: RecordAuditEntryInput) => {
        recorded.push(input);
      },
    } as unknown as AuditService;

    // The fake stores plain rows, so it is handed over as the repository type the
    // service asks for. The cast is confined to this one helper rather than
    // repeated at each of the six call sites below.
    const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
      source.getRepository(entity) as unknown as Repository<T>;

    identities = new IdentitiesService(repo<AuthIdentityRecord>(AuthIdentityRecord), hasher);

    const sessions = new SessionService(
      repo<SessionRecord>(SessionRecord),
      repo<RefreshTokenRecord>(RefreshTokenRecord),
      new JwtService({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      source as unknown as DataSource,
    );

    auth = new AuthService(
      repo<UserRecord>(UserRecord),
      repo<EmailVerificationTokenRecord>(EmailVerificationTokenRecord),
      repo<PasswordResetTokenRecord>(PasswordResetTokenRecord),
      identities,
      sessions,
      audit,
      source as unknown as DataSource,
      mailer,
      breached,
      new ConfigService({ PUBLIC_WEBAPP_URL: WEBAPP_URL }),
    );
  };

  beforeEach(build);

  /** Registers, then proves the address, leaving an account that can sign in. */
  const registerAndVerify = async (email: string, secret = PLAINTEXT): Promise<string> => {
    await auth.register({ email, displayName: 'Ada Lovelace', secret });
    const credential = credentialFromLastLink();
    await auth.verifyEmail(credential);
    return credential;
  };

  /** Pulls the single-use value out of whatever link was last mailed. */
  const credentialFromLastLink = (): string => {
    const body = sent[sent.length - 1].body;
    const match = /token=([A-Za-z0-9_-]+)/.exec(body);
    if (match === null) throw new Error(`no credential in the last message: ${body}`);
    return match[1];
  };

  describe('register', () => {
    it('refuses a secret that breaks the policy, and reports every violation at once', async () => {
      await expect(
        auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: TOO_SHORT_PLAINTEXT }),
      ).rejects.toBeInstanceOf(WeakPasswordError);
    });

    it('refuses it before touching the database, so no row and no message exist', async () => {
      await auth
        .register({ email: 'ada@example.test', displayName: 'Ada', secret: TOO_SHORT_PLAINTEXT })
        .catch(() => undefined);

      // The order in `register` is the property: a policy failure decided after
      // the lookup would take a different time for a known address than for an
      // unknown one, and the refusal is the same either way.
      expect(source.all(UserRecord)).toEqual([]);
      expect(sent).toEqual([]);
    });

    it('refuses a secret the registry reports as already public', async () => {
      // The shipped registry answers `false` to everything (ADR-0008), so this is
      // the only way to reach the branch at all — and the branch has to work for
      // whoever binds a real corpus.
      breached.isKnownBreached = async () => true;

      await expect(
        auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(source.all(UserRecord)).toEqual([]);
    });

    it('creates an ACTIVE, UNVERIFIED, PLATFORM_USER account and its password identity', async () => {
      await auth.register({ email: '  Ada@Example.TEST ', displayName: '  Ada  ', secret: PLAINTEXT });

      expect(source.all(UserRecord)).toHaveLength(1);
      expect(source.all(UserRecord)[0]).toMatchObject({
        // The stored form is the normal one, which is what the unique constraint
        // is on: without it `Ada@Example.TEST` and `ada@example.test` are two
        // accounts, and the second is a way to reach what the first reached.
        email: 'ada@example.test',
        displayName: 'Ada',
        status: UserStatus.ACTIVE,
        platformRole: PlatformRole.PLATFORM_USER,
        emailVerifiedAt: null,
      });
      expect(source.all(AuthIdentityRecord)[0]).toMatchObject({
        provider: AuthProvider.PASSWORD,
        providerAccountId: 'ada@example.test',
        secretAlgorithm: ARGON2ID,
      });
    });

    it('stores a derivation of the secret and never the secret', async () => {
      await auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT });

      const stored = JSON.stringify(source.all(AuthIdentityRecord));
      expect(stored).not.toContain(PLAINTEXT);
      expect(source.all(AuthIdentityRecord)[0].secretHash).toMatch(/^\$argon2id\$/);
    });

    it('sends a verification message carrying a link to the configured origin', async () => {
      await auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT });

      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe('ada@example.test');
      expect(sent[0].body).toContain(`${WEBAPP_URL}/verify-email?token=`);
    });

    it('stores only a hash of the verification credential, never the credential', async () => {
      await auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT });
      const credential = credentialFromLastLink();

      const rows = source.all(EmailVerificationTokenRecord);
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toBe(hashOpaqueToken(credential));
      expect(JSON.stringify(rows)).not.toContain(credential);
    });

    describe('when the address already has an account', () => {
      beforeEach(async () => {
        await auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT });
        sent.length = 0;
        recorded.length = 0;
      });

      it('resolves, exactly as it does for an address nobody has used', async () => {
        await expect(
          auth.register({
            email: 'ada@example.test',
            displayName: 'Somebody Else',
            secret: OTHER_PLAINTEXT,
          }),
        ).resolves.toBeUndefined();
      });

      it('creates no second account and changes nothing about the first', async () => {
        const before = JSON.stringify(source.all(UserRecord));

        await auth.register({
          email: 'ada@example.test',
          displayName: 'Somebody Else',
          secret: OTHER_PLAINTEXT,
        });

        expect(source.all(UserRecord)).toHaveLength(1);
        expect(JSON.stringify(source.all(UserRecord))).toBe(before);
      });

      it('sends the owner a message that carries no credential and no acting link', async () => {
        await auth.register({
          email: 'ada@example.test',
          displayName: 'Somebody Else',
          secret: OTHER_PLAINTEXT,
        });

        expect(sent).toHaveLength(1);
        // Whoever typed somebody else's address into a registration form must not
        // be able to have a working credential mailed to that address.
        expect(sent[0].body).not.toContain('token=');
        expect(source.all(EmailVerificationTokenRecord)).toHaveLength(1);
      });

      it('records which of the two happened, because the server knows', async () => {
        await auth.register({
          email: 'ada@example.test',
          displayName: 'Somebody Else',
          secret: OTHER_PLAINTEXT,
        });

        expect(recorded.map((entry) => entry.action)).toEqual([
          AuditAction.EMAIL_VERIFICATION_REQUESTED,
        ]);
        expect(recorded[0].metadata).toMatchObject({ outcome: 'address-already-registered' });
      });
    });
  });

  describe('verifyEmail', () => {
    it('marks the address proven and the credential consumed', async () => {
      await registerAndVerify('ada@example.test');

      expect(source.all(UserRecord)[0].emailVerifiedAt).toBeInstanceOf(Date);
      expect(source.all(EmailVerificationTokenRecord)[0].consumedAt).toBeInstanceOf(Date);
      expect(recorded.map((entry) => entry.action)).toContain(AuditAction.EMAIL_VERIFIED);
    });

    it('tells a second presentation apart from an expired one', async () => {
      const credential = await registerAndVerify('ada@example.test');

      // Only somebody who held a real credential can reach this answer, so
      // distinguishing it reveals nothing to a guesser — and it is the
      // difference between "try again" and "you already did this".
      await expect(auth.verifyEmail(credential)).rejects.toBeInstanceOf(ConsumedTokenError);
    });

    it('answers a credential nobody issued the same way as one that ran out', async () => {
      await expect(auth.verifyEmail('a-value-nobody-was-ever-given')).rejects.toBeInstanceOf(
        ExpiredTokenError,
      );

      await auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT });
      source.update(
        EmailVerificationTokenRecord,
        {},
        { expiresAt: new Date('2020-01-01T00:00:00.000Z') },
      );

      await expect(auth.verifyEmail(credentialFromLastLink())).rejects.toBeInstanceOf(
        ExpiredTokenError,
      );
    });

    it('lets only one of two simultaneous presentations succeed', async () => {
      await auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT });
      const credential = credentialFromLastLink();

      const outcomes = await Promise.allSettled([
        auth.verifyEmail(credential),
        auth.verifyEmail(credential),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    });
  });

  describe('authenticate', () => {
    beforeEach(async () => {
      await registerAndVerify('ada@example.test');
      hasher.verified.length = 0;
      recorded.length = 0;
    });

    it('proves an account and opens a session', async () => {
      const outcome = await auth.authenticate({
        email: 'ada@example.test',
        secret: PLAINTEXT,
        client: CLIENT,
      });

      expect(outcome.status).toBe(AuthenticationStatus.AUTHENTICATED);
      expect(source.all(SessionRecord)).toHaveLength(1);
      expect(source.all(RefreshTokenRecord)).toHaveLength(1);
      expect(recorded.map((entry) => entry.action)).toContain(AuditAction.LOGIN_SUCCEEDED);
    });

    it('answers a failed attempt rather than throwing', async () => {
      await expect(
        auth.authenticate({ email: 'nobody@example.test', secret: PLAINTEXT, client: CLIENT }),
      ).resolves.toMatchObject({ status: AuthenticationStatus.REJECTED });
    });

    it('records why it failed, for each of the reasons, without returning it', async () => {
      const reject = async (email: string, secret: string) => {
        recorded.length = 0;
        await auth.authenticate({ email, secret, client: CLIENT });
        return recorded.find((entry) => entry.action === AuditAction.LOGIN_FAILED)?.metadata;
      };

      expect(await reject('nobody@example.test', PLAINTEXT)).toMatchObject({
        reason: AuthenticationRejectionReason.UNKNOWN_ACCOUNT,
      });
      expect(await reject('ada@example.test', OTHER_PLAINTEXT)).toMatchObject({
        reason: AuthenticationRejectionReason.INVALID_SECRET,
      });
    });

    describe('the cost of a failed attempt does not reveal whether the address is known', () => {
      // These assertions are the reason `IdentitiesService.spendVerificationOnNobody`
      // exists. Nothing about a response body can catch its removal: the bodies
      // are identical already. What changes is the work, so the work is what is
      // asserted.
      it('spends exactly one derivation on an address that has no account', async () => {
        await auth.authenticate({
          email: 'nobody@example.test',
          secret: PLAINTEXT,
          client: CLIENT,
        });

        expect(hasher.verified).toHaveLength(1);
        // Against the same secret the person offered, so the work done is a
        // function of the same input a real verification would have had.
        expect(hasher.verified[0].secret).toBe(PLAINTEXT);
      });

      it('spends exactly one derivation on an address that does have one', async () => {
        await auth.authenticate({
          email: 'ada@example.test',
          secret: OTHER_PLAINTEXT,
          client: CLIENT,
        });

        expect(hasher.verified).toHaveLength(1);
      });

      it('verifies the unknown address against a real argon2id value at current cost', async () => {
        // Without this the test above is vacuous. `Argon2PasswordHasher.verify`
        // answers `false` immediately for a stored value it cannot parse, so a
        // nonsense dummy would still be "one call" and would still take no time.
        expect(DUMMY_STORED_SECRET.algorithm).toBe(ARGON2ID);
        expect(DUMMY_STORED_SECRET.hash).toMatch(
          new RegExp(
            `^\\$argon2id\\$v=19\\$m=${CURRENT_PARAMS.memoryCost},`
            + `t=${CURRENT_PARAMS.timeCost},p=${CURRENT_PARAMS.parallelism}\\$`,
          ),
        );
      });

      it('actually pays for that derivation', async () => {
        const started = Date.now();
        await auth.authenticate({
          email: 'nobody@example.test',
          secret: PLAINTEXT,
          client: CLIENT,
        });
        const elapsed = Date.now() - started;

        // A LOWER bound, which is the direction that cannot be flaky: a real
        // derivation at these parameters takes tens of milliseconds and a slow
        // machine only makes it longer, while the failure this catches — no
        // derivation at all — returns in microseconds. An upper bound here would
        // be the flaky assertion, and there is deliberately none.
        expect(elapsed).toBeGreaterThan(5);
      });
    });

    it('refuses an unverified account, and only after proving the secret', async () => {
      await auth.register({ email: 'grace@example.test', displayName: 'Grace', secret: PLAINTEXT });
      hasher.verified.length = 0;

      const outcome = await auth.authenticate({
        email: 'grace@example.test',
        secret: PLAINTEXT,
        client: CLIENT,
      });

      expect(outcome).toEqual({
        status: AuthenticationStatus.REJECTED,
        reason: AuthenticationRejectionReason.EMAIL_NOT_VERIFIED,
      });
      // The derivation happened. Checking the account's state first would answer
      // an unverified account faster than a verified one with a wrong secret,
      // which tells a stranger the address is registered.
      expect(hasher.verified).toHaveLength(1);
      expect(source.all(SessionRecord)).toEqual([]);
    });

    it('records the most permanent applicable state, not the first that applies', async () => {
      source.update(
        UserRecord,
        { email: 'ada@example.test' },
        { status: UserStatus.SUSPENDED, emailVerifiedAt: null },
      );

      const outcome = await auth.authenticate({
        email: 'ada@example.test',
        secret: PLAINTEXT,
        client: CLIENT,
      });

      // Core's order, on `AuthenticationRejectionReason`: recording
      // EMAIL_NOT_VERIFIED here would tell whoever reads the entry to verify the
      // address and get in, which is false, and they act on it.
      expect(outcome).toMatchObject({
        reason: AuthenticationRejectionReason.ACCOUNT_SUSPENDED,
      });
    });

    it('records deletion ahead of suspension, which is the other edge of that order', async () => {
      // All three states at once, which is the only arrangement that pins the
      // whole order rather than one of its two edges. Verifying the address or
      // lifting the suspension would change nothing about a deleted account, so
      // deletion is the only remedy that is the real one.
      source.update(
        UserRecord,
        { email: 'ada@example.test' },
        { status: UserStatus.SUSPENDED, emailVerifiedAt: null, deletedAt: new Date() },
      );

      await expect(
        auth.authenticate({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT }),
      ).resolves.toMatchObject({ reason: AuthenticationRejectionReason.ACCOUNT_DELETED });
    });

    it('re-derives a secret stored under weaker parameters, on the next sign-in', async () => {
      // Spec §9.3's rehash-on-login. The row is rewritten to look like one
      // produced before the deployment raised its cost parameters.
      const weak = { memoryCost: 8192, timeCost: 2, parallelism: 1 };
      const before = await argon2Hash(PLAINTEXT, { type: argon2id, ...weak });
      source.update(
        AuthIdentityRecord,
        { provider: AuthProvider.PASSWORD },
        { secretHash: before, secretAlgorithm: ARGON2ID, secretParams: weak },
      );

      const outcome = await auth.authenticate({
        email: 'ada@example.test',
        secret: PLAINTEXT,
        client: CLIENT,
      });

      expect(outcome.status).toBe(AuthenticationStatus.AUTHENTICATED);
      const stored = source.all(AuthIdentityRecord)[0];
      // The STORED VALUE is read back. Asserting that `needsRehash` was consulted
      // would pass against an implementation that consulted it and did nothing,
      // which is the whole failure mode: the capability exists (Task 9 built it)
      // and nothing forced anybody to act on it.
      expect(stored.secretParams).toEqual({ ...CURRENT_PARAMS });
      expect(stored.secretHash).not.toBe(before);
      expect(stored.secretHash as string).toContain(`m=${CURRENT_PARAMS.memoryCost}`);
    });

    it('leaves a derivation already at the current parameters alone', async () => {
      const before = source.all(AuthIdentityRecord)[0].secretHash;

      await auth.authenticate({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT });

      // Re-deriving an up-to-date value would replace a good stored value with
      // another good one on every single sign-in, for nothing.
      expect(source.all(AuthIdentityRecord)[0].secretHash).toBe(before);
    });

    it('signs in with the address typed in a different case', async () => {
      // The stored account identifier is the normal form, so the lookup has to
      // normalize what it is given or an account becomes unreachable from the
      // address its owner actually types.
      const outcome = await auth.authenticate({
        email: '  ADA@Example.TEST ',
        secret: PLAINTEXT,
        client: CLIENT,
      });

      expect(outcome.status).toBe(AuthenticationStatus.AUTHENTICATED);
    });

    it('records when the identity was last used successfully', async () => {
      expect(source.all(AuthIdentityRecord)[0].lastUsedAt).toBeNull();

      await auth.authenticate({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT });

      expect(source.all(AuthIdentityRecord)[0].lastUsedAt).toBeInstanceOf(Date);
    });

    it('never writes the secret, or any credential, to the audit log', async () => {
      await auth.authenticate({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT });
      await auth.authenticate({ email: 'ada@example.test', secret: OTHER_PLAINTEXT, client: CLIENT });

      const written = JSON.stringify(recorded);
      expect(written).not.toContain(PLAINTEXT);
      expect(written).not.toContain(OTHER_PLAINTEXT);
      for (const row of source.all(RefreshTokenRecord)) {
        expect(written).not.toContain(row.tokenHash);
      }
    });
  });

  describe('sessions', () => {
    beforeEach(async () => {
      await registerAndVerify('ada@example.test');
    });

    it('lists only the actor’s usable sessions, newest first', async () => {
      const first = await auth.signIn({
        email: 'ada@example.test',
        secret: PLAINTEXT,
        client: CLIENT,
      });
      await auth.signIn({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT });
      const actorId = source.all(UserRecord)[0].id as UserId;

      expect(await auth.listSessions(actorId)).toHaveLength(2);

      await auth.revokeSession(actorId, first.credentials!.session.id);
      const remaining = await auth.listSessions(actorId);

      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).not.toBe(first.credentials!.session.id);
    });

    it('kills the renewal credentials when a session is ended, not just the session', async () => {
      const opened = await auth.signIn({
        email: 'ada@example.test',
        secret: PLAINTEXT,
        client: CLIENT,
      });
      const actorId = source.all(UserRecord)[0].id as UserId;

      await auth.logout(actorId, opened.credentials!.session.id);

      // Ending the session alone would leave a credential whose `used_at` is
      // null, so a later presentation of it reads as a first use rather than as
      // reuse, and no SESSION_REUSE_DETECTED entry is ever written for it.
      expect(source.all(RefreshTokenRecord).every((row) => row.usedAt !== null)).toBe(true);
      expect(recorded.map((entry) => entry.action)).toContain(AuditAction.LOGGED_OUT);
    });

    it('refuses to end somebody else’s session, indistinguishably from one that is not there', async () => {
      const opened = await auth.signIn({
        email: 'ada@example.test',
        secret: PLAINTEXT,
        client: CLIENT,
      });
      const stranger = '99999999-9999-4999-8999-999999999999' as UserId;

      await expect(
        auth.revokeSession(stranger, opened.credentials!.session.id),
      ).rejects.toMatchObject({ name: 'SessionNotFoundError' });
      await expect(
        auth.revokeSession(stranger, 'no-such-session-at-all' as never),
      ).rejects.toMatchObject({ name: 'SessionNotFoundError' });
    });
  });
});
