import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';
import { AuditEntryRecord } from '../../../audit/audit-entry-record.entity';
import { AuditService } from '../../../audit/audit.service';
import { FakeDataSource } from '../../../common/testing';
import { AuthIdentityRecord } from '../../../identities/auth-identity-record.entity';
import { Argon2PasswordHasher } from '../../../identities/hashing';
import { IdentitiesService } from '../../../identities/identities.service';
import { MfaChallengeRecord } from '../../../mfa/entities/mfa-challenge-record.entity';
import { MfaMethodRecord } from '../../../mfa/entities/mfa-method-record.entity';
import { MfaChallengeService } from '../../../mfa/mfa-challenge.service';
import { MembershipRecord } from '../../../organizations/membership-record.entity';
import { UserRecord } from '../../../users/user-record.entity';
import { RefreshTokenRecord } from '../../entities/refresh-token-record.entity';
import { SessionRecord } from '../../entities/session-record.entity';
import { SessionService } from '../../session/session.service';
import type { IOAuthProvider } from '../IOAuthProvider';
import { OAuthAuthorizationRequestRecord } from '../oauth-authorization-request.entity';
import { OAuthProviderRegistry } from '../oauth-provider.registry';
import { OAuthAuthorizationPurpose, OAuthService } from '../oauth.service';

const PUBLIC_API_URL = 'https://api.example.test';

/** This harness's signing key. Not a credential: it signs nothing outside this spec. */
const SIGNING_KEY = 'prune-spec-signing-key';

/** Never called by this suite. */
function fakeProvider(provider: AuthProvider): IOAuthProvider {
  return {
    provider,
    authorizationUrl: (): Promise<string> => {
      throw new Error('not called in this suite');
    },
    fetchAccount: (): Promise<FederatedAccount> => {
      throw new Error('not called in this suite');
    },
  };
}

/**
 * `OAuthService.pruneExpired` — the same "not on any request path" answer
 * `SessionService.pruneExpired` gives for its own single-use table, and the
 * assertion the migration's `ix_oauth_authorization_requests_expires_at`
 * index and `migration-sql.spec.ts`'s `indexes expires_at for the sweep`
 * both name but neither, on its own, proves exists.
 */
describe('OAuthService.pruneExpired', () => {
  let source: FakeDataSource;
  let service: OAuthService;
  let requests: Repository<OAuthAuthorizationRequestRecord>;

  const seedRow = async (
    stateHash: string,
    expiresAt: Date,
    consumedAt: Date | null = null,
  ): Promise<void> => {
    await requests.insert({
      stateHash,
      codeVerifier: `verifier-${stateHash}`,
      provider: AuthProvider.GOOGLE,
      purpose: OAuthAuthorizationPurpose.SIGN_IN,
      userId: null,
      redirectTo: null,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      expiresAt,
      consumedAt,
    });
  };

  beforeEach(() => {
    source = new FakeDataSource();
    const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
      source.getRepository(entity) as unknown as Repository<T>;
    requests = repo<OAuthAuthorizationRequestRecord>(OAuthAuthorizationRequestRecord);
    const users = repo<UserRecord>(UserRecord);

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
      repo<MfaMethodRecord>(MfaMethodRecord),
      new MfaChallengeService(
        repo<MfaChallengeRecord>(MfaChallengeRecord),
        source as unknown as DataSource,
      ),
    );
  });

  const CUTOFF = new Date('2026-09-01T00:10:00.000Z');

  it('deletes a row whose expiry is before the cutoff, and leaves one whose expiry is after it', async () => {
    await seedRow('expired', new Date('2026-09-01T00:05:00.000Z'));
    await seedRow('still-live', new Date('2026-09-01T00:15:00.000Z'));

    await service.pruneExpired(CUTOFF);

    const remaining = await requests.find();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].stateHash).toBe('still-live');
  });

  it('deletes an expired row whether or not it was ever consumed', async () => {
    // A never-completed request is the case the migration's own comment
    // names, but a completed one past its expiry has no further use either
    // — the same choice SessionService.pruneExpired makes for a spent
    // refresh token.
    await seedRow('expired-unconsumed', new Date('2026-09-01T00:05:00.000Z'), null);
    await seedRow(
      'expired-consumed',
      new Date('2026-09-01T00:05:00.000Z'),
      new Date('2026-09-01T00:02:00.000Z'),
    );

    await service.pruneExpired(CUTOFF);

    expect(await requests.find()).toHaveLength(0);
  });
});
