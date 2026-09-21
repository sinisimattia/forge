import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import { AuditEntryRecord } from '../../../audit/audit-entry-record.entity';
import { AuditService } from '../../../audit/audit.service';
import { FakeDataSource } from '../../../common/testing';
import { AuthIdentityRecord } from '../../../identities/auth-identity-record.entity';
import { Argon2PasswordHasher } from '../../../identities/hashing';
import { IdentitiesService } from '../../../identities/identities.service';
import { MembershipRecord } from '../../../organizations/membership-record.entity';
import { UserRecord } from '../../../users/user-record.entity';
import { RefreshTokenRecord } from '../../entities/refresh-token-record.entity';
import { SessionRecord } from '../../entities/session-record.entity';
import { SessionService } from '../../session/session.service';
import { DevOAuthProvider } from '../adapters/DevOAuthProvider';
import { OAuthAuthorizationRequestRecord } from '../oauth-authorization-request.entity';
import { OAuthProviderRegistry } from '../oauth-provider.registry';
import { OAuthService } from '../oauth.service';

const PUBLIC_API_URL = 'https://api.example.test';
const CONFIGURED_ADDRESS = 'dev-signin@example.test';
const CLIENT: ClientContext = { address: '203.0.113.9', label: 'test-client' };
/** This suite's signing key. Not a credential: it signs nothing outside this file. */
const SIGNING_KEY = 'dev-round-trip-spec-signing-key';

/**
 * The development provider's own end-to-end proof — Task 12's revision.
 *
 * Every other suite in this folder tests `OAuthService` against fake
 * providers, or tests `DevOAuthProvider` in isolation. Neither, on its own,
 * demonstrates the property the coordinator's ruling is actually about:
 * that pressing "sign in" against the *real* `DevOAuthProvider`, wired
 * through the *real* `OAuthService`, reaches a session with no page and no
 * 404 in between. This file constructs both for real — `FakeDataSource`
 * standing in for Postgres exactly as `oauth.service.complete.spec.ts` does,
 * and carrying the same caveats about what a fake store cannot prove (no
 * unique constraints, no foreign keys — see that file's own top-of-file
 * note) — and drives the whole round trip: `begin` → parse the URL exactly
 * as a provider's own redirect would be parsed → `complete`.
 */
describe('the development provider — the full round trip (Task 12 revision)', () => {
  let source: FakeDataSource;
  let service: OAuthService;

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  beforeEach(() => {
    source = new FakeDataSource();

    const users = repo<UserRecord>(UserRecord);
    const audit = new AuditService(
      repo<AuditEntryRecord>(AuditEntryRecord), users, repo<MembershipRecord>(MembershipRecord),
    );
    const identities = new IdentitiesService(
      repo<AuthIdentityRecord>(AuthIdentityRecord), new Argon2PasswordHasher(), audit,
    );
    const sessions = new SessionService(
      repo<SessionRecord>(SessionRecord),
      repo<RefreshTokenRecord>(RefreshTokenRecord),
      new JwtService({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      source as unknown as DataSource,
    );
    // The real adapter, not a fake — this suite's whole point.
    const registry = new OAuthProviderRegistry([new DevOAuthProvider(CONFIGURED_ADDRESS)]);

    service = new OAuthService(
      repo<OAuthAuthorizationRequestRecord>(OAuthAuthorizationRequestRecord),
      users,
      registry,
      identities,
      sessions,
      audit,
      source as unknown as DataSource,
      new ConfigService({ PUBLIC_API_URL }),
    );
  });

  it('completes a full round trip and issues a session — no page, no 404', async () => {
    // `begin` is what `GET /auth/oauth/:provider` calls. Its return value is
    // exactly the URL a browser is redirected to.
    const authorizationUrl = await service.begin('OIDC', null);
    const target = new URL(authorizationUrl);

    // The property the coordinator's ruling exists for: the URL a browser
    // lands on is this application's OWN callback, not a page under some
    // other path that nothing serves.
    expect(target.origin + target.pathname).toBe(`${PUBLIC_API_URL}/auth/oauth/OIDC/callback`);

    const code = target.searchParams.get('code');
    const state = target.searchParams.get('state');
    expect(code).toEqual(expect.any(String));
    expect(state).toEqual(expect.any(String));

    // `GET /auth/oauth/:provider/callback` calls exactly this next, with the
    // query values a browser following the redirect above would present.
    const result = await service.complete('OIDC', code as string, state as string, CLIENT);

    expect(result.status).toBe('SIGNED_IN');
    if (result.status !== 'SIGNED_IN') throw new Error('unreachable');
    expect(result.credentials.accessToken).toEqual(expect.any(String));
    expect(source.all(SessionRecord)).toHaveLength(1);

    // Provisioned for the configured address — the one thing this adapter
    // ever asserts, with no human step.
    const [user] = source.all(UserRecord);
    expect(user.email).toBe(CONFIGURED_ADDRESS);
  });

  it('signs in the same account on a second round trip, rather than provisioning again', async () => {
    const first = new URL(await service.begin('OIDC', null));
    await service.complete(
      'OIDC', first.searchParams.get('code') as string, first.searchParams.get('state') as string, CLIENT,
    );
    expect(source.all(UserRecord)).toHaveLength(1);

    const second = new URL(await service.begin('OIDC', null));
    const result = await service.complete(
      'OIDC', second.searchParams.get('code') as string, second.searchParams.get('state') as string, CLIENT,
    );

    expect(result.status).toBe('SIGNED_IN');
    // Still one account, one federated identity — the second round trip
    // signed in through it rather than provisioning a duplicate.
    expect(source.all(UserRecord)).toHaveLength(1);
    expect(source.all(SessionRecord)).toHaveLength(2);
  });
});
