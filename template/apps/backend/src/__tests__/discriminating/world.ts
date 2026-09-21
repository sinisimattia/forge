import { INestApplication } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { Permission, ResourceType } from '__FORGE_SCOPE__/core/authorization/types';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { InvitationStatus, OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { GLOBAL_PROVIDERS, I18N } from '../../app.module';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { AuditService } from '../../audit/audit.service';
import { OrganizationAuditController } from '../../audit/organization-audit.controller';
import { JwtStrategy } from '../../auth/strategies';
import { PermissionsGuard, PrincipalService } from '../../authorization';
import { AuthorizationService } from '../../authorization/authorization.service';
import { GrantsController } from '../../authorization/grants.controller';
import { REQUIRED_PERMISSION } from '../../authorization/require-permission.decorator';
import { ResourceGrantRecord } from '../../authorization/resource-grant-record.entity';
import { generateOpaqueToken } from '../../common/crypto';
import { FakeDataSource } from '../../common/testing';
import type { IMailer } from '../../mail';
import { InvitationRecord } from '../../organizations/invitation-record.entity';
import { InvitationsController } from '../../organizations/invitations.controller';
import { MembersController } from '../../organizations/members.controller';
import { MembershipRecord } from '../../organizations/membership-record.entity';
import { OrganizationRecord } from '../../organizations/organization-record.entity';
import { OrganizationsController } from '../../organizations/organizations.controller';
import { OrganizationsService } from '../../organizations/organizations.service';
import { UserRecord } from '../../users/user-record.entity';

/**
 * The world the three discriminating specs in this directory share.
 *
 * ## Why these three specs exist at all, given the suites next door
 *
 * Spec §11's table names fifteen *discriminating* tests: assertions that fail
 * for a specific wrong implementation, and whose failure has been watched. D9,
 * D12 and D15 are Phase 3's three, and the ordinary suites already assert most
 * of what they are about — `tenant-isolation.spec.ts` for D9,
 * `members.controller.spec.ts` and core's own `IOrganizationService` contract
 * for D15. **These files deliberately do not restate any of that.** Each one
 * adds the assertion those suites cannot make, and each one's preamble says
 * plainly which fault it was watched going red under, and which it cannot see.
 *
 * ## The store
 *
 * `FakeDataSource`, the same one the suites next door use, with its own
 * inventory of what it does not enforce: no unique constraints (item 4) and no
 * foreign keys (item 7). Nothing in this directory is evidence about a database
 * constraint or a cascade.
 *
 * ## The disjointness promise
 *
 * Nobody seeded here belongs to both organizations. Every cross-tenant refusal
 * in `d9-tenant-isolation.spec.ts` becomes vacuous the moment somebody does, so
 * {@link buildWorld} asserts it rather than merely arranging it.
 */

/** Sole OWNER of A until a spec seeds otherwise. */
export const OWNER_A = '11111111-1111-4111-8111-111111111111' as UserId;
/** ADMIN of A. Holds `member:update` and `member:remove` and is not the owner — D15's actor. */
export const ADMIN_A = '22222222-2222-4222-8222-222222222222' as UserId;
export const MEMBER_A = '33333333-3333-4333-8333-333333333333' as UserId;
export const OWNER_B = '44444444-4444-4444-8444-444444444444' as UserId;
export const MEMBER_B = '55555555-5555-4555-8555-555555555555' as UserId;
/** Seeded by no spec by default; a second OWNER of A is D15's control. */
export const SECOND_OWNER_A = '66666666-6666-4666-8666-666666666666' as UserId;

const SESSION = '77777777-7777-4777-8777-777777777777' as SessionId;

export const ORG_A = '88888888-8888-4888-8888-888888888888';
export const ORG_B = '99999999-9999-4999-8999-999999999999';
/** Well-formed for `ParseUuidParamPipe`, and no organization answers to it. */
export const ORG_ABSENT = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0';

export const INVITATION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const INVITATION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const GRANT_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const GRANT_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** Well-formed, and answering to nothing in either tenant. */
export const INVITATION_ABSENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const GRANT_ABSENT = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
export const USER_ABSENT = '10101010-1010-4010-8010-101010101010';

const SIGNING_KEY = 'discriminating-spec-signing-key';
const WEBAPP_URL = 'https://app.example.test';
const EPOCH = new Date('2026-09-20T10:00:00.000Z');
const A_WEEK = 7 * 24 * 60 * 60 * 1000;

/** No spec here exercises invitation mail; a stub that records nothing suffices. */
const NOOP_MAILER: IMailer = { send: async () => undefined };

/** The kind of record the seeded grants are about. Any noun serves; see `ResourceType`. */
export const RESOURCE_TYPE = 'document' as ResourceType;

/** Every controller that mounts an organization-scoped route. */
export const GUARDED_CONTROLLERS = [
  OrganizationsController,
  MembersController,
  InvitationsController,
  GrantsController,
  OrganizationAuditController,
] as const;

/** One route that carries `@RequirePermission`, as the router will serve it. */
export interface GuardedRoute {
  /** Upper-case HTTP verb. */
  readonly method: string;
  /** Full path, controller prefix included, with express-style parameters. */
  readonly path: string;
  /** What `@RequirePermission` declares for it. */
  readonly permission: Permission;
}

/** Nest's `RequestMethod` enum, by its numeric value, for the members these controllers use. */
const REQUEST_METHODS: Record<number, string> = {
  0: 'GET', 1: 'POST', 2: 'PUT', 3: 'DELETE', 4: 'PATCH', 5: 'ALL', 6: 'OPTIONS', 7: 'HEAD',
};

/**
 * Every `@RequirePermission` route this backend mounts, read off the decorators.
 *
 * Read from metadata rather than listed by hand, which is the whole point: a
 * route added later appears here without anybody remembering to add it, and the
 * inventory assertion in `d9-tenant-isolation.spec.ts` then fails until somebody
 * says what its cross-tenant answer is. A hand-written list would have gone on
 * passing, which is how a new guarded route arrives with no tenant-isolation
 * case and nothing notices.
 */
export function guardedRoutes(): GuardedRoute[] {
  const found: GuardedRoute[] = [];

  for (const controller of GUARDED_CONTROLLERS) {
    const prefix = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const prototype = controller.prototype as unknown as Record<string, unknown>;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor') continue;
      const handler = prototype[name];
      if (typeof handler !== 'function') continue;

      const permission = Reflect
        .getMetadata(REQUIRED_PERMISSION, handler) as Permission | undefined;
      if (permission === undefined) continue;

      const suffix = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      const verb = REQUEST_METHODS[Number(Reflect.getMetadata(METHOD_METADATA, handler) ?? -1)];
      const joined = [prefix, suffix].filter((part) => part !== '' && part !== '/').join('/');

      found.push({ method: verb ?? 'UNKNOWN', path: `/${joined}`, permission });
    }
  }

  return found.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

/** Everything a spec in this directory needs to drive the real surface. */
export interface DiscriminatingWorld {
  readonly app: INestApplication;
  readonly source: FakeDataSource;
  readonly principals: PrincipalService;
  /** The `Authorization` header value for a credential naming `userId`. */
  bearer(userId: UserId): string;
  close(): Promise<void>;
}

/**
 * Two tenants, the whole guarded surface, and the shipped global providers.
 *
 * `GLOBAL_PROVIDERS` rather than a hand-assembled pipe/filter set, so the
 * statuses and bodies asserted below are the ones the application really
 * produces — a filter that mapped a domain error differently in production
 * than here would make every body comparison a comparison of the test's own
 * arrangement.
 */
export async function buildWorld(): Promise<DiscriminatingWorld> {
  const source = new FakeDataSource();

  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

  const seedAccount = (id: string, email: string): void => {
    source.seed(UserRecord, [{
      id,
      email,
      displayName: 'Somebody',
      status: UserStatus.ACTIVE,
      platformRole: PlatformRole.PLATFORM_USER,
      emailVerifiedAt: EPOCH,
      createdAt: EPOCH,
      updatedAt: EPOCH,
      deletedAt: null,
    }]);
  };

  const seedMembership = (organizationId: string, userId: string, role: OrgRole): void => {
    source.seed(MembershipRecord, [{
      id: `membership-${organizationId}-${userId}`,
      organizationId,
      userId,
      role,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    }]);
  };

  seedAccount(OWNER_A, 'owner-a@example.test');
  seedAccount(ADMIN_A, 'admin-a@example.test');
  seedAccount(MEMBER_A, 'member-a@example.test');
  seedAccount(OWNER_B, 'owner-b@example.test');
  seedAccount(MEMBER_B, 'member-b@example.test');
  seedAccount(SECOND_OWNER_A, 'second-owner-a@example.test');

  source.seed(OrganizationRecord, [
    { id: ORG_A, name: 'Acme Works', slug: 'acme-works', createdAt: EPOCH, updatedAt: EPOCH, deletedAt: null },
    { id: ORG_B, name: 'Beta Industries', slug: 'beta-industries', createdAt: EPOCH, updatedAt: EPOCH, deletedAt: null },
  ]);

  seedMembership(ORG_A, OWNER_A, OrgRole.OWNER);
  seedMembership(ORG_A, ADMIN_A, OrgRole.ADMIN);
  seedMembership(ORG_A, MEMBER_A, OrgRole.MEMBER);
  seedMembership(ORG_B, OWNER_B, OrgRole.OWNER);
  seedMembership(ORG_B, MEMBER_B, OrgRole.MEMBER);

  const generatedA = generateOpaqueToken();
  const generatedB = generateOpaqueToken();
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
      email: 'invited-into-b@example.test',
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

  // The world's central promise, asserted rather than arranged: seed anybody
  // into both organizations and every cross-tenant refusal in this directory
  // stops being a refusal, silently and greenly.
  const overlap = source.all(MembershipRecord)
    .filter((row) => row.organizationId === ORG_A)
    .map((row) => row.userId)
    .filter((userId) => source.all(MembershipRecord).some(
      (row) => row.organizationId === ORG_B && row.userId === userId,
    ));
  if (overlap.length > 0) {
    throw new Error(`the two tenants must be disjoint; these accounts are in both: ${overlap.join(', ')}`);
  }

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
    controllers: [...GUARDED_CONTROLLERS],
    providers: [
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

  const app = moduleRef.createNestApplication();
  const jwt = moduleRef.get(JwtService);
  const principals = moduleRef.get(PrincipalService);
  await app.init();

  return {
    app,
    source,
    principals,
    bearer: (userId: UserId): string => `Bearer ${jwt.sign({ sub: userId, sid: SESSION })}`,
    close: (): Promise<void> => app.close(),
  };
}

/**
 * Everything tenant B holds, as text.
 *
 * The D9 assertion that catches the fault that can actually leak is not "the
 * response was 404" — a service that reached into B and then answered 404 by
 * accident would satisfy that. It is that **B did not move**, over every row B
 * has, taken before and after the request. A status is what the caller was
 * told; this is what happened.
 */
export function snapshotTenantB(source: FakeDataSource): string {
  const scoped = (entity: { name: string }): unknown[] => source.all(entity)
    .filter((row) => row.organizationId === ORG_B)
    .map((row) => JSON.parse(JSON.stringify(row)) as unknown);

  return JSON.stringify({
    organizations: source.all(OrganizationRecord).filter((row) => row.id === ORG_B),
    memberships: scoped(MembershipRecord),
    invitations: scoped(InvitationRecord),
    grants: scoped(ResourceGrantRecord),
    auditEntries: scoped(AuditEntryRecord),
  });
}
