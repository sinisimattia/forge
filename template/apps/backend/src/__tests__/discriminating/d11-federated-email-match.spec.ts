import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { ObjectLiteral, Repository, DataSource } from 'typeorm';
import request from 'supertest';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { AuditService } from '../../audit/audit.service';
import { RefreshTokenRecord } from '../../auth/entities/refresh-token-record.entity';
import { SessionRecord } from '../../auth/entities/session-record.entity';
import type { ExchangeParams, IOAuthProvider } from '../../auth/oauth/IOAuthProvider';
import { OAuthAuthorizationRequestRecord } from '../../auth/oauth/oauth-authorization-request.entity';
import { OAuthController } from '../../auth/oauth/oauth.controller';
import { OAuthProviderRegistry } from '../../auth/oauth/oauth-provider.registry';
import { OAuthService } from '../../auth/oauth/oauth.service';
import { SessionService } from '../../auth/session/session.service';
import { JwtStrategy } from '../../auth/strategies';
import { FakeDataSource } from '../../common/testing';
import { AuthIdentityRecord } from '../../identities/auth-identity-record.entity';
import { Argon2PasswordHasher } from '../../identities/hashing';
import { IdentitiesController } from '../../identities/identities.controller';
import { IdentitiesService } from '../../identities/identities.service';
import { MfaChallengeRecord } from '../../mfa/entities/mfa-challenge-record.entity';
import { MfaMethodRecord } from '../../mfa/entities/mfa-method-record.entity';
import { MfaChallengeService } from '../../mfa/mfa-challenge.service';
import { MembershipRecord } from '../../organizations/membership-record.entity';
import { UserRecord } from '../../users/user-record.entity';

/**
 * D11 — "a callback whose provider-asserted address matches an existing
 * account must not auto-link."
 *
 * ## The analysis this file owes before it asserts anything
 *
 * `decideFederatedSignIn.ts`'s own TSDoc already names the rule this file
 * protects: a verified address a provider asserts, that already belongs to an
 * account, is refused and NOT linked — `REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT`,
 * checked third of four, after an already-linked subject (which must sign in
 * unconditionally) and before "nobody holds this, provision it".
 *
 * `d9-tenant-isolation.spec.ts` is the cautionary tale worth reading before
 * trusting any discriminating test: its natural fault — hydrating the
 * principal from the route parameter — turned out to be **fail-closed** (an
 * organization id looked up as a user id finds no row and throws), so that
 * file only discriminated because of a contrived id-collision fixture, and
 * the fault that could actually leak was a different one entirely (a service
 * resolving its target row with no `organization_id` in the predicate).
 *
 * D11's fault is not that shape. The fault this file exists to catch is: *a
 * callback whose provider-asserted address matches an existing account links
 * the provider to that account and signs the caller in as them.* That fault
 * was written down as a patch to `OAuthService.completeSignIn`'s
 * `REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT` case — replacing the refusal with
 * a federated-identity write against `decision.existingUserId` followed by
 * `sessions.begin` for that same account — applied, and the whole backend
 * suite was run under it. **It is not fail-closed.** With this file's own
 * three cases present and green (56 suites / 1181 tests), injecting the
 * patch turned two of them red — the refusal case and the audit case,
 * asserting respectively that no identity/session/cookie appeared and that
 * `FEDERATED_LINK_REFUSED` was written — plus both of
 * `oauth.service.complete.spec.ts`'s own D11 cases (`'refuses, links nothing,
 * and issues nothing'` and `'records FEDERATED_LINK_REFUSED against the
 * account that already existed'`): four failures total, out of 1181, and
 * every one an assertion that something had NOT happened or that a specific
 * audit entry existed — never a refusal assertion catching a thrown
 * exception, because under the fault nothing throws. The third case here —
 * the authenticated remedy — stayed green, which is expected rather than a
 * gap: it drives `IdentitiesController.beginLink` and the row's `LINK`
 * purpose, a branch of `OAuthService.complete` the patch never touched.
 *
 * ## What this file adds beyond `oauth.service.complete.spec.ts`
 *
 * That suite already asserts the refusal and the audit entry, directly
 * against `OAuthService.complete`. This file drives the same property through
 * `supertest` against a real, routed Nest application — `OAuthController`,
 * `IdentitiesController`, the real `OAuthService`, `IdentitiesService`,
 * `SessionService` and `AuditService`, wired the way `AuthModule` wires them,
 * behind a stubbed `IOAuthProvider` rather than a hand-called service method.
 * What a direct service call cannot show and this can: that `OAuthController`
 * really answers with a bare `302` carrying this repository's own opaque code
 * and never a cookie, and that the authenticated link route — a different
 * controller, a different guard, a different purpose recorded on the
 * authorization row — is what actually reaches the identity this refusal
 * withheld.
 *
 * ## What this file cannot see
 *
 * `FakeDataSource` enforces no unique constraint on `users.email` and no
 * foreign keys (`common/testing/fake-data-source.ts`'s own numbered list,
 * items 4 and 7) — nothing here is evidence about a database constraint. Each
 * case is independently seeded (a fresh `FakeDataSource` and a fresh app per
 * `beforeEach`, matching this directory's own `world.ts` and every suite in
 * `auth/oauth/__tests__`), not chained through one shared session, so "the
 * same subject, the same address" across the refusal and the remedy below is
 * a narrative property of the fixture literals, not of any state carried
 * between tests.
 */

const SIGNING_KEY = 'd11-federated-email-match-spec-signing-key';
const PUBLIC_API_URL = 'https://api.example.test';
const PUBLIC_WEBAPP_URL = 'https://app.example.test';

const ADA = '11111111-1111-4111-8111-111111111111' as UserId;
const ADA_PASSWORD_IDENTITY = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333' as SessionId;

const ADA_EMAIL = 'ada@example.test';
/** The subject a federated assertion carries throughout this file. Never linked anywhere until the remedy case links it deliberately. */
const CONTESTED_SUBJECT = 'never-linked-subject';

const EPOCH = new Date('2026-09-21T10:00:00.000Z');

/** A well-formed, verified federated assertion, overridable field by field — the same idiom `oauth.service.complete.spec.ts` uses. */
function account(overrides: Partial<FederatedAccount> = {}): FederatedAccount {
  return {
    provider: AuthProvider.GOOGLE,
    subject: CONTESTED_SUBJECT,
    email: ADA_EMAIL,
    emailVerified: true,
    displayName: 'Somebody Federated',
    ...overrides,
  };
}

/**
 * A stubbed `IOAuthProvider`, shaped like `DevOAuthProvider`: no page, no
 * separate address-collection step, and no network call. `authorizationUrl`
 * redirects straight back to this application's own callback, carrying the
 * real `state` `OAuthService.begin`/`beginLink` minted — so the row lookup
 * under a write lock, the single-use consumption, `decideFederatedSignIn` or
 * `decideFederatedLink`, and the audit write are all the shipped code, not a
 * hand-assembled approximation of it. Only `fetchAccount` is a per-test knob,
 * closing over a mutable reference so each `it` can assert what the provider
 * claims without rebuilding the registry.
 */
function stubGoogleProvider(
  fetchAccount: (params: ExchangeParams) => Promise<FederatedAccount>,
): IOAuthProvider {
  return {
    provider: AuthProvider.GOOGLE,
    authorizationUrl: async (params) => {
      const query = new URLSearchParams({ code: 'stub-authorization-code', state: params.state });
      return `${params.redirectUri}?${query.toString()}`;
    },
    fetchAccount: (params) => fetchAccount(params),
  };
}

describe('D11 — a provider-asserted address links nothing', () => {
  let app: INestApplication;
  let source: FakeDataSource;
  let jwt: JwtService;
  let googleFetchAccount: (params: ExchangeParams) => Promise<FederatedAccount>;

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  const auditOf = (action: AuditAction): Record<string, unknown>[] =>
    source.all(AuditEntryRecord).filter((row) => row.action === action);
  const identitiesOf = (userId: UserId): Record<string, unknown>[] =>
    source.all(AuthIdentityRecord).filter((row) => row.userId === userId);
  const sessionsOf = (userId: UserId): Record<string, unknown>[] =>
    source.all(SessionRecord).filter((row) => row.userId === userId);

  const bearer = (userId: UserId): string => `Bearer ${jwt.sign({ sub: userId, sid: SESSION })}`;

  /** Follows a `302` this application issued back into this same application, keeping only the path and query — the host on the Location header is `PUBLIC_API_URL`, which nothing here listens on. */
  const follow = (location: string): request.Test => {
    const target = new URL(location);
    return request(app.getHttpServer()).get(`${target.pathname}${target.search}`);
  };

  /**
   * Begins a sign-in, presents the callback with whatever `googleFetchAccount`
   * currently answers, and returns the callback's own response — the
   * unauthenticated path `GET /auth/oauth/GOOGLE` and `GET
   * /auth/oauth/GOOGLE/callback` a real browser would be carried through.
   */
  const attemptSignIn = async (): Promise<request.Response> => {
    const begin = await request(app.getHttpServer()).get('/auth/oauth/GOOGLE').expect(302);
    return follow(begin.headers.location as string);
  };

  beforeEach(async () => {
    source = new FakeDataSource();

    source.seed(UserRecord, [{
      id: ADA,
      email: ADA_EMAIL,
      displayName: 'Ada Lovelace',
      status: UserStatus.ACTIVE,
      platformRole: PlatformRole.PLATFORM_USER,
      emailVerifiedAt: EPOCH,
      createdAt: EPOCH,
      updatedAt: EPOCH,
      deletedAt: null,
    }]);
    // Ada's password account — the thing this whole file is about somebody
    // being unable to walk into by asserting her address at a provider
    // instead. `identitiesOf(ADA)` starts at exactly this one row.
    source.seed(AuthIdentityRecord, [{
      id: ADA_PASSWORD_IDENTITY,
      userId: ADA,
      provider: AuthProvider.PASSWORD,
      providerAccountId: ADA_EMAIL,
      createdAt: EPOCH,
      lastUsedAt: null,
      secretHash: '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$notarealderivation',
      secretAlgorithm: 'argon2id',
      secretParams: { memoryCost: 19456, timeCost: 2, parallelism: 1 },
    }]);

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
    const sessions = new SessionService(
      repo<SessionRecord>(SessionRecord),
      repo<RefreshTokenRecord>(RefreshTokenRecord),
      new JwtService({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      source as unknown as DataSource,
    );

    googleFetchAccount = async () => {
      throw new Error('googleFetchAccount must be set by the test that calls it');
    };
    const registry = new OAuthProviderRegistry([
      stubGoogleProvider((params) => googleFetchAccount(params)),
    ]);

    const oauth = new OAuthService(
      repo<OAuthAuthorizationRequestRecord>(OAuthAuthorizationRequestRecord),
      repo<UserRecord>(UserRecord),
      registry,
      identities,
      sessions,
      audit,
      source as unknown as DataSource,
      new ConfigService({ PUBLIC_API_URL }),
      repo<MfaMethodRecord>(MfaMethodRecord),
      new MfaChallengeService(
        repo<MfaChallengeRecord>(MfaChallengeRecord),
        source as unknown as DataSource,
      ),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: SIGNING_KEY, PUBLIC_WEBAPP_URL })],
        }),
        I18N,
        PassportModule,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [OAuthController, IdentitiesController],
      providers: [
        // The shipped global providers, including the `APP_GUARD` that closes
        // every route not marked `@Public()` — the authenticated link route
        // below is only a discriminating case if that guard is really the one
        // in front of it, not a stand-in this file assembled.
        ...GLOBAL_PROVIDERS,
        JwtStrategy,
        // `PlatformAdminOverrideInterceptor`, one of `GLOBAL_PROVIDERS`, needs
        // `AuditService` — see `identities.controller.spec.ts`'s own note on
        // the same requirement.
        { provide: AuditService, useValue: audit },
        { provide: OAuthService, useValue: oauth },
        { provide: IdentitiesService, useValue: identities },
        { provide: OAuthProviderRegistry, useValue: registry },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    jwt = moduleRef.get(JwtService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('does not link, and does not sign in, when the provider asserts an address an account already holds', async () => {
    // A Google callback arrives asserting a VERIFIED ada@example.test for a
    // subject nobody has ever linked.
    googleFetchAccount = async () => account({ emailVerified: true });

    const response = await attemptSignIn();

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('error=EMAIL_ALREADY_REGISTERED');

    // The three facts, each asserted against the store rather than the
    // response.
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(identitiesOf(ADA)).toHaveLength(1);
    expect(sessionsOf(ADA)).toHaveLength(0);
  });

  it('records the attempt against the account that already existed', async () => {
    googleFetchAccount = async () => account({ emailVerified: true });

    await attemptSignIn();

    const entries = auditOf(AuditAction.FEDERATED_LINK_REFUSED);
    expect(entries).toHaveLength(1);
    // Nothing has been established about whoever made the attempt — that is
    // the point — so the actor recorded is the account that already existed,
    // never anything derived from the assertion itself.
    expect(entries[0].actorUserId).toBe(ADA);
  });

  it(
    'lets Ada reach the same provider deliberately, from an authenticated session, and it links',
    async () => {
      // The remedy, asserted beside the refusal: a refusal with no route
      // forward is a bug report waiting to be filed, and this is the proof
      // the refusal above is about PROOF rather than about the provider —
      // same provider, same subject, same address, reached through
      // `IdentitiesController.beginLink`, a *different* controller behind
      // the global `JwtAuthGuard`, rather than any shortcut this file takes.
      const begin = await request(app.getHttpServer())
        .post('/users/me/identities/GOOGLE')
        .set('Authorization', bearer(ADA))
        .expect(200);

      const { authorizationUrl } = begin.body as { authorizationUrl: string };
      googleFetchAccount = async () => account({ emailVerified: true });

      const linked = await follow(authorizationUrl);

      expect(linked.status).toBe(302);
      expect(linked.headers.location).not.toContain('error=');
      expect(identitiesOf(ADA)).toHaveLength(2);
      const federated = identitiesOf(ADA)
        .find((row) => row.provider === AuthProvider.GOOGLE);
      expect(federated).toBeDefined();
      expect(federated?.providerAccountId).toBe(CONTESTED_SUBJECT);

      const entries = auditOf(AuditAction.IDENTITY_LINKED);
      expect(entries).toHaveLength(1);
      expect(entries[0].actorUserId).toBe(ADA);
    },
  );
});
