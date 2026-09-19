import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { argon2id, hash as argon2Hash } from 'argon2';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { RecordAuditEntryInput } from '__FORGE_SCOPE__/core/audit/types';
import { AuthenticationRejectionReason, AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import {
  ConsumedTokenError,
  ExpiredTokenError,
  InvalidCredentialsError,
} from '__FORGE_SCOPE__/core/auth/errors';
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
import {
  AuthService,
  EMAIL_VERIFICATION_TTL_SECONDS,
  PASSWORD_RESET_TTL_SECONDS,
} from '../auth.service';
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

  /**
   * @param honourLocks - `false` builds a store that accepts `pessimistic_write`
   *   and ignores it, which is the only way to reach the `affected`-count
   *   predicates behind those locks. See `FakeDataSource`.
   */
  const build = (honourLocks = true): void => {
    source = new FakeDataSource(honourLocks);
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

    identities = new IdentitiesService(repo<AuthIdentityRecord>(AuthIdentityRecord), hasher, audit);

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

  beforeEach(() => build());

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
      ).rejects.toMatchObject({ violations: ['BREACHED'] });
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

    it('answers a lost race exactly as it answers an address already taken', async () => {
      // Two registrations for one address, racing. The unique constraints decide
      // it; the loser gets a driver error and must answer the way it would have
      // if it had simply arrived second — silently, with the message that goes
      // to the address. The error is injected rather than raced for real,
      // because the fake enforces no constraints; what is asserted is the
      // branch, which is shipped code.
      const insert = source.insert.bind(source);
      source.insert = (entity, values) => {
        if (entity.name === UserRecord.name) {
          throw Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
          });
        }
        return insert(entity, values);
      };

      await expect(
        auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT }),
      ).resolves.toBeUndefined();

      expect(sent).toHaveLength(1);
      expect(sent[0].body).not.toContain('token=');
      // And it is recorded. Without this the one registration invisible in the
      // history is the one that lost a race — which is the circumstance somebody
      // reads the history to understand.
      expect(recorded.map((entry) => entry.action)).toEqual([
        AuditAction.DUPLICATE_REGISTRATION_ATTEMPTED,
      ]);
      expect(recorded[0].metadata).toMatchObject({ lostRace: true });
    });

    it('lets a driver error that is not a unique violation out', async () => {
      // The race branch is reached by SQLSTATE, not by "an error happened".
      // Swallowing everything here would turn a broken database into a
      // registration that silently did nothing and told the caller it was fine.
      const insert = source.insert.bind(source);
      source.insert = (entity, values) => {
        if (entity.name === UserRecord.name) {
          throw Object.assign(new Error('connection terminated'), { code: '08006' });
        }
        return insert(entity, values);
      };

      await expect(
        auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT }),
      ).rejects.toThrow('connection terminated');
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

        // The action must say what happened. `EMAIL_VERIFICATION_REQUESTED` would
        // be false — no verification was issued and none was sent — and the
        // caller is told nothing, so this entry is the only place the event
        // exists. Asserted against a member, not against "something was
        // recorded", because the failure mode is a true-shaped row with a false
        // action in a table nothing may correct.
        expect(recorded.map((entry) => entry.action)).toEqual([
          AuditAction.DUPLICATE_REGISTRATION_ATTEMPTED,
        ]);
        expect(recorded[0].actorId).toBe(source.all(UserRecord)[0].id);
      });
    });
  });

  /**
   * ## The breach check applies to every path that sets a password
   *
   * It applied to registration alone, which made the control decorative exactly
   * where it matters most: the likeliest reason somebody is completing a
   * recovery is that they believe their credential is already in somebody
   * else's hands. Driven over the three methods by a table rather than written
   * three times, so a fourth path that sets a password is one row away from
   * being covered — and so none of the three can lose the check on its own.
   */
  describe('a password the registry reports as already public', () => {
    /** Registers and verifies with the registry quiet, then makes it answer `true`. */
    const withAPublicReplacement = async (): Promise<UserId> => {
      await registerAndVerify('ada@example.test');
      breached.isKnownBreached = async () => true;
      return source.all(UserRecord)[0].id as UserId;
    };

    it('is refused at registration', async () => {
      breached.isKnownBreached = async () => true;
      await expect(
        auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT }),
      ).rejects.toMatchObject({ violations: ['BREACHED'] });
    });

    it('is refused when a recovery credential is spent on it', async () => {
      await registerAndVerify('ada@example.test');
      await auth.requestPasswordReset('ada@example.test');
      const credential = credentialFromLastLink();
      breached.isKnownBreached = async () => true;

      await expect(auth.resetPassword(credential, OTHER_PLAINTEXT)).rejects.toMatchObject({
        violations: ['BREACHED'],
      });
    });

    it('is refused when the actor changes their own password to it', async () => {
      const actorId = await withAPublicReplacement();

      await expect(
        auth.changePassword(actorId, PLAINTEXT, OTHER_PLAINTEXT),
      ).rejects.toMatchObject({ violations: ['BREACHED'] });
    });

    it('leaves the recovery credential unspent when it refuses', async () => {
      // A refused replacement must not cost the person their only way back in —
      // the same property the policy check already has, now on the same path.
      await registerAndVerify('ada@example.test');
      await auth.requestPasswordReset('ada@example.test');
      const credential = credentialFromLastLink();
      breached.isKnownBreached = async () => true;

      await auth.resetPassword(credential, OTHER_PLAINTEXT).catch(() => undefined);

      expect(source.all(PasswordResetTokenRecord)[0].consumedAt).toBeNull();
    });

    it('leaves the stored secret alone when a change is refused', async () => {
      const actorId = await withAPublicReplacement();
      const before = source.all(AuthIdentityRecord)[0].secretHash;

      await auth.changePassword(actorId, PLAINTEXT, OTHER_PLAINTEXT).catch(() => undefined);

      expect(source.all(AuthIdentityRecord)[0].secretHash).toBe(before);
    });

    it('is asked only after the policy has passed, on all three paths', async () => {
      // The order is load-bearing twice over: a secret that breaks the policy is
      // refused without a lookup that may be slow or remote, and `BREACHED` is
      // therefore never mixed into a list with the other four — so the message a
      // person is shown is about the one thing that is wrong.
      let asked = 0;
      breached.isKnownBreached = async () => {
        asked += 1;
        return true;
      };

      await auth
        .register({ email: 'ada@example.test', displayName: 'Ada', secret: TOO_SHORT_PLAINTEXT })
        .catch(() => undefined);
      expect(asked).toBe(0);

      await registerAndVerify('grace@example.test', OTHER_PLAINTEXT).catch(() => undefined);
      expect(asked).toBeGreaterThan(0);
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

    it('still lets only one succeed against a store that ignores the lock', async () => {
      // The second mechanism behind the lock, isolated: this world accepts the
      // lock request and does nothing with it, so both callers read
      // `consumed_at` as null and the `consumed_at IS NULL` predicate on the
      // consuming statement is all that is left. Without the `affected` count
      // being read, the loser's update matches no row, the method carries on,
      // and a single-use credential has been used twice.
      build(false);
      await auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT });
      const credential = credentialFromLastLink();

      const outcomes = await Promise.allSettled([
        auth.verifyEmail(credential),
        auth.verifyEmail(credential),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
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

  /**
   * ## Written as if the implementation were not there
   *
   * `requestPasswordReset`, `changePassword`, `resendVerification` and
   * `revokeAllSessions` shipped complete and **entirely unexercised**: the class
   * declares `implements IAuthService`, which obliged it to have them before
   * anything wanted them. A complete untested implementation of
   * security-critical code is more dangerous than a stub, because a stub
   * announces that work remains and this reads as done — and the conformance
   * suites in core are driven against this class, so untested behaviour here
   * becomes a claim about the contract.
   *
   * So these were written from `IAuthService`'s own documentation rather than
   * from the code, and each one asserts the thing the documentation promises
   * rather than the thing the code happens to do.
   */
  describe('requestPasswordReset', () => {
    it('resolves for an address nothing answers to, exactly as for one that does', async () => {
      await registerAndVerify('ada@example.test');

      await expect(auth.requestPasswordReset('nobody@example.test')).resolves.toBeUndefined();
      await expect(auth.requestPasswordReset('ada@example.test')).resolves.toBeUndefined();
    });

    it('issues nothing, sends nothing and records nothing for an unknown address', async () => {
      recorded.length = 0;

      await auth.requestPasswordReset('nobody@example.test');

      // All three, because each is a separate way the difference could escape:
      // a row somebody with database access can see, a message, and an entry in
      // a history an administrator reads.
      expect(source.all(PasswordResetTokenRecord)).toEqual([]);
      expect(sent).toEqual([]);
      expect(recorded).toEqual([]);
    });

    it('issues exactly one credential for a known address, and records it', async () => {
      await registerAndVerify('ada@example.test');
      recorded.length = 0;
      sent.length = 0;

      await auth.requestPasswordReset('ada@example.test');

      expect(source.all(PasswordResetTokenRecord)).toHaveLength(1);
      expect(sent).toHaveLength(1);
      expect(recorded.map((entry) => entry.action)).toEqual([
        AuditAction.PASSWORD_RESET_REQUESTED,
      ]);
    });

    it('stores only a hash of the credential, never the credential', async () => {
      await registerAndVerify('ada@example.test');
      await auth.requestPasswordReset('ada@example.test');
      const credential = credentialFromLastLink();

      const row = source.all(PasswordResetTokenRecord)[0];
      expect(row.tokenHash).toBe(hashOpaqueToken(credential));
      // A row that held the value itself would make read access to this table
      // equivalent to holding every outstanding recovery link.
      expect(JSON.stringify(row)).not.toContain(credential);
    });

    it('finds the account through an address typed in a different case', async () => {
      await registerAndVerify('ada@example.test');

      await auth.requestPasswordReset('  Ada@Example.TEST  ');

      // Without normalization here this is silently the unknown-address branch:
      // it resolves, sends nothing, and looks exactly like success.
      expect(source.all(PasswordResetTokenRecord)).toHaveLength(1);
    });

    it('treats an account its owner deleted as no account at all', async () => {
      await registerAndVerify('ada@example.test');
      source.update(UserRecord, { email: 'ada@example.test' }, { deletedAt: new Date() });
      sent.length = 0;
      recorded.length = 0;

      await auth.requestPasswordReset('ada@example.test');

      // Somebody who closed their account and then has their address typed into
      // this endpoint must not hear from the deployment again. Measured before
      // the soft delete existed: it sent them a recovery link.
      expect(sent).toEqual([]);
      expect(recorded).toEqual([]);
      expect(source.all(PasswordResetTokenRecord)).toEqual([]);
    });

    it('issues nothing for an account that has no password identity', async () => {
      // A federated-only account is this case by design. There is no password to
      // recover, so there is nothing to send — and it has to look exactly like
      // the two "nothing to send" cases that already exist.
      await registerAndVerify('ada@example.test');
      source.update(
        AuthIdentityRecord,
        { provider: AuthProvider.PASSWORD },
        { provider: AuthProvider.GOOGLE },
      );
      sent.length = 0;
      recorded.length = 0;

      await expect(auth.requestPasswordReset('ada@example.test')).resolves.toBeUndefined();

      expect(sent).toEqual([]);
      expect(recorded).toEqual([]);
      expect(source.all(PasswordResetTokenRecord)).toEqual([]);
    });

    it('gives the credential a lifetime much shorter than a verification link', async () => {
      await registerAndVerify('ada@example.test');

      await auth.requestPasswordReset('ada@example.test');

      const row = source.all(PasswordResetTokenRecord)[0];
      // Measured between the row's OWN two instants, not against a clock this
      // test read. `const before = Date.now()` taken before the call was a
      // knife edge: the service captures its own `now` afterwards, so the
      // interval came out as `TTL + delta` and the assertion failed the moment
      // one millisecond elapsed — reproduced 1 run in 8 under parallel load,
      // `Expected: <= 3600000 / Received: 3600002`. A flaky assertion about a
      // security property in a shipped template teaches every generated
      // project's team to re-run CI until it passes.
      const life = (row.expiresAt as Date).getTime() - (row.createdAt as Date).getTime();
      expect(life).toBe(PASSWORD_RESET_TTL_SECONDS * 1000);
      // A literal ceiling as well as the constant, because this credential
      // replaces a password without proving anything else and sits in a mailbox
      // for as long as it stands.
      expect(PASSWORD_RESET_TTL_SECONDS).toBeLessThanOrEqual(24 * 60 * 60);
      expect(PASSWORD_RESET_TTL_SECONDS).toBeLessThan(EMAIL_VERIFICATION_TTL_SECONDS);
    });
  });

  describe('changePassword', () => {
    const actorId = (): UserId => source.all(UserRecord)[0].id as UserId;

    beforeEach(async () => {
      await registerAndVerify('ada@example.test');
    });

    it('replaces the secret, so the new one works and the old one stops', async () => {
      await auth.changePassword(actorId(), PLAINTEXT, OTHER_PLAINTEXT);

      await expect(
        auth.authenticate({ email: 'ada@example.test', secret: OTHER_PLAINTEXT, client: CLIENT }),
      ).resolves.toMatchObject({ status: AuthenticationStatus.AUTHENTICATED });
      await expect(
        auth.authenticate({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT }),
      ).resolves.toMatchObject({ status: AuthenticationStatus.REJECTED });
    });

    it('refuses a wrong current secret', async () => {
      await expect(
        auth.changePassword(actorId(), 'not the secret they chose', OTHER_PLAINTEXT),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('leaves the secret alone when it refuses — a refusal that changed it is none', async () => {
      const before = source.all(AuthIdentityRecord)[0].secretHash;

      await auth
        .changePassword(actorId(), 'not the secret they chose', OTHER_PLAINTEXT)
        .catch(() => undefined);

      expect(source.all(AuthIdentityRecord)[0].secretHash).toBe(before);
      await expect(
        auth.authenticate({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT }),
      ).resolves.toMatchObject({ status: AuthenticationStatus.AUTHENTICATED });
    });

    it('refuses a replacement that breaks the policy', async () => {
      await expect(
        auth.changePassword(actorId(), PLAINTEXT, TOO_SHORT_PLAINTEXT),
      ).rejects.toBeInstanceOf(WeakPasswordError);
      expect(
        (await auth.authenticate({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT }))
          .status,
      ).toBe(AuthenticationStatus.AUTHENTICATED);
    });

    it('refuses an actor with no password identity, indistinguishably from a wrong secret', async () => {
      const stranger = '99999999-9999-4999-8999-999999999999' as UserId;

      // The same error a wrong secret produces. Anything else — a not-found, a
      // different status — is a way to test a user id for having a password.
      await expect(
        auth.changePassword(stranger, PLAINTEXT, OTHER_PLAINTEXT),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('ends the sessions the account held', async () => {
      await auth.signIn({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT });
      await auth.signIn({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT });
      expect(await auth.listSessions(actorId())).toHaveLength(2);

      await auth.changePassword(actorId(), PLAINTEXT, OTHER_PLAINTEXT);

      // Every one of them, including the caller's — this method is given an
      // actor and not a request, so it cannot name the current session. The
      // transport re-issues for the caller it is serving; see
      // `AuthController.changePassword`.
      expect(await auth.listSessions(actorId())).toHaveLength(0);
    });

    it('records the change', async () => {
      recorded.length = 0;

      await auth.changePassword(actorId(), PLAINTEXT, OTHER_PLAINTEXT);

      expect(recorded.map((entry) => entry.action)).toContain(AuditAction.PASSWORD_CHANGED);
    });

    it('never writes either secret to the audit log', async () => {
      recorded.length = 0;

      await auth.changePassword(actorId(), PLAINTEXT, OTHER_PLAINTEXT);

      const written = JSON.stringify(recorded);
      expect(written).not.toContain(PLAINTEXT);
      expect(written).not.toContain(OTHER_PLAINTEXT);
    });
  });

  describe('resendVerification', () => {
    it('resolves for an address nothing answers to, and sends nothing', async () => {
      await registerAndVerify('ada@example.test');
      sent.length = 0;
      recorded.length = 0;

      await expect(auth.resendVerification('nobody@example.test')).resolves.toBeUndefined();

      expect(sent).toEqual([]);
      expect(recorded).toEqual([]);
    });

    it('sends nothing for an address that has already been proven', async () => {
      await registerAndVerify('ada@example.test');
      sent.length = 0;

      await auth.resendVerification('ada@example.test');

      // Nothing to send, and it has to look exactly like a send: an address
      // already proven and an address with no account are both "nothing
      // happens", and telling them apart is the same oracle from a third side.
      expect(sent).toEqual([]);
    });

    it('issues a fresh credential for an account still unproven, and records it', async () => {
      await auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT });
      const first = credentialFromLastLink();
      recorded.length = 0;

      await auth.resendVerification('ada@example.test');

      expect(credentialFromLastLink()).not.toBe(first);
      expect(source.all(EmailVerificationTokenRecord)).toHaveLength(2);
      expect(recorded.map((entry) => entry.action)).toEqual([
        AuditAction.EMAIL_VERIFICATION_REQUESTED,
      ]);
    });

    it('leaves the credential already issued usable', async () => {
      await auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT });
      const first = credentialFromLastLink();

      await auth.resendVerification('ada@example.test');

      // Invalidating the earlier one would mean that asking for a second mail
      // because the first had not arrived breaks the first the moment it does.
      await expect(auth.verifyEmail(first)).resolves.toBeUndefined();
    });

    it('finds the account through an address typed in a different case', async () => {
      await auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT });
      sent.length = 0;

      await auth.resendVerification('  Ada@Example.TEST  ');

      expect(sent).toHaveLength(1);
    });

    it('sends nothing to an account its owner deleted', async () => {
      await auth.register({ email: 'ada@example.test', displayName: 'Ada', secret: PLAINTEXT });
      source.update(UserRecord, { email: 'ada@example.test' }, { deletedAt: new Date() });
      sent.length = 0;

      await auth.resendVerification('ada@example.test');

      expect(sent).toEqual([]);
    });
  });

  describe('revokeAllSessions', () => {
    it('ends every session the actor holds, including the one in use', async () => {
      await registerAndVerify('ada@example.test');
      await auth.signIn({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT });
      await auth.signIn({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT });
      const actorId = source.all(UserRecord)[0].id as UserId;

      await auth.revokeAllSessions(actorId);

      expect(await auth.listSessions(actorId)).toHaveLength(0);
    });

    it('kills the renewal credentials too, not only the sessions', async () => {
      await registerAndVerify('ada@example.test');
      await auth.signIn({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT });
      const actorId = source.all(UserRecord)[0].id as UserId;

      await auth.revokeAllSessions(actorId);

      // Ending the sessions alone leaves a renewal credential whose `used_at` is
      // null, so a later presentation reads as a first use rather than as reuse
      // and no SESSION_REUSE_DETECTED entry is ever written for it.
      expect(source.all(RefreshTokenRecord).every((row) => row.usedAt !== null)).toBe(true);
    });

    it('records how many it ended', async () => {
      await registerAndVerify('ada@example.test');
      await auth.signIn({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT });
      await auth.signIn({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT });
      const actorId = source.all(UserRecord)[0].id as UserId;
      recorded.length = 0;

      await auth.revokeAllSessions(actorId);

      const entry = recorded.find((written) => written.action === AuditAction.ALL_SESSIONS_REVOKED);
      expect(entry).toBeDefined();
      // The count, not merely that it happened: "two sessions were ended" and
      // "no sessions were ended" are the same entry without it, and they mean
      // very different things to whoever reads the history afterwards.
      expect(entry!.metadata).toMatchObject({ ended: 2 });
    });

    it('leaves another account\'s sessions alone', async () => {
      await registerAndVerify('ada@example.test');
      await registerAndVerify('grace@example.test');
      await auth.signIn({ email: 'grace@example.test', secret: PLAINTEXT, client: CLIENT });
      const ada = source.all(UserRecord)[0].id as UserId;
      const grace = source.all(UserRecord)[1].id as UserId;

      await auth.revokeAllSessions(ada);

      expect(await auth.listSessions(grace)).toHaveLength(1);
    });
  });

  describe('resetPassword', () => {
    /** Registers, proves the address, then asks for a reset and returns the credential. */
    const requestReset = async (): Promise<string> => {
      await registerAndVerify('ada@example.test');
      await auth.requestPasswordReset('ada@example.test');
      return credentialFromLastLink();
    };

    it('replaces the secret and ends every session the account held', async () => {
      await registerAndVerify('ada@example.test');
      await auth.signIn({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT });
      await auth.requestPasswordReset('ada@example.test');
      const credential = credentialFromLastLink();
      const before = source.all(AuthIdentityRecord)[0].secretHash;

      await auth.resetPassword(credential, OTHER_PLAINTEXT);

      expect(source.all(AuthIdentityRecord)[0].secretHash).not.toBe(before);
      // Recovery is what somebody does when they have lost control of the
      // account, so a session left alive leaves whoever took it where they were.
      expect(source.all(SessionRecord).every((row) => row.revokedAt !== null)).toBe(true);
      await expect(
        auth.authenticate({ email: 'ada@example.test', secret: OTHER_PLAINTEXT, client: CLIENT }),
      ).resolves.toMatchObject({ status: AuthenticationStatus.AUTHENTICATED });
    });

    it('refuses a replacement that breaks the policy, before consuming anything', async () => {
      const credential = await requestReset();

      await expect(auth.resetPassword(credential, TOO_SHORT_PLAINTEXT)).rejects.toBeInstanceOf(
        WeakPasswordError,
      );
      // The credential must survive a refused replacement, or one mistyped
      // password costs the person their only way back into the account.
      expect(source.all(PasswordResetTokenRecord)[0].consumedAt).toBeNull();
    });

    it('tells a second presentation apart from an expired one', async () => {
      const credential = await requestReset();
      await auth.resetPassword(credential, OTHER_PLAINTEXT);

      await expect(auth.resetPassword(credential, PLAINTEXT)).rejects.toBeInstanceOf(
        ConsumedTokenError,
      );
    });

    it('refuses a credential whose account lost its password identity, as an invalid one', async () => {
      // Reachable only by unlinking between issue and redeem, which
      // `requestPasswordReset`'s own refusal cannot cover. What matters is what
      // it does NOT do: the implementation this replaces consumed the
      // credential, revoked every session, wrote PASSWORD_RESET_COMPLETED and
      // stored no password — reporting success for something that did not
      // happen, into a table that physically refuses UPDATE and DELETE.
      await registerAndVerify('ada@example.test');
      await auth.requestPasswordReset('ada@example.test');
      const credential = credentialFromLastLink();
      await auth.signIn({ email: 'ada@example.test', secret: PLAINTEXT, client: CLIENT });
      source.update(
        AuthIdentityRecord,
        { provider: AuthProvider.PASSWORD },
        { provider: AuthProvider.GOOGLE },
      );
      recorded.length = 0;

      await expect(auth.resetPassword(credential, OTHER_PLAINTEXT)).rejects.toBeInstanceOf(
        ExpiredTokenError,
      );

      // Consumed nothing.
      expect(source.all(PasswordResetTokenRecord)[0].consumedAt).toBeNull();
      // Recorded nothing — least reversible of the three, and the reason the
      // identity is resolved before the credential is spent rather than after.
      expect(recorded).toEqual([]);
      // Ended nothing.
      expect(source.all(SessionRecord).every((row) => row.revokedAt === null)).toBe(true);
    });

    it('still lets only one of two simultaneous presentations succeed against a store that ignores the lock', async () => {
      // The `affected`-count predicate, isolated exactly as in `verifyEmail`.
      // The consequence here is larger: two replacements from one mail, the
      // second of which the account's owner did not ask for.
      build(false);
      const credential = await requestReset();

      const outcomes = await Promise.allSettled([
        auth.resetPassword(credential, OTHER_PLAINTEXT),
        auth.resetPassword(credential, PLAINTEXT),
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
