import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { AuthenticationRejectionReason } from '__FORGE_SCOPE__/core/auth/enums';
import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { AuthIdentityId, FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditEntryRecord } from '../../../audit/audit-entry-record.entity';
import { AuditService } from '../../../audit/audit.service';
import { hashOpaqueToken } from '../../../common/crypto';
import { FakeDataSource } from '../../../common/testing';
import { AuthIdentityRecord } from '../../../identities/auth-identity-record.entity';
import { Argon2PasswordHasher } from '../../../identities/hashing';
import { IdentitiesService } from '../../../identities/identities.service';
import { MembershipRecord } from '../../../organizations/membership-record.entity';
import { UserRecord } from '../../../users/user-record.entity';
import { RefreshTokenRecord } from '../../entities/refresh-token-record.entity';
import { SessionRecord } from '../../entities/session-record.entity';
import { SessionService } from '../../session/session.service';
import type { ExchangeParams, IOAuthProvider } from '../IOAuthProvider';
import { OAuthAuthorizationRequestRecord } from '../oauth-authorization-request.entity';
import { OAuthProviderRegistry } from '../oauth-provider.registry';
import { OAuthAuthorizationPurpose, OAuthService } from '../oauth.service';

const PUBLIC_API_URL = 'https://api.example.test';
const STATE = 'the-state-value';
const CODE = 'the-authorization-code';
const CLIENT: ClientContext = { address: '203.0.113.9', label: 'test-client' };

/** This harness's signing key. Not a credential: it signs nothing outside this spec. */
const SIGNING_KEY = 'complete-spec-signing-key';

/** An adapter whose `fetchAccount` is swapped out per test. `authorizationUrl` is never called here. */
function fakeProvider(
  provider: AuthProvider,
  fetchAccount: (params: ExchangeParams) => Promise<FederatedAccount>,
): IOAuthProvider {
  return {
    provider,
    authorizationUrl: async (): Promise<string> => {
      throw new Error('not called by this suite — complete() never builds an authorization URL');
    },
    fetchAccount,
  };
}

/** A well-formed federated assertion, overridable field by field. */
function account(overrides: Partial<FederatedAccount> = {}): FederatedAccount {
  return {
    provider: AuthProvider.GOOGLE,
    subject: 'subject-1',
    email: 'ada@example.test',
    emailVerified: true,
    displayName: 'Ada Lovelace',
    ...overrides,
  };
}

/**
 * # Completing an authorization
 *
 * ## What `FakeDataSource` cannot see
 *
 * It enforces no unique constraint on `state_hash` or on
 * `(provider, provider_account_id)`, and it has no foreign key from
 * `oauth_authorization_requests.user_id` or `auth_identities.user_id` to
 * `users` — see `common/testing/fake-data-source.ts`'s own numbered list,
 * items 4 and 7. Nothing below asserts that two concurrent completions of
 * *different* authorizations racing to link the same subject could not both
 * win, or that a deleted account's authorization rows and identities are
 * gone with it; both are schema-level guarantees the migrations carry
 * (`ON DELETE CASCADE`, `uq_oauth_authorization_requests_state`,
 * `uq_auth_identities_provider_account`) and only a real Postgres can
 * demonstrate. `oauth.service.begin.spec.ts` says the same about `begin`;
 * it is said again here because `complete` is where those two unique
 * constraints would actually be reached.
 */
describe('OAuthService.complete', () => {
  let source: FakeDataSource;
  let service: OAuthService;
  let requests: Repository<OAuthAuthorizationRequestRecord>;
  let users: Repository<UserRecord>;
  let identities: IdentitiesService;
  let audit: AuditService;

  let googleFetchAccount: (params: ExchangeParams) => Promise<FederatedAccount>;
  let githubFetchAccount: (params: ExchangeParams) => Promise<FederatedAccount>;

  let userSeq = 0;

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  const auditOf = (action: AuditAction): Record<string, unknown>[] =>
    source.all(AuditEntryRecord).filter((row) => row.action === action);

  const seedRow = async (overrides: {
    stateHash?: string;
    codeVerifier?: string;
    provider?: AuthProvider;
    purpose?: string;
    userId?: string | null;
    redirectTo?: string | null;
    expiresAt?: Date;
    consumedAt?: Date | null;
  } = {}): Promise<void> => {
    const now = new Date();
    await requests.insert({
      stateHash: overrides.stateHash ?? hashOpaqueToken(STATE),
      codeVerifier: overrides.codeVerifier ?? 'verifier-value',
      provider: overrides.provider ?? AuthProvider.GOOGLE,
      purpose: overrides.purpose ?? OAuthAuthorizationPurpose.SIGN_IN,
      userId: overrides.userId ?? null,
      redirectTo: overrides.redirectTo ?? null,
      createdAt: now,
      expiresAt: overrides.expiresAt ?? new Date(now.getTime() + 10 * 60 * 1000),
      consumedAt: overrides.consumedAt ?? null,
    });
  };

  const seedUser = async (overrides: {
    email?: string;
    status?: UserStatus;
    emailVerifiedAt?: Date | null;
    deletedAt?: Date | null;
  } = {}): Promise<UserId> => {
    const now = new Date();
    userSeq += 1;
    const inserted = await users.insert({
      email: overrides.email ?? `user-${userSeq}@example.test`,
      displayName: `Test User ${userSeq}`,
      status: overrides.status ?? UserStatus.ACTIVE,
      platformRole: PlatformRole.PLATFORM_USER,
      emailVerifiedAt: overrides.emailVerifiedAt === undefined ? now : overrides.emailVerifiedAt,
      createdAt: now,
      updatedAt: now,
      deletedAt: overrides.deletedAt ?? null,
    });
    return inserted.identifiers[0].id as UserId;
  };

  const seedIdentity = async (
    userId: UserId,
    provider: AuthProvider,
    subject: string,
    at: Date = new Date(),
  ): Promise<AuthIdentityId> => {
    const identity = await (source as unknown as DataSource).transaction((manager) =>
      identities.createFederatedIdentityIn(manager, userId, provider, subject, at));
    return identity.id as AuthIdentityId;
  };

  beforeEach(() => {
    source = new FakeDataSource();
    requests = repo<OAuthAuthorizationRequestRecord>(OAuthAuthorizationRequestRecord);
    users = repo<UserRecord>(UserRecord);

    audit = new AuditService(
      repo<AuditEntryRecord>(AuditEntryRecord),
      users,
      repo<MembershipRecord>(MembershipRecord),
    );
    identities = new IdentitiesService(
      repo<AuthIdentityRecord>(AuthIdentityRecord),
      new Argon2PasswordHasher(),
      audit,
    );
    const sessions = new SessionService(
      repo<SessionRecord>(SessionRecord),
      repo<RefreshTokenRecord>(RefreshTokenRecord),
      new JwtService({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      source as unknown as DataSource,
    );

    googleFetchAccount = async () => account();
    githubFetchAccount = async (): Promise<FederatedAccount> => {
      throw new Error('not called in this suite');
    };
    const registry = new OAuthProviderRegistry([
      fakeProvider(AuthProvider.GOOGLE, (params) => googleFetchAccount(params)),
      fakeProvider(AuthProvider.GITHUB, (params) => githubFetchAccount(params)),
    ]);

    service = new OAuthService(
      requests,
      users,
      registry,
      identities,
      sessions,
      audit,
      source as unknown as DataSource,
      new ConfigService({ PUBLIC_API_URL }),
    );
  });

  it('refuses an unregistered provider before reading anything', async () => {
    // A row for this exact state DOES exist — the point of this test is that
    // it is never touched. Asserting only that no row exists (as an earlier
    // draft did) is a check that cannot fail: nothing in `complete` ever
    // inserts a row, so an empty table proves nothing about ordering.
    await seedRow();

    const result = await service.complete('OIDC', CODE, STATE, CLIENT);

    expect(result).toEqual({ status: 'REFUSED', code: 'PROVIDER_UNAVAILABLE', redirectTo: null });
    expect(source.all(OAuthAuthorizationRequestRecord)[0].consumedAt).toBeNull();
  });

  describe('the authorization row', () => {
    it('refuses a state nothing answers to', async () => {
      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);
      expect(result).toEqual({ status: 'REFUSED', code: 'AUTHORIZATION_UNKNOWN', redirectTo: null });
    });

    it('refuses a state whose authorization has expired', async () => {
      await seedRow({ expiresAt: new Date(Date.now() - 1000), redirectTo: '/came-from-here' });

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      // The row's own redirectTo is echoed back even on a refusal — see
      // `CompletedAuthorization`'s own TSDoc — which this case is also the
      // one to prove, since the two "no row at all" cases above and below it
      // have nothing to echo.
      expect(result).toEqual({
        status: 'REFUSED', code: 'AUTHORIZATION_EXPIRED', redirectTo: '/came-from-here',
      });
    });

    it('refuses a state that has already been consumed, and does not echo its redirectTo', async () => {
      // redirectTo is deliberately non-null here, and the assertion below is
      // that it does NOT come back: AUTHORIZATION_UNKNOWN has to be the same
      // answer whether or not a row was ever found, on every field, or
      // whoever presents a state learns a row existed exactly when the "no
      // row at all" case wouldn't disclose that.
      await seedRow({ consumedAt: new Date(), redirectTo: '/somewhere' });

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      // Not a distinct "already used" code — there is none in
      // `FederatedRefusalCode` — a consumed row answers exactly as a row
      // that never existed would.
      expect(result).toEqual({ status: 'REFUSED', code: 'AUTHORIZATION_UNKNOWN', redirectTo: null });
    });

    it('marks the authorization consumed before the exchange, not after', async () => {
      await seedRow();
      googleFetchAccount = async (): Promise<FederatedAccount> => {
        throw new Error('provider outage — this text must never reach the caller');
      };

      const first = await service.complete('GOOGLE', CODE, STATE, CLIENT);
      expect(first).toEqual({ status: 'REFUSED', code: 'PROVIDER_UNAVAILABLE', redirectTo: null });

      const rows = source.all(OAuthAuthorizationRequestRecord);
      expect(rows).toHaveLength(1);
      expect(rows[0].consumedAt).not.toBeNull();

      // A second presentation of the exact same state, after the first
      // attempt's exchange threw, must not find the row still presentable —
      // that is the whole of "consumed-then-exchanged survives a throw".
      const second = await service.complete('GOOGLE', CODE, STATE, CLIENT);
      expect(second).toEqual({ status: 'REFUSED', code: 'AUTHORIZATION_UNKNOWN', redirectTo: null });
    });

    it('refuses a callback arriving at a provider other than the one it began at', async () => {
      // The row was issued for GOOGLE. This callback presents the same state
      // at GITHUB's — a provider this deployment did register, so the
      // registry lookup itself succeeds and the refusal has to come from
      // comparing against the row. redirectTo is non-null for the same
      // reason the "already consumed" case sets one: to prove it is not
      // echoed, not merely to leave it at its default.
      await seedRow({ provider: AuthProvider.GOOGLE, redirectTo: '/somewhere' });

      const result = await service.complete('GITHUB', CODE, STATE, CLIENT);

      expect(result).toEqual({ status: 'REFUSED', code: 'AUTHORIZATION_UNKNOWN', redirectTo: null });
      // githubFetchAccount throws unconditionally (see beforeEach) — if this
      // assertion above had instead been PROVIDER_UNAVAILABLE, that would be
      // evidence the exchange ran anyway and this test would need to inspect
      // whether it threw; it does not need to, because the row itself was
      // never marked consumed by a provider that was never asked.
      expect(source.all(OAuthAuthorizationRequestRecord)[0].consumedAt).toBeNull();
    });
  });

  describe('the exchange', () => {
    it('never returns the provider\'s own error text', async () => {
      await seedRow();
      googleFetchAccount = async (): Promise<FederatedAccount> => {
        throw new Error('super secret internal diagnostic string from the provider');
      };

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      expect(result).toEqual({ status: 'REFUSED', code: 'PROVIDER_UNAVAILABLE', redirectTo: null });
      expect(JSON.stringify(result)).not.toContain('secret internal diagnostic');
    });
  });

  describe('signing in', () => {
    it('signs in the account the subject is already linked to, and issues a session', async () => {
      const userId = await seedUser({ email: 'ada@example.test' });
      await seedIdentity(userId, AuthProvider.GOOGLE, 'subject-1');
      await seedRow({ redirectTo: '/dashboard' });

      let captured: ExchangeParams | undefined;
      googleFetchAccount = async (params) => {
        captured = params;
        // D11's first rule: an already-linked subject signs in
        // unconditionally, before any address is even looked at. The
        // asserted address here belongs to nobody and is not even verified —
        // and it still has to sign in.
        return account({ subject: 'subject-1', email: null, emailVerified: false });
      };

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      expect(result.status).toBe('SIGNED_IN');
      if (result.status !== 'SIGNED_IN') throw new Error('unreachable');
      expect(result.credentials.accessToken).toEqual(expect.any(String));
      expect(result.redirectTo).toBe('/dashboard');
      expect(source.all(SessionRecord)).toHaveLength(1);

      // The exchange itself is wired correctly: the verifier this row stored
      // and the redirect URI this callback arrived at, not anything else.
      expect(captured?.codeVerifier).toBe('verifier-value');
      expect(captured?.redirectUri).toBe(`${PUBLIC_API_URL}/auth/oauth/GOOGLE/callback`);
      expect(captured?.code).toBe(CODE);
    });

    it('records LOGIN_SUCCEEDED and updates the identity lastUsedAt', async () => {
      // Seeded with a `lastUsedAt` an hour in the past and asserted with a
      // STRICT inequality against that exact value — not `toBeGreaterThanOrEqual`
      // against an instant captured a few in-memory awaits after the seed,
      // which is close enough in wall-clock time to pass whether or not
      // `markUsed` ever runs. Delete the `markUsed` call and this now fails.
      const OLD_LAST_USED_AT = new Date(Date.now() - 60 * 60 * 1000);
      const userId = await seedUser({ email: 'ada@example.test' });
      const identityId = await seedIdentity(userId, AuthProvider.GOOGLE, 'subject-1', OLD_LAST_USED_AT);
      await seedRow();
      googleFetchAccount = async () => account({ subject: 'subject-1' });

      await service.complete('GOOGLE', CODE, STATE, CLIENT);

      const entries = auditOf(AuditAction.LOGIN_SUCCEEDED);
      expect(entries).toHaveLength(1);
      expect(entries[0].actorUserId).toBe(userId);

      const identityRow = source.all(AuthIdentityRecord).find((row) => row.id === identityId);
      expect(identityRow?.lastUsedAt).not.toBeNull();
      const lastUsedAt = identityRow?.lastUsedAt as Date;
      expect(lastUsedAt.getTime()).toBeGreaterThan(OLD_LAST_USED_AT.getTime());
    });

    it('refuses a suspended account, and issues nothing', async () => {
      const userId = await seedUser({ email: 'ada@example.test', status: UserStatus.SUSPENDED });
      await seedIdentity(userId, AuthProvider.GOOGLE, 'subject-1');
      await seedRow();
      googleFetchAccount = async () => account({ subject: 'subject-1' });

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      // R8: the same account-state rule a password sign-in is subject to,
      // in the same order. A suspended account must not be reachable
      // through a provider. The reason is recorded and never returned.
      expect(result).toEqual({ status: 'REFUSED', code: 'ACCOUNT_UNAVAILABLE', redirectTo: null });
      expect(source.all(SessionRecord)).toHaveLength(0);
      expect(auditOf(AuditAction.LOGIN_FAILED)[0].metadata)
        .toMatchObject({ reason: AuthenticationRejectionReason.ACCOUNT_SUSPENDED });
    });

    it('refuses a deleted account with the same outward answer as a suspended one', async () => {
      const userId = await seedUser({ email: 'ada@example.test', deletedAt: new Date() });
      await seedIdentity(userId, AuthProvider.GOOGLE, 'subject-1');
      await seedRow();
      googleFetchAccount = async () => account({ subject: 'subject-1' });

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      // Indistinguishable to the caller...
      expect(result).toEqual({ status: 'REFUSED', code: 'ACCOUNT_UNAVAILABLE', redirectTo: null });
      // ...distinguished in the record: `ACCOUNT_DELETED`, not
      // `ACCOUNT_SUSPENDED` — the most-permanent-first ordering
      // `AuthenticationRejectionReason` fixes, applied unchanged.
      expect(auditOf(AuditAction.LOGIN_FAILED)[0].metadata)
        .toMatchObject({ reason: AuthenticationRejectionReason.ACCOUNT_DELETED });
    });

    it('provisions an account for a verified address nobody holds, already verified', async () => {
      await seedRow();
      googleFetchAccount = async () => account({
        subject: 'brand-new-subject',
        email: 'brand-new@example.test',
        emailVerified: true,
        displayName: 'Brand New',
      });

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      expect(result.status).toBe('SIGNED_IN');
      const [user] = source.all(UserRecord);
      // The provider proved the address. Sending a verification mail to an
      // address a provider just proved would be asking the person to prove
      // it twice.
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(auditOf(AuditAction.USER_REGISTERED)).toHaveLength(1);
      expect(source.all(AuthIdentityRecord)).toHaveLength(1);
      expect(source.all(SessionRecord)).toHaveLength(1);
    });

    it('falls back to the mailbox local part when the provider discloses no name', async () => {
      await seedRow();
      googleFetchAccount = async () => account({
        subject: 'nameless-subject', email: 'nameless@example.test', emailVerified: true, displayName: null,
      });

      await service.complete('GOOGLE', CODE, STATE, CLIENT);

      const [user] = source.all(UserRecord);
      expect(user.displayName).toBe('nameless');
    });

    it('bounds a provider-disclosed display name, since it is stored and carries no DTO in front of it', async () => {
      // A password registration bounds this field with RegisterDto's own
      // @MaxLength(200) before it ever reaches the service. Nothing stands in
      // front of a provider's assertion the same way — this is the one place
      // the bound can live.
      await seedRow();
      const longName = 'A'.repeat(500);
      googleFetchAccount = async () => account({
        subject: 'long-name-subject', email: 'long-name@example.test', emailVerified: true,
        displayName: longName,
      });

      await service.complete('GOOGLE', CODE, STATE, CLIENT);

      const [user] = source.all(UserRecord);
      // The exact 200-character value, not merely its length — pins both
      // "bounded" and "the surviving 200 are the first 200", not a slice
      // from the wrong end.
      expect(user.displayName).toBe('A'.repeat(200));
    });

    it('provisions the identity under the registry-resolved provider, not the adapter\'s own self-report', async () => {
      // The adapter registered as GOOGLE answers with `provider: GITHUB` in
      // the account it asserts — every real adapter agrees with itself, but
      // nothing stops one that does not, and the value stored here has to
      // be the one `findByProviderAccount` looks a subject up by, or the
      // very next sign-in attempt cannot find this identity, re-provisions
      // instead, D11 refuses the second account for the same address, and
      // the person is locked out with nothing pointing at why.
      await seedRow();
      googleFetchAccount = async () => account({
        provider: AuthProvider.GITHUB,
        subject: 'self-report-mismatch-subject',
        email: 'mismatch@example.test',
        emailVerified: true,
      });

      await service.complete('GOOGLE', CODE, STATE, CLIENT);

      const [identity] = source.all(AuthIdentityRecord);
      expect(identity.provider).toBe(AuthProvider.GOOGLE);

      // And the identity really is findable the way a later sign-in would
      // look it up — by the registry value, not by what the account claimed.
      const found = await identities.findByProviderAccount(
        AuthProvider.GOOGLE,
        'self-report-mismatch-subject',
      );
      expect(found).not.toBeNull();
    });
  });

  describe('an unverified or absent address', () => {
    it('refuses before any account existence is considered, and provisions nothing', async () => {
      await seedRow();
      googleFetchAccount = async () => account({
        subject: 'unverified-subject', email: 'nope@example.test', emailVerified: false,
      });

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      expect(result).toEqual({ status: 'REFUSED', code: 'EMAIL_UNVERIFIED', redirectTo: null });
      expect(source.all(UserRecord)).toHaveLength(0);
    });

    it('refuses an absent address the same way', async () => {
      await seedRow();
      googleFetchAccount = async () => account({ subject: 'no-address-subject', email: null, emailVerified: false });

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      expect(result).toEqual({ status: 'REFUSED', code: 'EMAIL_UNVERIFIED', redirectTo: null });
    });

    it('is not invisible in the record: a LOGIN_FAILED entry, null actor, this refusal code', async () => {
      // Nobody local is established on this branch, but the attempt itself
      // is exactly the sort of thing somebody investigating abuse comes
      // looking for — an earlier draft left this branch silent on the
      // reasoning "nobody to record it against", which this repository has
      // already argued against elsewhere for the identical shape (a null
      // actor, not no entry): `signInExisting`'s own UNKNOWN_ACCOUNT branch,
      // and `AuthService.register`'s lost-race branch.
      await seedRow();
      googleFetchAccount = async () => account({
        subject: 'unverified-subject-2', email: 'nope@example.test', emailVerified: false,
      });

      await service.complete('GOOGLE', CODE, STATE, CLIENT);

      const entries = auditOf(AuditAction.LOGIN_FAILED);
      expect(entries).toHaveLength(1);
      expect(entries[0].actorUserId).toBeNull();
      expect(entries[0].metadata).toMatchObject({ code: 'EMAIL_UNVERIFIED' });
      // Recorded with the client too, the same as every other entry
      // `OAuthService` writes with one in scope.
      expect(entries[0].clientAddress).toBe(CLIENT.address);
    });
  });

  // ─── D11, at the service level ─────────────────────────────────────────────
  //
  // This refusal IS distinguishable from the provisioning path above: one
  // signs the person in and one does not, and no arrangement of this flow can
  // hide that — the two cases genuinely differ in what happened. What must
  // NOT be distinguishable, and what the two cases below actually pin, is
  // WHOSE account it is: the audit entry names the account that already
  // existed, and the response to whoever presented the assertion never does.
  // A third case asserting "answers the same way whether or not the address
  // has an account" would be asserting something false, and — since it could
  // never fail — would be worse than not asserting it at all: a check that
  // cannot fail reads as evidence, and here it would be evidence of nothing.
  describe('an address that already belongs to an account', () => {
    it('refuses, links nothing, and issues nothing', async () => {
      await seedUser({ email: 'ada@example.test' });
      await seedRow();
      const before = source.all(AuthIdentityRecord).length;
      googleFetchAccount = async () => account({
        subject: 'a-new-subject', email: 'ada@example.test', emailVerified: true,
      });

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      expect(result).toEqual({
        status: 'REFUSED', code: 'EMAIL_ALREADY_REGISTERED', redirectTo: null,
      });
      expect(source.all(AuthIdentityRecord)).toHaveLength(before);
      expect(source.all(SessionRecord)).toHaveLength(0);
    });

    it('records FEDERATED_LINK_REFUSED against the account that already existed', async () => {
      const ada = await seedUser({ email: 'ada@example.test' });
      await seedRow();
      googleFetchAccount = async () => account({
        subject: 'a-new-subject', email: 'ada@example.test', emailVerified: true,
      });

      await service.complete('GOOGLE', CODE, STATE, CLIENT);

      const entry = auditOf(AuditAction.FEDERATED_LINK_REFUSED)[0];
      // The actor is the existing account, not whoever made the attempt —
      // nothing has been established about them, which is the point.
      expect(entry.actorUserId).toBe(ada);
      // The client address IS recorded, though — it is the one field in
      // this row saying anything at all about whoever made the attempt,
      // since the actor is deliberately the incumbent. This action's own
      // TSDoc calls the entry "what a reader looking for an attempted
      // takeover would search for"; blanking the one identifying field on
      // it would make that claim hollow.
      expect(entry.clientAddress).toBe(CLIENT.address);
      expect(entry.clientLabel).toBe(CLIENT.label);
    });
  });

  describe('linking', () => {
    it('links the subject to the actor the authorization recorded', async () => {
      const actor = await seedUser({ email: 'actor@example.test' });
      await seedRow({ purpose: OAuthAuthorizationPurpose.LINK, userId: actor });
      googleFetchAccount = async () => account({
        subject: 'a-fresh-subject', email: 'whatever@example.test', emailVerified: true,
      });

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      expect(result).toEqual({ status: 'LINKED', redirectTo: null });
      const rows = source.all(AuthIdentityRecord).filter((row) => row.userId === actor);
      expect(rows).toHaveLength(1);
      expect(rows[0].providerAccountId).toBe('a-fresh-subject');
    });

    it('records IDENTITY_LINKED', async () => {
      const actor = await seedUser({ email: 'actor@example.test' });
      await seedRow({ purpose: OAuthAuthorizationPurpose.LINK, userId: actor });
      googleFetchAccount = async () => account({ subject: 'a-fresh-subject' });

      await service.complete('GOOGLE', CODE, STATE, CLIENT);

      const entries = auditOf(AuditAction.IDENTITY_LINKED);
      expect(entries).toHaveLength(1);
      expect(entries[0].actorUserId).toBe(actor);
      expect(entries[0].resourceType).toBe('auth_identity');
    });

    it('refuses a subject another account already holds, without saying whose', async () => {
      const owner = await seedUser({ email: 'owner@example.test' });
      await seedIdentity(owner, AuthProvider.GOOGLE, 'shared-subject');
      const actor = await seedUser({ email: 'actor@example.test' });
      await seedRow({ purpose: OAuthAuthorizationPurpose.LINK, userId: actor });
      googleFetchAccount = async () => account({ subject: 'shared-subject' });

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      expect(result).toEqual({ status: 'REFUSED', code: 'IDENTITY_ALREADY_LINKED', redirectTo: null });
      // Nothing in what reaches the actor names the owner: the result object
      // above has no field for it, by its own type, and this is the
      // belt-and-braces check that the id is not smuggled in anywhere as a
      // string either.
      expect(JSON.stringify(result)).not.toContain(owner);
    });

    it('records IDENTITY_LINK_CONFLICT against the attempting actor, not the incumbent', async () => {
      // Deliberately a DIFFERENT action from D11's FEDERATED_LINK_REFUSED,
      // and a DIFFERENT actor rule: this request is authenticated, so
      // whoever made the attempt is already known, and recording the
      // incumbent instead — the account that did nothing — would be a false
      // statement in a table nothing is permitted to correct. See
      // `AuditAction.IDENTITY_LINK_CONFLICT`'s own TSDoc for the full
      // argument against `FEDERATED_LINK_REFUSED`'s opposite rule.
      const owner = await seedUser({ email: 'owner@example.test' });
      await seedIdentity(owner, AuthProvider.GOOGLE, 'shared-subject');
      const actor = await seedUser({ email: 'actor@example.test' });
      await seedRow({ purpose: OAuthAuthorizationPurpose.LINK, userId: actor });
      googleFetchAccount = async () => account({ subject: 'shared-subject' });

      await service.complete('GOOGLE', CODE, STATE, CLIENT);

      // (FakeDataSource enforces no unique constraint on auth_identities —
      // see this file's own top-of-file note — so this is only checking what
      // OAuthService itself chose to write, not that a real race could not
      // produce two rows.)
      expect(auditOf(AuditAction.FEDERATED_LINK_REFUSED)).toHaveLength(0);
      const entries = auditOf(AuditAction.IDENTITY_LINK_CONFLICT);
      expect(entries).toHaveLength(1);
      expect(entries[0].actorUserId).toBe(actor);
      expect(entries[0].actorUserId).not.toBe(owner);
      // Recorded with the client too, matching IDENTITY_LINKED's own sibling
      // success entry a few lines above it in the implementation — a
      // refusal that recorded less about the request than its own success
      // case would be an odd, silent asymmetry.
      expect(entries[0].clientAddress).toBe(CLIENT.address);
      expect(entries[0].clientLabel).toBe(CLIENT.label);
    });

    it('treats a subject the actor already holds as done, not as an error', async () => {
      const actor = await seedUser({ email: 'actor@example.test' });
      await seedIdentity(actor, AuthProvider.GOOGLE, 'own-subject');
      await seedRow({ purpose: OAuthAuthorizationPurpose.LINK, userId: actor });
      googleFetchAccount = async () => account({ subject: 'own-subject' });

      const identitiesBefore = source.all(AuthIdentityRecord).length;
      const linksBefore = auditOf(AuditAction.IDENTITY_LINKED).length;

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      expect(result).toEqual({ status: 'LINKED', redirectTo: null });
      // Nothing new: a link that already existed is not written again, and an
      // IDENTITY_LINKED entry here would record a link that did not happen.
      expect(source.all(AuthIdentityRecord)).toHaveLength(identitiesBefore);
      expect(auditOf(AuditAction.IDENTITY_LINKED)).toHaveLength(linksBefore);
    });

    it('links regardless of what address the provider asserted', async () => {
      const actor = await seedUser({ email: 'actor@example.test' });
      // Another account already holds this exact address — the one thing
      // that would refuse a SIGN_IN under D11. A link must not care.
      await seedUser({ email: 'contested@example.test' });
      await seedRow({ purpose: OAuthAuthorizationPurpose.LINK, userId: actor });
      googleFetchAccount = async () => account({
        subject: 'a-fresh-subject', email: 'contested@example.test', emailVerified: true,
      });

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      expect(result).toEqual({ status: 'LINKED', redirectTo: null });
      const rows = source.all(AuthIdentityRecord).filter((row) => row.userId === actor);
      expect(rows).toHaveLength(1);
    });
  });

  // `purpose` and `user_id` are both columns nothing in the schema
  // constrains to the two values or the one relationship this service
  // trusts them to hold (`purpose` is plain `text`, `user_id` is nullable
  // with no CHECK tying it to `purpose`). These two cases exist because the
  // safe default on a security-relevant branch is to refuse a row that does
  // not make sense, never to guess which of the two known shapes it must
  // have meant.
  describe('a row whose purpose or owner does not make sense', () => {
    it('refuses a purpose that is neither SIGN_IN nor LINK, rather than defaulting to sign-in', async () => {
      // Not reachable through `begin`/`beginLink`, which write only the two
      // known values — this models a row already in the table by some other
      // means (corruption, a future writer, a botched migration).
      await seedRow({ purpose: 'SOMETHING_ELSE' });
      googleFetchAccount = async () => account({ subject: 'whatever-subject' });

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      expect(result).toEqual({ status: 'REFUSED', code: 'AUTHORIZATION_UNKNOWN', redirectTo: null });
      expect(source.all(SessionRecord)).toHaveLength(0);
      expect(source.all(UserRecord)).toHaveLength(0);
    });

    it('refuses a LINK-purpose row with no owner, rather than creating an identity with a null actor', async () => {
      // `seedRow`'s own `userId` override accepts `null` explicitly for
      // exactly this case; `beginLink` itself never writes one. `redirectTo`
      // is deliberately non-null, the same discipline the AUTHORIZATION_UNKNOWN
      // cases above use: `seedRow`'s own default of `null` would let this
      // assertion pass whether the code echoes `row.redirectTo` or always
      // answers `null`, which is exactly the "AUTHORIZATION_UNKNOWN never
      // echoes redirectTo" property `consumeAuthorizationRow`'s own TSDoc
      // states.
      await seedRow({ purpose: OAuthAuthorizationPurpose.LINK, userId: null, redirectTo: '/somewhere' });
      googleFetchAccount = async () => account({ subject: 'whatever-subject' });

      const result = await service.complete('GOOGLE', CODE, STATE, CLIENT);

      expect(result).toEqual({ status: 'REFUSED', code: 'AUTHORIZATION_UNKNOWN', redirectTo: null });
      expect(source.all(AuthIdentityRecord)).toHaveLength(0);
    });
  });
});
