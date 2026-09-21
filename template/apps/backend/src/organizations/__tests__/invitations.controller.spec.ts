import { INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import request from 'supertest';
import type { Response } from 'supertest';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { InvitationStatus, OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { AuditService } from '../../audit/audit.service';
import { hashOpaqueToken, generateOpaqueToken } from '../../common/crypto';
import { FakeDataSource } from '../../common/testing';
import { PermissionsGuard, PrincipalService } from '../../authorization';
import { ResourceGrantRecord } from '../../authorization/resource-grant-record.entity';
import { JwtStrategy } from '../../auth/strategies';
import type { IMailer, OutboundMessage } from '../../mail';
import { MAILER } from '../../mail';
import { UserRecord } from '../../users/user-record.entity';
import { InvitationRecord } from '../invitation-record.entity';
import { InvitationsController } from '../invitations.controller';
import { MembershipRecord } from '../membership-record.entity';
import { OrganizationRecord } from '../organization-record.entity';
import { OrganizationsModule } from '../organizations.module';
import { OrganizationsService } from '../organizations.service';

/**
 * The transport half of invitations: issuing, listing, revoking, and
 * redeeming.
 *
 * Three properties live here and nowhere else, because each is invisible to
 * `runIOrganizationServiceContract` (core's shared suite never builds a world
 * where the account accepting is not the address invited, so it cannot fail
 * on the address check) or is about the wire rather than the domain:
 *
 * - **The stored row carries a digest of the token, never the token.**
 *   Recomputed independently from `hashOpaqueToken`, never compared against
 *   whatever the service just returned — that comparison would be a
 *   tautology.
 * - **The address is checked at redemption**, refusing an account that does
 *   not hold the address the invitation was sent to.
 * - **Revoked, already-accepted and expired answer identically** — the same
 *   status and the same body — while a token that was never issued answers
 *   distinguishably. Core's own contract asserts the domain side of both
 *   halves; this file asserts they survive to the HTTP response.
 */

const WEBAPP_URL = 'https://app.example.test';

const OWNER = '11111111-1111-4111-8111-111111111111' as UserId;
const INVITEE = '22222222-2222-4222-8222-222222222222' as UserId;
const WRONG_ACCOUNT = '33333333-3333-4333-8333-333333333333' as UserId;
const OUTSIDER = '44444444-4444-4444-8444-444444444444' as UserId;
// A real member of the organization, in the role that carries neither
// `member:invite`, `invitation:read` nor `invitation:revoke`. The only actor
// that can tell a guarded route on this controller from an unguarded one.
const MEMBER = '99999999-9999-4999-8999-999999999999' as UserId;
const SESSION = '55555555-5555-4555-8555-555555555555' as SessionId;

const ORG_1 = '66666666-6666-4666-8666-666666666666';
const ORG_ABSENT = '77777777-7777-4777-8777-777777777777';

const INVITEE_EMAIL = 'invitee@example.test';
const WRONG_ACCOUNT_EMAIL = 'wrong@example.test';

const SIGNING_KEY = 'invitations-controller-spec-signing-key';

const EPOCH = new Date('2026-09-20T10:00:00.000Z');
// Relative to the real wall clock, never to `EPOCH` — `OrganizationsService`
// reads `new Date()` when it judges an invitation's openness (the same
// convention every other method in this class follows for `now`), so a
// fixture that must still be open, or must already be expired, has to be
// pinned against the clock the service actually reads.
const A_WEEK_FROM_NOW = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const A_SECOND_AGO = new Date(Date.now() - 1000);

describe('InvitationsController', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let source: FakeDataSource;
  let sent: OutboundMessage[];

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  beforeEach(async () => {
    source = new FakeDataSource();
    sent = [];

    const audit = new AuditService(
      repo<AuditEntryRecord>(AuditEntryRecord),
      repo<UserRecord>(UserRecord),
      repo<MembershipRecord>(MembershipRecord),
    );
    const mailer: IMailer = {
      send: async (message) => {
        sent.push(message);
      },
    };
    const organizations = new OrganizationsService(
      repo<OrganizationRecord>(OrganizationRecord),
      repo<MembershipRecord>(MembershipRecord),
      repo<InvitationRecord>(InvitationRecord),
      repo<UserRecord>(UserRecord),
      source as unknown as DataSource,
      audit,
      mailer,
      new ConfigService({ PUBLIC_WEBAPP_URL: WEBAPP_URL }),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: SIGNING_KEY })] }),
        I18N,
        PassportModule,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [InvitationsController],
      providers: [
        // THE SHIPPED ARRAY, so the statuses below are the ones the
        // application really produces.
        ...GLOBAL_PROVIDERS,
        JwtStrategy,
        { provide: OrganizationsService, useValue: organizations },
        { provide: AuditService, useValue: audit },
        { provide: MAILER, useValue: mailer },
        {
          provide: getRepositoryToken(OrganizationRecord),
          useValue: repo<OrganizationRecord>(OrganizationRecord),
        },
        {
          provide: getRepositoryToken(MembershipRecord),
          useValue: repo<MembershipRecord>(MembershipRecord),
        },
        {
          provide: getRepositoryToken(InvitationRecord),
          useValue: repo<InvitationRecord>(InvitationRecord),
        },
        {
          provide: getRepositoryToken(UserRecord),
          useValue: repo<UserRecord>(UserRecord),
        },
        // Constructed by the framework, exactly as the application constructs
        // them — the guard the three organization-scoped routes name, and the
        // hydrator it asks.
        PermissionsGuard,
        PrincipalService,
        {
          provide: getRepositoryToken(ResourceGrantRecord),
          useValue: repo<ResourceGrantRecord>(ResourceGrantRecord),
        },
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

  /** Seeds `org` with `owner` as its sole OWNER, and the owner's own account. */
  const seedOrganization = (id: string, owner: string): void => {
    seedUser(owner, `${owner}@example.test`);
    source.seed(OrganizationRecord, [
      { id, name: 'Acme Works', slug: 'acme-works', createdAt: EPOCH, updatedAt: EPOCH, deletedAt: null },
    ]);
    source.seed(MembershipRecord, [
      {
        id: `membership-${id}-${owner}`,
        organizationId: id,
        userId: owner,
        role: OrgRole.OWNER,
        createdAt: EPOCH,
        updatedAt: EPOCH,
      },
    ]);
  };

  /**
   * Seeds a real account, the way `acceptInvitation`'s address check needs one
   * — and the way every actor now needs one, because `PrincipalService` reads
   * the platform role off the row rather than out of the credential.
   *
   * Idempotent: `seedOrganization` seeds the owner's account so that a spec does
   * not have to remember to, and several tests seed the same person again with
   * the address the invitation was sent to. `FakeDataSource` enforces no unique
   * constraint, so a second row would be stored and the first one answered —
   * which is a way to have a test pass against a row it did not write.
   */
  const seedUser = (id: string, email: string): void => {
    if (source.byId(UserRecord, id) !== undefined) return;
    source.seed(UserRecord, [
      {
        id,
        email,
        displayName: 'Somebody',
        status: UserStatus.ACTIVE,
        platformRole: PlatformRole.PLATFORM_USER,
        emailVerifiedAt: EPOCH,
        createdAt: EPOCH,
        updatedAt: EPOCH,
        deletedAt: null,
      },
    ]);
  };

  /** Adds one more membership to an already-seeded organization, and its account. */
  const seedMembership = (organizationId: string, userId: string, role: OrgRole): void => {
    seedUser(userId, `${userId}@example.test`);
    source.seed(MembershipRecord, [
      {
        id: `membership-${organizationId}-${userId}`,
        organizationId,
        userId,
        role,
        createdAt: EPOCH,
        updatedAt: EPOCH,
      },
    ]);
  };

  /** Seeds a PENDING invitation directly, bypassing the issuing endpoint, with a known token. */
  const seedInvitation = (
    id: string,
    organizationId: string,
    email: string,
    overrides: Partial<{
      status: InvitationStatus;
      expiresAt: Date;
      acceptedAt: Date | null;
      acceptedByUserId: string | null;
      role: OrgRole;
    }> = {},
  ): string => {
    const generated = generateOpaqueToken();
    source.seed(InvitationRecord, [
      {
        id,
        organizationId,
        email,
        role: overrides.role ?? OrgRole.MEMBER,
        status: overrides.status ?? InvitationStatus.PENDING,
        tokenHash: generated.hash,
        invitedByUserId: OWNER,
        expiresAt: overrides.expiresAt ?? A_WEEK_FROM_NOW,
        createdAt: EPOCH,
        acceptedAt: overrides.acceptedAt ?? null,
        acceptedByUserId: overrides.acceptedByUserId ?? null,
      },
    ]);
    return generated.token;
  };

  /** Pulls the token out of the last mailed invitation link. */
  const tokenFromLastMail = (): string => {
    const body = sent[sent.length - 1].body;
    const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(body);
    if (match === null) throw new Error(`no token in the last message: ${body}`);
    return match[1];
  };

  /** Every route this controller mounts, as a verb, a path and a body. */
  const ROUTES: [string, string, Record<string, unknown> | undefined][] = [
    ['post', `/organizations/${ORG_1}/invitations`, { email: INVITEE_EMAIL, role: 'MEMBER' }],
    ['get', `/organizations/${ORG_1}/invitations`, undefined],
    ['delete', `/organizations/${ORG_1}/invitations/${ORG_ABSENT}`, undefined],
    ['post', `/invitations/some-token/accept`, undefined],
  ];

  const call = (verb: string, path: string, body?: Record<string, unknown>): Promise<Response> => {
    const agent = request(app.getHttpServer()) as unknown as Record<
      string,
      (path: string) => request.Test
    >;
    const test = agent[verb](path);
    return body === undefined ? test : test.send(body);
  };

  describe('authentication', () => {
    it.each(ROUTES)('%s %s is closed to a caller with no credential', async (verb, path, body) => {
      const response = await call(verb, path, body);
      expect(response.status).toBe(401);
    });
  });

  describe('POST /organizations/:id/invitations', () => {
    it('issues a PENDING invitation and mails a link carrying the token', async () => {
      seedOrganization(ORG_1, OWNER);

      const response = await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/invitations`)
        .set('Authorization', bearer(OWNER))
        .send({ email: INVITEE_EMAIL, role: 'ADMIN' })
        .expect(201);

      expect(response.body).toMatchObject({
        organizationId: ORG_1,
        email: INVITEE_EMAIL,
        role: 'ADMIN',
        status: 'PENDING',
      });

      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(INVITEE_EMAIL);
      expect(sent[0].body).toContain(WEBAPP_URL);
      expect(tokenFromLastMail().length).toBeGreaterThan(0);
    });

    it('refuses a non-member, indistinguishably from an id nobody ever issued', async () => {
      seedOrganization(ORG_1, OWNER);

      const notMine = await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/invitations`)
        .set('Authorization', bearer(OUTSIDER))
        .send({ email: INVITEE_EMAIL, role: 'MEMBER' });

      const neverIssued = await request(app.getHttpServer())
        .post(`/organizations/${ORG_ABSENT}/invitations`)
        .set('Authorization', bearer(OUTSIDER))
        .send({ email: INVITEE_EMAIL, role: 'MEMBER' });

      expect(notMine.status).toBe(404);
      expect(notMine.status).toBe(neverIssued.status);
      expect(notMine.body).toStrictEqual(neverIssued.body);
      expect(sent).toHaveLength(0);
    });

    it('refuses inviting an existing member, with 409', async () => {
      seedOrganization(ORG_1, OWNER);
      seedUser(INVITEE, INVITEE_EMAIL);
      source.seed(MembershipRecord, [
        {
          id: `membership-${ORG_1}-${INVITEE}`,
          organizationId: ORG_1,
          userId: INVITEE,
          role: OrgRole.MEMBER,
          createdAt: EPOCH,
          updatedAt: EPOCH,
        },
      ]);

      const response = await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/invitations`)
        .set('Authorization', bearer(OWNER))
        .send({ email: INVITEE_EMAIL, role: 'MEMBER' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ALREADY_A_MEMBER');
      expect(sent).toHaveLength(0);
    });

    it('refuses a body carrying a field this DTO does not declare', async () => {
      seedOrganization(ORG_1, OWNER);

      await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/invitations`)
        .set('Authorization', bearer(OWNER))
        .send({ email: INVITEE_EMAIL, role: 'MEMBER', invitedByUserId: OWNER })
        .expect(400);
    });

    it('refuses an address that is not a well-formed email', async () => {
      seedOrganization(ORG_1, OWNER);

      await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/invitations`)
        .set('Authorization', bearer(OWNER))
        .send({ email: 'not-an-email', role: 'MEMBER' })
        .expect(400);
    });
  });

  describe('GET /organizations/:id/invitations', () => {
    it('lists the organization\'s invitations', async () => {
      seedOrganization(ORG_1, OWNER);
      seedInvitation('invitation-1', ORG_1, INVITEE_EMAIL);

      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/invitations`)
        .set('Authorization', bearer(OWNER))
        .expect(200);

      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0]).toMatchObject({ email: INVITEE_EMAIL, status: 'PENDING' });
      // The wire shape carries no token and no hash — `Invitation` has no
      // field for either. See `InvitationRecord`'s own TSDoc.
      expect(response.body.data[0]).not.toHaveProperty('token');
      expect(response.body.data[0]).not.toHaveProperty('tokenHash');
    });

    it('filters to one status when asked', async () => {
      seedOrganization(ORG_1, OWNER);
      seedInvitation('invitation-1', ORG_1, INVITEE_EMAIL, { status: InvitationStatus.PENDING });
      seedInvitation('invitation-2', ORG_1, 'someone-else@example.test', {
        status: InvitationStatus.REVOKED,
      });

      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/invitations?status=REVOKED`)
        .set('Authorization', bearer(OWNER))
        .expect(200);

      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0].id).toBe('invitation-2');
    });

    it('does not reveal a non-member organization\'s invitations', async () => {
      seedOrganization(ORG_1, OWNER);
      seedInvitation('invitation-1', ORG_1, INVITEE_EMAIL);

      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/invitations`)
        .set('Authorization', bearer(OUTSIDER));

      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain(INVITEE_EMAIL);
    });
  });

  describe('DELETE /organizations/:id/invitations/:invitationId', () => {
    // `:invitationId` runs through `ParseUuidParamPipe`, so a seeded id used in
    // a path has to be UUID-shaped, unlike the plain strings the other
    // describe blocks use for ids that never cross that pipe.
    const INVITATION_1 = '88888888-8888-4888-8888-888888888888';

    it('revokes a PENDING invitation and returns it REVOKED', async () => {
      seedOrganization(ORG_1, OWNER);
      const token = seedInvitation(INVITATION_1, ORG_1, INVITEE_EMAIL);

      const response = await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/invitations/${INVITATION_1}`)
        .set('Authorization', bearer(OWNER))
        .expect(200);

      expect(response.body.status).toBe('REVOKED');

      // The value its recipient holds must stop redeeming.
      seedUser(INVITEE, INVITEE_EMAIL);
      const redeem = await request(app.getHttpServer())
        .post(`/invitations/${token}/accept`)
        .set('Authorization', bearer(INVITEE));
      expect(redeem.status).toBe(410);
    });

    it('rejects an invitation id that does not exist, with 404', async () => {
      seedOrganization(ORG_1, OWNER);

      const response = await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/invitations/${ORG_ABSENT}`)
        .set('Authorization', bearer(OWNER));

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('INVITATION_NOT_FOUND');
    });

    it('refuses to revoke an invitation that is already closed, with 410', async () => {
      seedOrganization(ORG_1, OWNER);
      seedInvitation(INVITATION_1, ORG_1, INVITEE_EMAIL, { status: InvitationStatus.REVOKED });

      const response = await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/invitations/${INVITATION_1}`)
        .set('Authorization', bearer(OWNER));

      expect(response.status).toBe(410);
      expect(response.body.code).toBe('INVITATION_NO_LONGER_OPEN');
    });
  });

  describe('POST /invitations/:token/accept', () => {
    // Property 1: the row stores the digest, never the token. The assertion
    // recomputes the digest independently from `hashOpaqueToken` rather than
    // reading back whatever the service already reported storing — comparing
    // the service's own output to itself would be a tautology that a service
    // storing the raw token could still pass.
    it('stores the digest of the token and never the token', async () => {
      seedOrganization(ORG_1, OWNER);
      seedUser(INVITEE, INVITEE_EMAIL);

      await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/invitations`)
        .set('Authorization', bearer(OWNER))
        .send({ email: INVITEE_EMAIL, role: 'MEMBER' })
        .expect(201);
      const token = tokenFromLastMail();

      const rows = source.all(InvitationRecord);
      expect(rows).toHaveLength(1);
      const stored = rows[0] as { tokenHash: string };

      expect(stored.tokenHash).not.toBe(token);
      expect(stored.tokenHash).toBe(hashOpaqueToken(token));

      await request(app.getHttpServer())
        .post(`/invitations/${token}/accept`)
        .set('Authorization', bearer(INVITEE))
        .expect(201);
    });

    // Property 3: the address is checked at redemption. An account holding a
    // leaked or forwarded link, but not the address the invitation names, may
    // not redeem it — and no membership is created when it tries.
    it('refuses a token redeemed by an account with a different address', async () => {
      seedOrganization(ORG_1, OWNER);
      seedUser(WRONG_ACCOUNT, WRONG_ACCOUNT_EMAIL);
      const token = seedInvitation('invitation-1', ORG_1, INVITEE_EMAIL);

      const response = await request(app.getHttpServer())
        .post(`/invitations/${token}/accept`)
        .set('Authorization', bearer(WRONG_ACCOUNT));

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('INVITATION_ADDRESS_MISMATCH');
      expect(
        source.all(MembershipRecord).filter((row) => row.organizationId === ORG_1),
      ).toHaveLength(1); // the seeded OWNER membership only — none created
      expect(source.byId(InvitationRecord, 'invitation-1')?.status).toBe(InvitationStatus.PENDING);
    });

    // Property 4: revoked, already-accepted and expired answer identically —
    // `InvitationNoLongerOpenError` for all three — while a token nobody ever
    // issued answers distinguishably. A caller presenting a closed token
    // cannot learn WHICH of the three closed it.
    it('answers a revoked, accepted and expired token identically', async () => {
      seedOrganization(ORG_1, OWNER);
      seedUser(INVITEE, INVITEE_EMAIL);

      const revokedToken = seedInvitation('invitation-revoked', ORG_1, INVITEE_EMAIL, {
        status: InvitationStatus.REVOKED,
      });
      const acceptedToken = seedInvitation('invitation-accepted', ORG_1, INVITEE_EMAIL, {
        status: InvitationStatus.ACCEPTED,
        acceptedAt: EPOCH,
        acceptedByUserId: INVITEE,
      });
      const expiredToken = seedInvitation('invitation-expired', ORG_1, INVITEE_EMAIL, {
        status: InvitationStatus.PENDING,
        expiresAt: A_SECOND_AGO,
      });

      const revoked = await request(app.getHttpServer())
        .post(`/invitations/${revokedToken}/accept`)
        .set('Authorization', bearer(INVITEE));
      const accepted = await request(app.getHttpServer())
        .post(`/invitations/${acceptedToken}/accept`)
        .set('Authorization', bearer(INVITEE));
      const expired = await request(app.getHttpServer())
        .post(`/invitations/${expiredToken}/accept`)
        .set('Authorization', bearer(INVITEE));

      for (const response of [revoked, accepted, expired]) {
        expect(response.status).toBe(410);
        expect(response.body.code).toBe('INVITATION_NO_LONGER_OPEN');
      }
      expect(revoked.body).toStrictEqual(accepted.body);
      expect(revoked.body).toStrictEqual(expired.body);

      // Distinguishably: a token that was never issued at all.
      const neverIssued = await request(app.getHttpServer())
        .post('/invitations/never-issued-token/accept')
        .set('Authorization', bearer(INVITEE));
      expect(neverIssued.status).toBe(404);
      expect(neverIssued.body.code).toBe('INVITATION_NOT_FOUND');
      expect(neverIssued.body).not.toStrictEqual(revoked.body);
    });

    it('accepts an open invitation, creating a membership with the invited role', async () => {
      seedOrganization(ORG_1, OWNER);
      seedUser(INVITEE, INVITEE_EMAIL);
      const token = seedInvitation('invitation-1', ORG_1, INVITEE_EMAIL, { role: OrgRole.ADMIN });

      const response = await request(app.getHttpServer())
        .post(`/invitations/${token}/accept`)
        .set('Authorization', bearer(INVITEE))
        .expect(201);

      expect(response.body).toMatchObject({ organizationId: ORG_1, userId: INVITEE, role: 'ADMIN' });
      expect(source.byId(InvitationRecord, 'invitation-1')?.status).toBe(InvitationStatus.ACCEPTED);
      expect(source.byId(InvitationRecord, 'invitation-1')?.acceptedByUserId).toBe(INVITEE);
    });

    it('refuses a second acceptance of the same token, with 410', async () => {
      seedOrganization(ORG_1, OWNER);
      seedUser(INVITEE, INVITEE_EMAIL);
      const token = seedInvitation('invitation-1', ORG_1, INVITEE_EMAIL);

      await request(app.getHttpServer())
        .post(`/invitations/${token}/accept`)
        .set('Authorization', bearer(INVITEE))
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/invitations/${token}/accept`)
        .set('Authorization', bearer(INVITEE));

      expect(response.status).toBe(410);
      expect(response.body.code).toBe('INVITATION_NO_LONGER_OPEN');
    });

    it('records INVITATION_ACCEPTED against the organization the invitation was in', async () => {
      seedOrganization(ORG_1, OWNER);
      seedUser(INVITEE, INVITEE_EMAIL);
      const token = seedInvitation('invitation-1', ORG_1, INVITEE_EMAIL);

      await request(app.getHttpServer())
        .post(`/invitations/${token}/accept`)
        .set('Authorization', bearer(INVITEE))
        .expect(201);

      const entry = source
        .all(AuditEntryRecord)
        .find((row) => row.action === AuditAction.INVITATION_ACCEPTED);
      expect(entry).toBeDefined();
      // Asserted against the world's own seeded id, never against the
      // service's own return.
      expect(entry!.organizationId).toBe(ORG_1);
      expect(entry!.actorUserId).toBe(INVITEE);
    });

    // Fix round 1, Important finding: `inviteMember` refuses a SECOND
    // invitation to an address that already has a membership, but nothing
    // stops a SECOND invitation issued before the FIRST is accepted — the
    // ordinary way this happens is an admin inviting twice because they were
    // not sure the first mail arrived, and the recipient clicking both
    // links. The sequential half of the guard: the first accept succeeds,
    // the second is refused rather than creating a second membership row.
    it('refuses accepting a second invitation once the first has already made the account a member', async () => {
      seedOrganization(ORG_1, OWNER);
      seedUser(INVITEE, INVITEE_EMAIL);
      const first = seedInvitation('invitation-first', ORG_1, INVITEE_EMAIL);
      const second = seedInvitation('invitation-second', ORG_1, INVITEE_EMAIL);

      await request(app.getHttpServer())
        .post(`/invitations/${first}/accept`)
        .set('Authorization', bearer(INVITEE))
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/invitations/${second}/accept`)
        .set('Authorization', bearer(INVITEE));

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ALREADY_A_MEMBER');

      // Exactly one membership, never two, for this account in this
      // organization.
      expect(
        source
          .all(MembershipRecord)
          .filter((row) => row.organizationId === ORG_1 && row.userId === INVITEE),
      ).toHaveLength(1);
      // Refused, not consumed: the second invitation was never written to —
      // it stays exactly as open as it was before this request.
      expect(source.byId(InvitationRecord, 'invitation-second')?.status).toBe(
        InvitationStatus.PENDING,
      );
    });

    // The concurrent half of the same guard: two DIFFERENT tokens for the
    // same address, redeemed at the same moment, each having just read no
    // existing membership because neither transaction has committed yet.
    // Nothing in this backend's own code can make that race happen against
    // `FakeDataSource` (it enforces no unique constraints at all — see that
    // class's own "Properties this double CANNOT express", item 4), so the
    // `23505` Postgres would actually raise is injected directly, the same
    // way `AuthService`'s own duplicate-registration race is proved.
    it('maps a concurrent unique-violation on the membership insert to 409 ALREADY_A_MEMBER', async () => {
      seedOrganization(ORG_1, OWNER);
      seedUser(INVITEE, INVITEE_EMAIL);
      const token = seedInvitation('invitation-race', ORG_1, INVITEE_EMAIL);

      const insert = source.insert.bind(source);
      source.insert = (entity, values, journal) => {
        if (entity.name === MembershipRecord.name) {
          throw Object.assign(
            new Error('duplicate key value violates unique constraint "uq_memberships_org_user"'),
            { code: '23505' },
          );
        }
        return insert(entity, values, journal);
      };

      const response = await request(app.getHttpServer())
        .post(`/invitations/${token}/accept`)
        .set('Authorization', bearer(INVITEE));

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ALREADY_A_MEMBER');
    });
  });

  /**
   * Authorization, asserted by the one actor whose answer differs.
   *
   * This block exists because the three guards on this controller were, for one
   * commit, wiring nothing asserted: deleting `@UseGuards(PermissionsGuard)`
   * from any of the three left the whole backend suite green at 774. The gap was
   * not cosmetic. `ROLE_PERMISSIONS` gives a MEMBER `organization:read` and
   * `member:read`, and a VIEWER `organization:read` alone, while
   * `OrganizationsService` checks **membership** and never the role — so with
   * the guards gone, anybody who belongs to an organization at all can invite
   * members to it, read every outstanding offer, and withdraw them.
   *
   * The OWNER every other test in this file uses cannot show that, because an
   * OWNER is allowed either way; nor can the OUTSIDER, who is refused either way
   * by `requireMember`. A MEMBER is the actor the two answers differ for.
   *
   * | Deleted from shipped code | Caught by |
   * |---|---|
   * | `invitations.controller.ts`: the guard or the permission on `POST /organizations/:id/invitations` | `refuses a MEMBER inviting somebody, and issues nothing` |
   * | `invitations.controller.ts`: the guard or the permission on `GET /organizations/:id/invitations` | `refuses a MEMBER reading the outstanding invitations` |
   * | `invitations.controller.ts`: the guard or the permission on `DELETE /organizations/:id/invitations/:invitationId` | `refuses a MEMBER revoking an invitation, which stays open` |
   */
  describe('authorization: what a role does and does not carry', () => {
    const INVITATION_1 = '88888888-8888-4888-8888-888888888888';

    beforeEach(() => {
      seedOrganization(ORG_1, OWNER);
      seedMembership(ORG_1, MEMBER, OrgRole.MEMBER);
    });

    it('refuses a MEMBER inviting somebody, and issues nothing', async () => {
      const response = await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/invitations`)
        .set('Authorization', bearer(MEMBER))
        .send({ email: INVITEE_EMAIL, role: 'MEMBER' });

      expect(response.status).toBe(404);
      // The status alone would be satisfied by a service refusing for some other
      // reason; these two are what say nothing happened.
      expect(source.all(InvitationRecord)).toHaveLength(0);
      expect(sent).toHaveLength(0);
    });

    it('refuses a MEMBER reading the outstanding invitations', async () => {
      seedInvitation(INVITATION_1, ORG_1, INVITEE_EMAIL);

      const response = await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/invitations`)
        .set('Authorization', bearer(MEMBER));

      expect(response.status).toBe(404);
      // Not merely refused — nothing about the invitation crossed the wire.
      expect(JSON.stringify(response.body)).not.toContain(INVITEE_EMAIL);
    });

    it('refuses a MEMBER revoking an invitation, which stays open', async () => {
      const token = seedInvitation(INVITATION_1, ORG_1, INVITEE_EMAIL);

      const response = await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/invitations/${INVITATION_1}`)
        .set('Authorization', bearer(MEMBER));

      expect(response.status).toBe(404);
      expect(source.byId(InvitationRecord, INVITATION_1)?.status).toBe(InvitationStatus.PENDING);
      // And the offer its recipient holds still redeems, which is the part a
      // status assertion cannot see.
      seedUser(INVITEE, INVITEE_EMAIL);
      await request(app.getHttpServer())
        .post(`/invitations/${token}/accept`)
        .set('Authorization', bearer(INVITEE))
        .expect(201);
    });

    it('lets an ADMIN do all three, so the refusals above are about the role', async () => {
      // Without this the three cases above are equally satisfied by a guard that
      // refused everybody — which is a guard nobody notices is broken until an
      // organization cannot invite anyone.
      seedMembership(ORG_1, OUTSIDER, OrgRole.ADMIN);

      await request(app.getHttpServer())
        .post(`/organizations/${ORG_1}/invitations`)
        .set('Authorization', bearer(OUTSIDER))
        .send({ email: INVITEE_EMAIL, role: 'MEMBER' })
        .expect(201);
      await request(app.getHttpServer())
        .get(`/organizations/${ORG_1}/invitations`)
        .set('Authorization', bearer(OUTSIDER))
        .expect(200);
      seedInvitation(INVITATION_1, ORG_1, WRONG_ACCOUNT_EMAIL);
      await request(app.getHttpServer())
        .delete(`/organizations/${ORG_1}/invitations/${INVITATION_1}`)
        .set('Authorization', bearer(OUTSIDER))
        .expect(200);
    });
  });

  describe('OrganizationsModule wires it, which no probe application can show', () => {
    it('registers InvitationsController', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, OrganizationsModule)).toContain(
        InvitationsController,
      );
    });
  });
});
