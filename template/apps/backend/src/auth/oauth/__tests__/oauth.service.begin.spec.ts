import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';
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
import type { AuthorizationUrlParams, IOAuthProvider } from '../IOAuthProvider';
import { OAuthAuthorizationRequestRecord } from '../oauth-authorization-request.entity';
import { OAuthProviderRegistry } from '../oauth-provider.registry';
import { OAuthAuthorizationPurpose, OAuthService } from '../oauth.service';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111' as UserId;

/** This harness's signing key. Not a credential: it signs nothing outside this spec. */
const SIGNING_KEY = 'begin-spec-signing-key';

/**
 * An adapter carrying only what `begin`/`beginLink` touch: it builds a URL
 * that echoes the three params `IOAuthProvider.authorizationUrl` is handed,
 * so a test can read the state and the challenge straight back off it.
 * `fetchAccount` is never called by anything in this suite.
 */
function fakeProvider(provider: AuthProvider): IOAuthProvider {
  return {
    provider,
    authorizationUrl: async (params: AuthorizationUrlParams): Promise<string> => {
      const url = new URL(`https://provider.example.test/${provider.toLowerCase()}/authorize`);
      url.searchParams.set('state', params.state);
      url.searchParams.set('code_challenge', params.codeChallenge);
      url.searchParams.set('redirect_uri', params.redirectUri);
      return url.toString();
    },
    fetchAccount: (): Promise<FederatedAccount> => {
      throw new Error('not called in this suite');
    },
  };
}

/**
 * # Beginning an authorization
 *
 * This deployment, in this suite, registered Google alone. GitHub is a real
 * `AuthProvider` member with no adapter behind it — exactly the shape
 * `OAuthProviderRegistry`'s own suite already covers, exercised here through
 * the service that depends on it.
 *
 * ## What `FakeDataSource` cannot see
 *
 * It enforces no unique constraint on `state_hash` and has no foreign key
 * from `user_id` to `users` — see `common/testing/fake-data-source.ts`'s own
 * list, items 4 and 7. Nothing below asserts that a second row could not
 * reuse a state, or that a row survives (or does not) a deleted user; both
 * are schema-level guarantees the migration carries and only a real Postgres
 * can demonstrate.
 */
describe('OAuthService.begin / beginLink', () => {
  let source: FakeDataSource;
  let service: OAuthService;
  let requests: Repository<OAuthAuthorizationRequestRecord>;

  const PUBLIC_API_URL = 'https://api.example.test';

  beforeEach(() => {
    source = new FakeDataSource();
    const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
      source.getRepository(entity) as unknown as Repository<T>;
    requests = repo<OAuthAuthorizationRequestRecord>(OAuthAuthorizationRequestRecord);
    const users = repo<UserRecord>(UserRecord);

    // `begin`/`beginLink` touch none of these — `OAuthService.complete` is what
    // uses them — but the constructor takes them all, so this suite wires the
    // same real services the completion suite does rather than typing a
    // second, narrower fake of `OAuthService`'s dependencies.
    const audit = new AuditService(
      repo<AuditEntryRecord>(AuditEntryRecord),
      users,
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

    const registry = new OAuthProviderRegistry([fakeProvider(AuthProvider.GOOGLE)]);
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

  it('refuses a provider this deployment did not configure', async () => {
    await expect(service.begin('GITHUB', null)).rejects.toThrow(NotFoundException);
    expect(await requests.find()).toHaveLength(0);
  });

  it('stores the state as a digest and never in the clear', async () => {
    const url = new URL(await service.begin('GOOGLE', null));
    const state = url.searchParams.get('state')!;
    expect(state.length).toBeGreaterThan(0);

    const rows = await requests.find();
    expect(rows).toHaveLength(1);
    expect(rows[0].stateHash).not.toBe(state);
    // Measured independently of whatever the service called internally: this
    // is `hashOpaqueToken` applied here, in the test, to the value the
    // browser actually received.
    expect(rows[0].stateHash).toBe(hashOpaqueToken(state));
  });

  it('sends the challenge to the provider and keeps the verifier here', async () => {
    const url = new URL(await service.begin('GOOGLE', null));
    const rows = await requests.find();

    const challenge = url.searchParams.get('code_challenge')!;
    expect(challenge.length).toBeGreaterThan(0);
    expect(challenge).not.toBe(rows[0].codeVerifier);
    // Nowhere in the URL at all, not even as a substring of some other value.
    expect(url.search).not.toContain(rows[0].codeVerifier);
  });

  it('records the purpose, and records no actor, for a sign-in', async () => {
    await service.begin('GOOGLE', null);
    const rows = await requests.find();
    expect(rows).toHaveLength(1);
    // Pinned as the literal string the schema actually stores — not derived
    // from `OAuthAuthorizationPurpose.SIGN_IN`, which would make this
    // assertion true regardless of what that object held.
    expect(rows[0].purpose).toBe('SIGN_IN');
    expect(rows[0].userId).toBeNull();
  });

  it('records the actor for a link', async () => {
    await service.beginLink(ACTOR_ID, 'GOOGLE');
    const rows = await requests.find();
    expect(rows).toHaveLength(1);
    expect(rows[0].purpose).toBe('LINK');
    expect(rows[0].userId).toBe(ACTOR_ID);
  });

  it('refuses a link to a provider this deployment did not configure', async () => {
    await expect(service.beginLink(ACTOR_ID, 'GITHUB')).rejects.toThrow(NotFoundException);
  });

  it('gives the authorization a short life — minutes, not the session lifetime', async () => {
    await service.begin('GOOGLE', null);
    const rows = await requests.find();
    const lifetimeMs = rows[0].expiresAt.getTime() - rows[0].createdAt.getTime();
    expect(lifetimeMs).toBeGreaterThan(0);
    expect(lifetimeMs).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  describe('redirectTo', () => {
    it('refuses an absolute URL to another origin', async () => {
      await expect(service.begin('GOOGLE', 'https://elsewhere.example/steal')).rejects.toThrow();
    });

    it('refuses a scheme-relative //host, which a browser reads as a different origin', async () => {
      await expect(service.begin('GOOGLE', '//elsewhere.example')).rejects.toThrow();
    });

    it('refuses a backslash-prefixed path, which a browser normalizes the same way', async () => {
      await expect(service.begin('GOOGLE', '/\\elsewhere.example')).rejects.toThrow();
    });

    it('accepts a same-application path beginning with a single /', async () => {
      await expect(service.begin('GOOGLE', '/organizations')).resolves.toBeDefined();
      const rows = await requests.find();
      expect(rows[0].redirectTo).toBe('/organizations');
    });

    it('accepts the absence of a redirectTo', async () => {
      await expect(service.begin('GOOGLE', null)).resolves.toBeDefined();
      const rows = await requests.find();
      expect(rows[0].redirectTo).toBeNull();
    });
  });

  it('pins the two purpose values this schema stores — SIGN_IN and LINK', () => {
    // Both sides written out as literals: the point is not that
    // `OAuthAuthorizationPurpose.SIGN_IN` equals itself (true no matter what
    // it holds) but that it holds exactly the string the `purpose` column
    // — plain `text`, no SQL literal — is written and read
    // against. A change to either value here is a change to what ships.
    expect(OAuthAuthorizationPurpose.SIGN_IN).toBe('SIGN_IN');
    expect(OAuthAuthorizationPurpose.LINK).toBe('LINK');
  });
});
