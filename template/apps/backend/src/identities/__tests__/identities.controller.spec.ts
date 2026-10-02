import { INestApplication, NotFoundException } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { ObjectLiteral, Repository } from 'typeorm';
import request from 'supertest';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { RecordAuditEntryInput } from '__FORGE_SCOPE__/core/audit/types';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { AuditService } from '../../audit/audit.service';

import { FakeDataSource, UNMETERED_THROTTLING, recordingAudit } from '../../common/testing';
import { AuthModule } from '../../auth/auth.module';
import { OAuthService } from '../../auth/oauth/oauth.service';
import { JwtStrategy } from '../../auth/strategies';
import { AuthIdentityRecord } from '../auth-identity-record.entity';
import { Argon2PasswordHasher } from '../hashing';
import { IdentitiesController } from '../identities.controller';
import { IdentitiesModule } from '../identities.module';
import { IdentitiesService } from '../identities.service';

/**
 * Listing and giving up the ways a person can prove who they are.
 *
 * The property this file is really about is that **the unlink rule is core's**.
 * `assertAtLeastOneIdentityRemains` decides both refusals and decides them in
 * the order core documents, and the tests below are shaped so that a controller
 * or a service which restated the rule as its own count query would fail them —
 * in particular the last-identity case is exercised through an id its owner does
 * not hold, which a "would this be the last one?" check answers with the wrong
 * error.
 */

const SIGNING_KEY = 'identities-controller-spec-signing-key';

const ADA = '11111111-1111-4111-8111-111111111111' as UserId;
const GRACE = '22222222-2222-4222-8222-222222222222' as UserId;
const SESSION = '33333333-3333-4333-8333-333333333333' as SessionId;

/**
 * The identity Ada proves herself with locally, and the one a provider proves
 * for her.
 *
 * Named for what they are rather than for the provider behind them. `ADA_PASSWORD`
 * was the obvious name and is exactly the shape a text-based secret scan flags: a
 * quoted literal assigned to a credential-shaped key, which such a scan cannot
 * tell apart from a real one. The same idiom
 * is documented in `auth/__tests__/auth.controller.spec.ts`.
 */
const ADA_LOCAL_IDENTITY = '44444444-4444-4444-8444-444444444444' as AuthIdentityId;
const ADA_FEDERATED_IDENTITY = '55555555-5555-4555-8555-555555555555' as AuthIdentityId;
const GRACE_SOLE_IDENTITY = '66666666-6666-4666-8666-666666666666' as AuthIdentityId;

const EPOCH = new Date('2026-09-18T10:00:00.000Z');

const identityRow = (
  id: string,
  userId: string,
  provider: AuthProvider,
  providerAccountId: string,
): Record<string, unknown> => ({
  id,
  userId,
  provider,
  providerAccountId,
  createdAt: EPOCH,
  lastUsedAt: null,
  // The three columns core deliberately does not model. Present here precisely
  // so that a serialization carrying one of them would be visible below.
  secretHash: '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$notarealderivation',
  secretAlgorithm: 'argon2id',
  secretParams: { memoryCost: 19456, timeCost: 2, parallelism: 1 },
});

describe('IdentitiesController', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let source: FakeDataSource;
  let recorded: RecordAuditEntryInput[];
  /** The repository the service was built with, so a test can make it fail. */
  let identityRepo: Repository<AuthIdentityRecord>;
  /**
   * A stand-in for the real `OAuthService`, which this controller now depends
   * on for `beginLink` alone — its own suite (`auth/oauth/__tests__`) is what
   * proves `beginLink` itself; this file only proves the controller reaches
   * it and returns what it hands back.
   */
  let oauth: { beginLink: jest.Mock };

  beforeEach(async () => {
    source = new FakeDataSource();
    recorded = [];
    source.seed(AuthIdentityRecord, [
      identityRow(ADA_LOCAL_IDENTITY, ADA, AuthProvider.PASSWORD, 'ada@example.test'),
      identityRow(ADA_FEDERATED_IDENTITY, ADA, AuthProvider.GOOGLE, 'google-subject-for-ada'),
      identityRow(GRACE_SOLE_IDENTITY, GRACE, AuthProvider.PASSWORD, 'grace@example.test'),
    ]);

    const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
      source.getRepository(entity) as unknown as Repository<T>;

    const audit = recordingAudit(recorded);

    identityRepo = repo<AuthIdentityRecord>(AuthIdentityRecord);
    const identities = new IdentitiesService(
      identityRepo,
      new Argon2PasswordHasher(),
      audit,
    );
    oauth = { beginLink: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: SIGNING_KEY })] }),
        I18N,
        PassportModule,
        UNMETERED_THROTTLING,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [IdentitiesController],
      providers: [
        ...GLOBAL_PROVIDERS,
        // `GLOBAL_PROVIDERS` carries `PlatformAdminOverrideInterceptor`, which
        // needs this. Nothing in this file passes through `PlatformAdminGuard`,
        // so the interceptor never writes anything here — but it is constructed,
        // which is the point: a probe application registering the shipped array
        // has to be able to build every provider in it, so one added there with
        // an unsatisfiable dependency fails here rather than at start-up.
        { provide: AuditService, useValue: audit },
        JwtStrategy,
        { provide: IdentitiesService, useValue: identities },
        { provide: OAuthService, useValue: oauth },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    jwt = moduleRef.get(JwtService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const bearer = (userId: UserId): string => `Bearer ${jwt.sign({ sub: userId, sid: SESSION })}`;

  describe('listing them', () => {
    it('is closed to a caller with no credential', async () => {
      await request(app.getHttpServer()).get('/users/me/identities').expect(401);
    });

    it('returns the actor\'s own and nobody else\'s', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/me/identities')
        .set('Authorization', bearer(ADA))
        .expect(200);

      const ids = response.body.map((identity: { id: string }) => identity.id);
      expect(ids.sort()).toEqual([ADA_LOCAL_IDENTITY, ADA_FEDERATED_IDENTITY].sort());
      expect(ids).not.toContain(GRACE_SOLE_IDENTITY);
    });

    it('carries exactly the keys core defines, and no secret material', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/me/identities')
        .set('Authorization', bearer(ADA))
        .expect(200);

      // The stored rows really do hold a derivation — see `identityRow` — so this
      // is a claim about the mapper and not about a world with nothing to leak.
      expect(Object.keys(response.body[0]).sort().join(',')).toBe(
        'createdAt,id,lastUsedAt,provider,providerAccountId,userId',
      );
      const body = JSON.stringify(response.body).toLowerCase();
      for (const forbidden of ['argon', 'secret', 'hash', 'memorycost']) {
        expect(body).not.toContain(forbidden);
      }
    });

    it('survives the reviver the webapp parses it with', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/me/identities')
        .set('Authorization', bearer(ADA))
        .expect(200);

      expect(AuthIdentity.fromJSON(response.body[0])).toBeInstanceOf(AuthIdentity);
    });
  });

  describe('giving one up', () => {
    it('removes it when the actor holds more than one', async () => {
      await request(app.getHttpServer())
        .delete(`/users/me/identities/${ADA_FEDERATED_IDENTITY}`)
        .set('Authorization', bearer(ADA))
        .expect(204);

      expect(source.byId(AuthIdentityRecord, ADA_FEDERATED_IDENTITY)).toBeUndefined();
      expect(source.byId(AuthIdentityRecord, ADA_LOCAL_IDENTITY)).toBeDefined();
    });

    it('records it, naming the provider and not the account it names', async () => {
      await request(app.getHttpServer())
        .delete(`/users/me/identities/${ADA_FEDERATED_IDENTITY}`)
        .set('Authorization', bearer(ADA))
        .expect(204);

      const entry = recorded.find((written) => written.action === AuditAction.IDENTITY_UNLINKED);
      expect(entry).toBeDefined();
      expect(entry!.metadata).toEqual({ provider: AuthProvider.GOOGLE });
      // For a password identity the account identifier is the person's address,
      // and an address written into a table nothing may correct is one that
      // cannot later be forgotten on request.
      expect(JSON.stringify(entry)).not.toContain('example.test');
    });

    it('refuses the only identity a person has, with 409', async () => {
      await request(app.getHttpServer())
        .delete(`/users/me/identities/${GRACE_SOLE_IDENTITY}`)
        .set('Authorization', bearer(GRACE))
        .expect(409);

      // Refusing after removing would be no refusal at all.
      expect(source.byId(AuthIdentityRecord, GRACE_SOLE_IDENTITY)).toBeDefined();
    });

    it('refuses one belonging to somebody else with 404, not 409', async () => {
      // `GRACE_SOLE_IDENTITY` is its owner's last identity, which is what gives this test
      // its teeth: an implementation that asked "would this be the last one?"
      // before asking "is this yours?" answers 409 here and refuses on a ground
      // that was never true — telling Ada to add a second identity before
      // retrying, when there was nothing of hers to remove.
      await request(app.getHttpServer())
        .delete(`/users/me/identities/${GRACE_SOLE_IDENTITY}`)
        .set('Authorization', bearer(ADA))
        .expect(404);

      expect(source.byId(AuthIdentityRecord, GRACE_SOLE_IDENTITY)).toBeDefined();
    });

    it('answers an id nobody holds the same way as one held by somebody else', async () => {
      const stranger = await request(app.getHttpServer())
        .delete(`/users/me/identities/${GRACE_SOLE_IDENTITY}`)
        .set('Authorization', bearer(ADA));
      const absent = await request(app.getHttpServer())
        .delete('/users/me/identities/99999999-9999-4999-8999-999999999999')
        .set('Authorization', bearer(ADA));

      expect(stranger.status).toBe(absent.status);
      expect(stranger.body).toStrictEqual(absent.body);
    });

    it('records nothing when it refuses', async () => {
      // The sibling of the reset-password defect, one level down: an entry
      // written before the thing it describes has happened is permanent, because
      // `audit_entries` refuses UPDATE and DELETE to the role this process
      // connects as. `unlinkIdentity` asks core's policy, then deletes, then
      // records — and only that order makes every entry in the table true.
      await request(app.getHttpServer())
        .delete(`/users/me/identities/${GRACE_SOLE_IDENTITY}`)
        .set('Authorization', bearer(GRACE))
        .expect(409);
      await request(app.getHttpServer())
        .delete(`/users/me/identities/${GRACE_SOLE_IDENTITY}`)
        .set('Authorization', bearer(ADA))
        .expect(404);

      expect(recorded).toEqual([]);
    });

    it('records nothing when the removal itself fails', async () => {
      // The other half of "the entry is written after the thing it describes",
      // and the half that needs a failure to be observable at all: with a store
      // that cannot fail, recording before deleting and recording after are
      // indistinguishable, so the order would be pinned by nothing. Here the
      // delete throws, and the only correct outcome is a history that does not
      // claim an identity was unlinked.
      identityRepo.delete = async () => {
        throw new Error('the store refused the delete');
      };

      await request(app.getHttpServer())
        .delete(`/users/me/identities/${ADA_FEDERATED_IDENTITY}`)
        .set('Authorization', bearer(ADA))
        .expect(500);

      expect(recorded).toEqual([]);
      expect(source.byId(AuthIdentityRecord, ADA_FEDERATED_IDENTITY)).toBeDefined();
    });

    it('refuses an identifier that is not one', async () => {
      await request(app.getHttpServer())
        .delete('/users/me/identities/not-an-identifier')
        .set('Authorization', bearer(ADA))
        .expect(400);
    });
  });

  describe('beginning a link', () => {
    it('is closed to a caller with no credential', async () => {
      // The link route carries no @Public(): the global JwtAuthGuard closes
      // it exactly as it closes `list` and `unlink` above. See the metadata
      // assertion in `auth/oauth/__tests__/oauth.controller.spec.ts`, which
      // reads this off the shipped handler rather than calling it.
      await request(app.getHttpServer()).post('/users/me/identities/GOOGLE').expect(401);
      expect(oauth.beginLink).not.toHaveBeenCalled();
    });

    it('asks OAuthService.beginLink for the actor and the named provider', async () => {
      oauth.beginLink.mockResolvedValue('https://provider.example.test/authorize?state=abc');

      const response = await request(app.getHttpServer())
        .post('/users/me/identities/GOOGLE')
        .set('Authorization', bearer(ADA))
        .expect(200);

      expect(response.body).toEqual({
        authorizationUrl: 'https://provider.example.test/authorize?state=abc',
      });
      expect(oauth.beginLink).toHaveBeenCalledWith(ADA, 'GOOGLE');
    });

    it('answers JSON, not a redirect — a fetch response, never followed by the browser', async () => {
      oauth.beginLink.mockResolvedValue('https://provider.example.test/authorize');

      const response = await request(app.getHttpServer())
        .post('/users/me/identities/GOOGLE')
        .set('Authorization', bearer(ADA));

      expect(response.status).toBe(200);
      expect(response.header.location).toBeUndefined();
    });

    it('passes through whatever OAuthService refuses with, unmodified', async () => {
      // An unregistered provider is `OAuthService.beginLink`'s own refusal
      // (`NotFoundException`) — this controller adds no refusal of its own on
      // top of it.
      oauth.beginLink.mockRejectedValue(new NotFoundException());

      await request(app.getHttpServer())
        .post('/users/me/identities/NOT-A-PROVIDER')
        .set('Authorization', bearer(ADA))
        .expect(404);
    });
  });

  describe('who wires it, which no probe application can show', () => {
    it('AuthModule registers the controller — not IdentitiesModule, whose own module houses the file', () => {
      // See `IdentitiesController`'s own doc, and `identities.module.ts`'s:
      // `beginLink` needs `OAuthService`, which lives in `AuthModule`, and
      // `AuthModule` already imports `IdentitiesModule` for `AuthService`'s
      // own need of `IdentitiesService` — importing it back would cycle the
      // two modules.
      expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AuthModule)).toContain(
        IdentitiesController,
      );
      expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, IdentitiesModule) ?? [])
        .not.toContain(IdentitiesController);
    });

    it('IdentitiesModule still provides the service every consumer of it resolves', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, IdentitiesModule)).toContain(
        IdentitiesService,
      );
    });
  });
});
