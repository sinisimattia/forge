import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import request from 'supertest';
import type { Response } from 'supertest';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { GrantId, ResourceType } from '__FORGE_SCOPE__/core/authorization/types';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { InvitationStatus, OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { GLOBAL_PROVIDERS, I18N } from '../app.module';
import { AuditEntryRecord } from '../audit/audit-entry-record.entity';
import { AuditService } from '../audit/audit.service';
import { OrganizationAuditController } from '../audit/organization-audit.controller';
import { JwtStrategy } from '../auth/strategies';
import { AuthorizationService } from '../authorization/authorization.service';
import { GrantsController } from '../authorization/grants.controller';
import { PermissionsGuard, PrincipalService } from '../authorization';
import { ResourceGrantRecord } from '../authorization/resource-grant-record.entity';
import { generateOpaqueToken } from '../common/crypto';
import { FakeDataSource } from '../common/testing';
import type { IMailer } from '../mail';
import { InvitationRecord } from '../organizations/invitation-record.entity';
import { InvitationsController } from '../organizations/invitations.controller';
import { MembersController } from '../organizations/members.controller';
import { MembershipRecord } from '../organizations/membership-record.entity';
import { OrganizationRecord } from '../organizations/organization-record.entity';
import { OrganizationsController } from '../organizations/organizations.controller';
import { OrganizationsService } from '../organizations/organizations.service';
import { UserRecord } from '../users/user-record.entity';

/**
 * D9 — tenant isolation, over the wire, across every organization-scoped route
 * this backend mounts.
 *
 * ## Why this is here and not in a shared conformance suite (DEC-1)
 *
 * Tenant isolation is a property of a *server*. `organizations.security.
 * conformance.spec.ts` drives core's backend-only suite against
 * `OrganizationsService` directly and asserts the same boundary at the domain
 * level; this file asserts the half that only exists once there is a request:
 * the **status and the body** a refusal is served with, and the fact that they
 * are the same ones a request for something that does not exist is served with.
 * Neither file subsumes the other, and the reason is worth keeping in view:
 *
 * - The domain suite catches a service that resolves a row by id with no
 *   organization in the predicate. `PermissionsGuard` cannot catch that — it has
 *   already passed, correctly, for the organization the route named.
 * - This file catches a refusal that is *distinguishable*. The domain suite
 *   cannot catch that, because what reaches a caller is not the error's own text
 *   but whatever `HttpExceptionFilter` made of it.
 *
 * ## The assertion that carries D9, and why status alone is not it
 *
 * A cross-tenant request must be indistinguishable from a request for something
 * that does not exist. Comparing statuses alone passes for an implementation
 * that answers `404` to both and puts "you are not a member of this
 * organization" in one body and "no such organization" in the other — which
 * leaks exactly what the shared status was chosen to hide, through the one
 * channel a status code cannot close. **So the bodies are compared too**, and
 * the comparison is over every route at once: five refusal paths, each of which
 * could drift on its own.
 *
 * The control column is load-bearing. Every one of these routes answering `404`
 * to everybody satisfies the whole table, so each route is also called by
 * somebody entitled to it and must answer `200`.
 *
 * ## What this store cannot see
 *
 * `FakeDataSource` enforces no unique constraints (item 4 on its own inventory)
 * and no foreign keys (item 7). Nothing here is evidence about
 * `uq_memberships_org_user` or about what a real database does on a cascade;
 * the docker end-to-end suite's walk against a real Postgres is.
 */

const OWNER_A = '11111111-1111-4111-8111-111111111111' as UserId;
const MEMBER_A = '22222222-2222-4222-8222-222222222222' as UserId;
const OWNER_B = '33333333-3333-4333-8333-333333333333' as UserId;
const MEMBER_B = '44444444-4444-4444-8444-444444444444' as UserId;
/** Belongs to neither, and holds the address B's open invitation names. */
const OUTSIDER = '55555555-5555-4555-8555-555555555555' as UserId;
const SESSION = '66666666-6666-4666-8666-666666666666' as SessionId;

const ORG_A = '77777777-7777-4777-8777-777777777777';
const ORG_B = '88888888-8888-4888-8888-888888888888';
/** Well-formed for `ParseUuidParamPipe`, and no organization answers to it. */
const ORG_ABSENT = '99999999-9999-4999-8999-999999999999';

const INVITATION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVITATION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GRANT_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GRANT_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/**
 * Well-formed for `ParseUuidParamPipe`, and answering to nothing in either
 * tenant. Each is the right-hand side of a "the other tenant's row is as absent
 * as one that was never issued" comparison.
 */
const INVITATION_ABSENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const GRANT_ABSENT = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const USER_ABSENT = '10101010-1010-4010-8010-101010101010';

const SIGNING_KEY = 'tenant-isolation-spec-signing-key';
const WEBAPP_URL = 'https://app.example.test';

const EPOCH = new Date('2026-09-20T10:00:00.000Z');
const A_WEEK = 7 * 24 * 60 * 60 * 1000;

/** This suite exercises none of the invitation mail; a stub that records nothing suffices. */
const NOOP_MAILER: IMailer = { send: async () => undefined };

/** The kind of record the seeded grants are about. Any noun serves; see `ResourceType`. */
const RESOURCE_TYPE = 'document' as ResourceType;

describe('tenant isolation (D9)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let source: FakeDataSource;
  let principals: PrincipalService;

  /** The value B's open invitation was sent with. Re-generated per test. */
  let tokenB: string;

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  const seedAccount = (id: string, email: string): void => {
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

  const seedMembership = (organizationId: string, userId: string, role: OrgRole): void => {
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

  beforeEach(async () => {
    source = new FakeDataSource();

    seedAccount(OWNER_A, 'owner-a@example.test');
    seedAccount(MEMBER_A, 'member-a@example.test');
    seedAccount(OWNER_B, 'owner-b@example.test');
    seedAccount(MEMBER_B, 'member-b@example.test');
    seedAccount(OUTSIDER, 'outsider@example.test');

    source.seed(OrganizationRecord, [
      { id: ORG_A, name: 'Acme Works', slug: 'acme-works', createdAt: EPOCH, updatedAt: EPOCH, deletedAt: null },
      { id: ORG_B, name: 'Beta Industries', slug: 'beta-industries', createdAt: EPOCH, updatedAt: EPOCH, deletedAt: null },
    ]);

    // Disjoint, which is the world's central promise: seed anybody into both
    // and every refusal below stops being a refusal.
    seedMembership(ORG_A, OWNER_A, OrgRole.OWNER);
    seedMembership(ORG_A, MEMBER_A, OrgRole.MEMBER);
    seedMembership(ORG_B, OWNER_B, OrgRole.OWNER);
    seedMembership(ORG_B, MEMBER_B, OrgRole.MEMBER);

    const generatedA = generateOpaqueToken();
    const generatedB = generateOpaqueToken();
    tokenB = generatedB.token;
    source.seed(InvitationRecord, [
      {
        id: INVITATION_A,
        organizationId: ORG_A,
        email: 'invited-into-a@example.test',
        role: OrgRole.MEMBER,
        status: InvitationStatus.PENDING,
        tokenHash: generatedA.hash,
        invitedByUserId: OWNER_A,
        expiresAt: new Date(Date.now() + A_WEEK),
        createdAt: EPOCH,
        acceptedAt: null,
        acceptedByUserId: null,
      },
      {
        id: INVITATION_B,
        organizationId: ORG_B,
        email: 'outsider@example.test',
        role: OrgRole.MEMBER,
        status: InvitationStatus.PENDING,
        tokenHash: generatedB.hash,
        invitedByUserId: OWNER_B,
        expiresAt: new Date(Date.now() + A_WEEK),
        createdAt: EPOCH,
        acceptedAt: null,
        acceptedByUserId: null,
      },
    ]);

    source.seed(ResourceGrantRecord, [
      {
        id: GRANT_A,
        organizationId: ORG_A,
        subjectUserId: MEMBER_A,
        resourceType: RESOURCE_TYPE,
        resourceId: 'record-a',
        permission: 'organization:update',
        grantedBy: OWNER_A,
        createdAt: EPOCH,
        expiresAt: null,
      },
      {
        id: GRANT_B,
        organizationId: ORG_B,
        subjectUserId: MEMBER_B,
        resourceType: RESOURCE_TYPE,
        resourceId: 'record-b',
        permission: 'organization:update',
        grantedBy: OWNER_B,
        createdAt: EPOCH,
        expiresAt: null,
      },
    ]);

    source.seed(AuditEntryRecord, [
      {
        id: 'entry-a',
        organizationId: ORG_A,
        actorUserId: OWNER_A,
        action: AuditAction.MEMBER_INVITED,
        resourceType: null,
        resourceId: null,
        metadata: {},
        clientAddress: null,
        clientLabel: null,
        occurredAt: EPOCH,
      },
      {
        id: 'entry-b',
        organizationId: ORG_B,
        actorUserId: OWNER_B,
        action: AuditAction.MEMBER_INVITED,
        resourceType: null,
        resourceId: null,
        metadata: {},
        clientAddress: null,
        clientLabel: null,
        occurredAt: EPOCH,
      },
    ]);

    const audit = new AuditService(
      repo<AuditEntryRecord>(AuditEntryRecord),
      repo<UserRecord>(UserRecord),
      repo<MembershipRecord>(MembershipRecord),
    );
    const organizations = new OrganizationsService(
      repo<OrganizationRecord>(OrganizationRecord),
      repo<MembershipRecord>(MembershipRecord),
      repo<InvitationRecord>(InvitationRecord),
      repo<UserRecord>(UserRecord),
      source as unknown as DataSource,
      audit,
      NOOP_MAILER,
      new ConfigService({ PUBLIC_WEBAPP_URL: WEBAPP_URL }),
    );
    const authorization = new AuthorizationService(
      repo<ResourceGrantRecord>(ResourceGrantRecord),
      repo<MembershipRecord>(MembershipRecord),
      audit,
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: SIGNING_KEY })] }),
        I18N,
        PassportModule,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      // Every organization-scoped controller at once, because D9 is a property
      // of the SURFACE and not of any one of them. A refusal that drifted on one
      // route while the other four stayed byte-identical is exactly the kind of
      // leak a per-controller spec cannot see.
      controllers: [
        OrganizationsController,
        MembersController,
        InvitationsController,
        GrantsController,
        OrganizationAuditController,
      ],
      providers: [
        // THE SHIPPED ARRAY, so the statuses and bodies below are the ones the
        // application really produces.
        ...GLOBAL_PROVIDERS,
        JwtStrategy,
        { provide: OrganizationsService, useValue: organizations },
        { provide: AuthorizationService, useValue: authorization },
        { provide: AuditService, useValue: audit },
        PermissionsGuard,
        PrincipalService,
        { provide: getRepositoryToken(UserRecord), useValue: repo<UserRecord>(UserRecord) },
        {
          provide: getRepositoryToken(MembershipRecord),
          useValue: repo<MembershipRecord>(MembershipRecord),
        },
        {
          provide: getRepositoryToken(OrganizationRecord),
          useValue: repo<OrganizationRecord>(OrganizationRecord),
        },
        {
          provide: getRepositoryToken(ResourceGrantRecord),
          useValue: repo<ResourceGrantRecord>(ResourceGrantRecord),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    jwt = moduleRef.get(JwtService);
    principals = moduleRef.get(PrincipalService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const bearer = (userId: UserId): string => `Bearer ${jwt.sign({ sub: userId, sid: SESSION })}`;

  // `request.Test` rather than `Promise<Response>`: it is thenable, so `await`
  // still yields a `Response`, and the callers that want supertest's own
  // `.expect(200)` keep it.
  const get = (path: string, actor: UserId): request.Test =>
    request(app.getHttpServer()).get(path).set('Authorization', bearer(actor));

  /** Every organization-scoped read, as a name and a path built from an id. */
  const READS: [string, (organizationId: string) => string][] = [
    ['GET /organizations/:id', (id) => `/organizations/${id}`],
    ['GET /organizations/:id/members', (id) => `/organizations/${id}/members`],
    ['GET /organizations/:id/invitations', (id) => `/organizations/${id}/invitations`],
    ['GET /organizations/:id/grants', (id) => `/organizations/${id}/grants`],
    ['GET /organizations/:id/audit', (id) => `/organizations/${id}/audit`],
  ];

  describe('a cross-tenant request is answered exactly as a missing one', () => {
    // The control. Without it an implementation that answers 404 to everything
    // satisfies every row of the table below, and this whole file would be a
    // green proof that the server does nothing.
    it.each(READS)('%s answers a member of that organization', async (_name, path) => {
      const response = await get(path(ORG_A), OWNER_A);
      expect(response.status).toBe(200);
    });

    it.each(READS)('%s hides another tenant behind the missing-tenant answer', async (_name, path) => {
      const foreign = await get(path(ORG_B), OWNER_A);
      const missing = await get(path(ORG_ABSENT), OWNER_A);

      expect(foreign.status).toBe(missing.status);
      // Byte for byte, not `toStrictEqual` on the parsed object: what a caller
      // actually receives is the text, and two bodies that differ only in key
      // order or in a field one of them omits are two bodies.
      expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(missing.body));
      // And it is a refusal rather than an accidental match between two
      // successful empty pages.
      expect(foreign.status).toBe(404);
    });

    it.each(READS)('%s leaks nothing about the other tenant in the refusal', async (_name, path) => {
      const foreign = await get(path(ORG_B), OWNER_A);
      const text = JSON.stringify(foreign.body);

      expect(text).not.toContain('Beta Industries');
      expect(text).not.toContain('beta-industries');
      expect(text).not.toContain(MEMBER_B);
      expect(text).not.toContain(ORG_B);
    });
  });

  describe('and never serves another tenant\'s records to a legitimate read', () => {
    // The other half of the boundary, and the one that catches a query with no
    // organization in its predicate: A's owner asks for A's own page and must be
    // shown A's rows, not everybody's.
    it('never returns another tenant\'s members', async () => {
      const response = await get(`/organizations/${ORG_A}/members`, OWNER_A).expect(200);
      const ids = response.body.data.map((membership: { userId: string }) => membership.userId);

      expect(ids).toContain(OWNER_A);
      expect(ids).not.toContain(OWNER_B);
      expect(ids).not.toContain(MEMBER_B);
      expect(response.body.meta.total).toBe(ids.length);
    });

    it('never returns another tenant\'s invitations', async () => {
      const response = await get(`/organizations/${ORG_A}/invitations`, OWNER_A).expect(200);
      const ids = response.body.data.map((invitation: { id: string }) => invitation.id);

      expect(ids).toContain(INVITATION_A);
      expect(ids).not.toContain(INVITATION_B);
    });

    it('never returns another tenant\'s grants', async () => {
      const response = await get(`/organizations/${ORG_A}/grants`, OWNER_A).expect(200);
      const ids = response.body.data.map((grant: { id: string }) => grant.id);

      expect(ids).toContain(GRANT_A);
      expect(ids).not.toContain(GRANT_B);
    });

    it('never returns another tenant\'s audit entries', async () => {
      const response = await get(`/organizations/${ORG_A}/audit`, OWNER_A).expect(200);
      const organizations = response.body.data.map(
        (entry: { organizationId: string | null }) => entry.organizationId,
      );

      expect(organizations).toContain(ORG_A);
      expect(organizations.every((id: string | null) => id === ORG_A)).toBe(true);
    });
  });

  /**
   * The comparison above is the *guard's* two branches, because on those five
   * routes `PermissionsGuard` refuses before any service runs. These three are
   * the other half, and the body-sensitive one: the guard **passes** — OWNER_A
   * really owns ORG_A and really holds the permission — and the refusal is then
   * the service's, about a target row it was asked to find. So `code` in the
   * body comes from whichever domain error the service chose, and an
   * implementation that chose a different one for "belongs to another tenant"
   * than for "was never issued" is caught here and by nothing else on the wire.
   */
  const TARGETS: [string, (targetId: string) => string, string, string][] = [
    [
      'DELETE /organizations/:id/invitations/:invitationId',
      (targetId) => `/organizations/${ORG_A}/invitations/${targetId}`,
      INVITATION_B,
      INVITATION_ABSENT,
    ],
    [
      'DELETE /organizations/:id/grants/:grantId',
      (targetId) => `/organizations/${ORG_A}/grants/${targetId}`,
      GRANT_B,
      GRANT_ABSENT,
    ],
    [
      'DELETE /organizations/:id/members/:userId',
      (targetId) => `/organizations/${ORG_A}/members/${targetId}`,
      MEMBER_B,
      USER_ABSENT,
    ],
  ];

  describe('a target row in another tenant is as absent as one never issued', () => {
    it.each(TARGETS)(
      '%s answers the same, body and all',
      async (_name, path, foreignId, absentId) => {
        const del = (targetId: string): Promise<Response> =>
          request(app.getHttpServer())
            .delete(path(targetId))
            .set('Authorization', bearer(OWNER_A));

        const foreign = await del(foreignId);
        const missing = await del(absentId);

        expect(foreign.status).toBe(missing.status);
        expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(missing.body));
        expect(foreign.status).toBe(404);
      },
    );
  });

  describe('a write into another tenant', () => {
    // `PermissionsGuard` passes for ORG_A — OWNER_A really is its owner and
    // really holds `invitation:revoke`. Only the invitation lookup carrying
    // ORG_A into its predicate refuses this, which is the fault that can
    // actually leak.
    it('cannot revoke another tenant\'s invitation by naming it under its own', async () => {
      await request(app.getHttpServer())
        .delete(`/organizations/${ORG_A}/invitations/${INVITATION_B}`)
        .set('Authorization', bearer(OWNER_A))
        .expect(404);

      expect(source.byId(InvitationRecord, INVITATION_B)?.status).toBe(InvitationStatus.PENDING);
    });

    it('cannot revoke another tenant\'s grant by naming it under its own', async () => {
      await request(app.getHttpServer())
        .delete(`/organizations/${ORG_A}/grants/${GRANT_B}`)
        .set('Authorization', bearer(OWNER_A))
        .expect(404);

      expect(source.byId(ResourceGrantRecord, GRANT_B)).toBeDefined();
    });

    it('cannot remove another tenant\'s member by naming them under its own', async () => {
      await request(app.getHttpServer())
        .delete(`/organizations/${ORG_A}/members/${MEMBER_B}`)
        .set('Authorization', bearer(OWNER_A))
        .expect(404);

      expect(
        source.all(MembershipRecord).filter(
          (row) => row.organizationId === ORG_B && row.userId === MEMBER_B,
        ),
      ).toHaveLength(1);
    });
  });

  /**
   * `POST /invitations/:token/accept` is the one organization-scoped operation
   * whose path names **no organization at all** — the token is the whole of the
   * request. So "accept an invitation into an organization by editing the route"
   * is not a fault this surface can have: there is nothing in the route to edit.
   *
   * That is worth asserting rather than assuming, because the property it rests
   * on is a real one and a later refactor could take it away: the organization
   * the membership lands in comes from the **invitation row**, and a route that
   * grew an `:id` segment — or a body field — would immediately have the fault
   * this comment says is unreachable.
   */
  describe('redeeming an invitation', () => {
    it('places the redeemer in the inviting organization and nowhere else', async () => {
      const response = await request(app.getHttpServer())
        .post(`/invitations/${tokenB}/accept`)
        .set('Authorization', bearer(OUTSIDER))
        .expect(201);

      expect(response.body.organizationId).toBe(ORG_B);
      expect(
        source.all(MembershipRecord).filter((row) => row.userId === OUTSIDER),
      ).toHaveLength(1);
      expect(
        source.all(MembershipRecord).filter(
          (row) => row.userId === OUTSIDER && row.organizationId === ORG_A,
        ),
      ).toHaveLength(0);
    });

    it('takes the organization from the invitation, so the route carries none to edit', () => {
      const paths = Reflect.getMetadata('path', InvitationsController.prototype.accept) as string;
      expect(paths).toBe('invitations/:token/accept');
      expect(paths).not.toContain(':id');
    });
  });

  /**
   * R2's cost-if-wrong, asserted where the rule actually runs.
   *
   * `can()` deliberately never reads `expiresAt` — reading it would need a clock,
   * and a clock would stop the same principal and resource producing the same
   * answer. So `PrincipalService.hydrate` is the **only** place a grant's expiry
   * is judged in the whole system, and an expired grant that survives its filter
   * is honoured by `can()` without complaint. There is no second check anywhere.
   */
  describe('R2: the hydrator is the only place grant expiry runs', () => {
    /** Issues one grant for MEMBER_A in ORG_A, lapsing (or not) when told. */
    const seedGrant = (id: string, expiresAt: Date | null): void => {
      source.seed(ResourceGrantRecord, [
        {
          id,
          organizationId: ORG_A,
          subjectUserId: MEMBER_A,
          resourceType: RESOURCE_TYPE,
          resourceId: 'record-expiry',
          permission: 'organization:update',
          grantedBy: OWNER_A,
          createdAt: EPOCH,
          expiresAt,
        },
      ]);
    };

    it('does not hydrate a grant that has expired', async () => {
      const now = new Date();
      seedGrant('grant-expired', new Date(now.getTime() - 1000));

      const principal = await principals.hydrate(MEMBER_A, now);

      expect(principal.grants.map((grant) => grant.id)).not.toContain('grant-expired' as GrantId);
    });

    // The control, and it is not decoration: a hydrator that returned NO grants
    // satisfies the assertion above, and layer three would then be silently
    // switched off for everybody rather than leaking.
    it('does hydrate one that has not', async () => {
      const now = new Date();
      seedGrant('grant-live', new Date(now.getTime() + A_WEEK));

      const principal = await principals.hydrate(MEMBER_A, now);

      expect(principal.grants.map((grant) => grant.id)).toContain('grant-live' as GrantId);
    });
  });

  /**
   * **D12 is NOT satisfied by this suite, and what follows is a labelled
   * partial.** It is written down rather than left out so that nobody reads the
   * absence as an oversight and nobody reads the assertion below as more than it
   * is.
   *
   * D12 is "a grant revoked mid-session is denied on the next request". Denied
   * *by what* is the part this backend cannot yet exercise: no `can()` call site
   * passes `resourceType`/`resourceId`, deliberately — `PermissionsGuard` states
   * the reason, which is that naming the organization as the record would make an
   * ADMIN's `grant:create` a route to `organization:delete`. So layer three is
   * reached by nothing. Grants are stored, administered, hydrated and
   * expiry-filtered, and **consumed by no decision**.
   *
   * What the assertion below does establish is the hydration half: a grant
   * withdrawn through `AuthorizationService` is gone from the very next
   * principal, with no cache in between keeping it alive for the rest of the
   * credential's life. That is a real property and it is the half that would be
   * wrong if `PrincipalService` ever grew a cache. It is not D12: it does not
   * exercise `can()`'s third layer, because there is nothing to exercise it
   * with, and a test written to look like a passing D12 would be a green claim
   * about a code path that does not run.
   */
  describe('D12 (PARTIAL — the hydration half only; layer three is consumed by nothing)', () => {
    it('drops a revoked grant from the very next hydrate', async () => {
      const now = new Date();

      const before = await principals.hydrate(MEMBER_B, now);
      expect(before.grants.map((grant) => grant.id)).toContain(GRANT_B as GrantId);

      await request(app.getHttpServer())
        .delete(`/organizations/${ORG_B}/grants/${GRANT_B}`)
        .set('Authorization', bearer(OWNER_B))
        .expect(204);

      const after = await principals.hydrate(MEMBER_B, now);
      expect(after.grants.map((grant) => grant.id)).not.toContain(GRANT_B as GrantId);
    });
  });

  /**
   * The null-inviter path, recorded rather than manufactured.
   *
   * `Invitation.invitedByUserId` and `ResourceGrant.grantedBy` are
   * `UserId | null` because their columns are `ON DELETE SET NULL` — an
   * invitation and a grant outlive the account that issued them. **Neither core
   * contract can seed that state**: it arises only after an account is hard
   * deleted, and no contract operation deletes one.
   *
   * It is not reachable from here either, and the reason is `FakeDataSource`
   * item 7: this store has no foreign keys and therefore no `ON DELETE` actions.
   * Deleting a `UserRecord` row here leaves `invitedByUserId` pointing at an id
   * nothing answers to, which is a *different* state from the column having been
   * nulled — asserting on it would be asserting on the fake's behaviour, not on
   * the schema's.
   *
   * So it is left. The docker end-to-end suite stands up a real Postgres and is where the
   * cascade becomes reachable, and the mapper that has to survive it
   * (`to-invitation.ts`) already reads the column as `UserId | null`.
   *
   * The clause itself is pinned in `migration-sql.spec.ts` → `the
   * organizations-and-authorization migration` → `nulls <table>.<column> when
   * the account it names is deleted, rather than deleting the row`, one row per
   * column for `invited_by_user_id`, `accepted_by_user_id` and `granted_by`.
   * **Those assertions were written because this comment first claimed they
   * existed and they did not** — the file's only `ON DELETE SET NULL` assertion
   * was an earlier phase's, for `refresh_tokens`. An incorrect pointer to
   * coverage is worse than an acknowledged gap, because it stops the next
   * person looking.
   */
  describe('the null-inviter path', () => {
    it('is asserted at the migration and not faked here', () => {
      const row = source.byId(InvitationRecord, INVITATION_B);
      // The state this suite CAN see: a freshly issued invitation names a real
      // inviter. The nulled one is the migration's business.
      expect(row?.invitedByUserId).toBe(OWNER_B);
    });
  });
});
