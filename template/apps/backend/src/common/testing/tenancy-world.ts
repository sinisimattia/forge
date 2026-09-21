import { ConfigService } from '@nestjs/config';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import type { Invitation, Membership } from '__FORGE_SCOPE__/core/organizations/entities';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditService } from '../../audit/audit.service';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { AuthorizationService } from '../../authorization/authorization.service';
import { PrincipalService } from '../../authorization/principal.service';
import { ResourceGrantRecord } from '../../authorization/resource-grant-record.entity';
import type { IMailer, OutboundMessage } from '../../mail';
import { InvitationRecord } from '../../organizations/invitation-record.entity';
import { MembershipRecord } from '../../organizations/membership-record.entity';
import { OrganizationRecord } from '../../organizations/organization-record.entity';
import { OrganizationsService } from '../../organizations/organizations.service';
import { UserRecord } from '../../users/user-record.entity';
import { hashOpaqueToken } from '../crypto';
import { FakeDataSource } from './fake-data-source';

/**
 * Two tenants with disjoint memberships, and the whole tenancy backend over one
 * {@link FakeDataSource}, for the conformance drivers to point core's suites at.
 *
 * `identity-world.ts` is the same idea for accounts and sessions; read its
 * preamble first, because everything it says about what is real here and what is
 * not applies unchanged. This file states only what is particular to tenancy.
 *
 * ## Two organizations, because one makes every cross-tenant assertion vacuous
 *
 * The security suite this world exists for asks, over and over, whether a
 * request made inside one organization can reach another organization's rows.
 * A world with one organization has no other side for such a request to fail to
 * reach, so every one of those assertions passes for an implementation that
 * scopes nothing at all — it finds nothing because there is nothing.
 *
 * So there are two, {@link TenancyWorld.orgA} and {@link TenancyWorld.orgB},
 * **and nobody seeded below belongs to both.** That disjointness is the world's
 * central promise and the one the suite cannot check for itself.
 * {@link TenancyWorld.join} exists for the drivers that legitimately need
 * somebody in both (the authorization suite requires it, explicitly), and a
 * driver that calls it builds its own world — it does not reach into the one the
 * security suite is given.
 *
 * ## What is real here and what is not
 *
 * **Every service is the real one**, constructed as `AppModule` constructs it:
 * `OrganizationsService`, `AuthorizationService`, `PrincipalService` and
 * `AuditService`, over {@link FakeDataSource}, with an array for a mailer and the
 * real `ConfigService` holding this harness's own values.
 *
 * Every organization, membership and invitation in this world is produced by
 * driving the real code path — `createOrganization`, `inviteMember`,
 * `acceptInvitation`, `changeMemberRole` — so a world a suite is handed was
 * built the way the application builds one, and a defect in any of them shows up
 * as a world that cannot be built rather than as a suite quietly testing a shape
 * nothing produces.
 *
 * **Accounts are the exception, and are seeded as rows.** `identity-world.ts`
 * registers them through `AuthService`, which derives an argon2 hash per
 * account; nothing in a tenancy suite signs in, so that cost would buy a world
 * six argon2 derivations more expensive per test and no assertion whatsoever.
 * What an account has to be here is a row with an address, and that is what is
 * written.
 *
 * ## What this store cannot express, which bears directly on this world
 *
 * `FakeDataSource` carries a numbered inventory of the properties it cannot
 * model; **read that list rather than any summary of it**. Item 4 is the one a
 * reader of a tenancy suite most needs: there are no unique constraints, so
 * `uq_memberships_org_user`, `uq_organizations_slug` and
 * `uq_organization_invitations_token_hash` do not exist here. Nothing driven
 * from this world can fail for want of one, and no assertion made against it
 * should be read as covering one.
 */
export interface TenancyWorld {
  /** The store every service below was built over. Seed and read it directly. */
  source: FakeDataSource;

  organizations: OrganizationsService;
  authorization: AuthorizationService;
  principals: PrincipalService;
  audit: AuditService;

  /** Every message the mailer was handed, oldest first. */
  sent: OutboundMessage[];

  /** Tenant A. */
  orgA: Organization;
  /** A's sole OWNER, a member of nothing else. */
  ownerA: User;
  /** An ADMIN of A, a member of nothing else. */
  adminA: User;
  /** An ordinary MEMBER of A, a member of nothing else. */
  memberA: User;

  /** Tenant B. Its membership is disjoint from A's. */
  orgB: Organization;
  /** B's sole OWNER, a member of nothing else. */
  ownerB: User;
  /** An ordinary MEMBER of B, a member of nothing else. */
  memberB: User;

  /** Somebody who belongs to neither organization. */
  outsider: User;

  /**
   * An open invitation B has issued to {@link TenancyWorld.outsider}'s address.
   *
   * It is what the write-side cross-tenant assertions name: without a real row
   * belonging to the other tenant, "A's owner cannot revoke B's invitation" is a
   * statement about nothing.
   */
  invitationFromB: Invitation;
  /** The value {@link TenancyWorld.invitationFromB}'s recipient holds. */
  tokenFromB: string;

  /** The instant this world considers now, for every expiry assertion. */
  now: Date;

  /**
   * Seeds one account, as a row. See this interface's own preamble for why the
   * account alone is not built through `AuthService`.
   *
   * @param email - the address, as a person would have typed it
   * @param displayName - the name to show
   * @returns the account as a domain entity, with its address in normal form
   */
  seedAccount(email: string, displayName: string): User;

  /**
   * Puts somebody into an organization, by driving the real invitation path:
   * `inviteMember` by a member who may, then `acceptInvitation` by the
   * recipient, then `changeMemberRole` when the role wanted is not the one the
   * invitation carried.
   *
   * It exists for the authorization suite, which requires one person to be a
   * member of both organizations and would otherwise have no way to say so. Every
   * other member of this world is already placed.
   *
   * @param inviterId - a member of `organizationId` entitled to invite
   * @param organizationId - the organization to join
   * @param user - the account joining it
   * @param role - the role to end up with
   * @returns the new membership
   */
  join(
    inviterId: UserId,
    organizationId: OrganizationId,
    user: User,
    role: OrgRole,
  ): Promise<Membership>;

  /**
   * The value the recipient of one invitation holds.
   *
   * Found by hashing every token this world has mailed and matching it against
   * the invitation's stored hash — not by taking the most recent message, which
   * would answer the wrong invitation for any suite that issues two before
   * redeeming either. The store holds only the hash (`InvitationRecord`'s own
   * TSDoc says why), so the mail is the only place the value itself exists,
   * exactly as it is for a real recipient.
   *
   * @param invitation - the invitation whose token is wanted
   * @returns the opaque value that redeems it
   */
  tokenFor(invitation: Invitation): Promise<string>;

  /**
   * One stored organization, as a domain entity, read straight from the store.
   *
   * Built here rather than through `OrganizationsService`, for the reason
   * `IdentityWorld.userEntity` gives: these entities are the right-hand side of
   * the suites' comparisons, and one read back through the implementation under
   * test would let that implementation agree with itself.
   *
   * @param organizationId - the organization to read
   * @returns the same organization as an entity
   */
  organizationEntity(organizationId: OrganizationId): Organization;
}

/** Where this harness pretends the webapp lives. */
const WEBAPP_URL = 'https://app.example.test';

/**
 * When the accounts this world seeds came into being.
 *
 * A fixed literal, deliberately NOT this world's `now`: every organization,
 * membership and invitation below is written by a real service reading the real
 * clock, so the instant the suites judge expiry against has to be a real clock
 * reading too (see the `now` assigned at the end of {@link makeTenancyWorld}).
 * Accounts are the one thing here with no bearing on any expiry, so they are
 * dated once and kept out of that.
 */
const SEEDED_AT = new Date('2026-01-01T00:00:00.000Z');

/**
 * A fresh world: one empty store, the tenancy backend over it, and two
 * organizations whose memberships do not overlap.
 *
 * @returns the services, the store, the two tenants and the helpers a driver needs
 */
export async function makeTenancyWorld(): Promise<TenancyWorld> {
  const source = new FakeDataSource();
  const sent: OutboundMessage[] = [];

  const mailer: IMailer = {
    send: async (message) => {
      sent.push(message);
    },
  };

  // The store holds plain rows, so it is handed over as the repository type each
  // service asks for. The cast is confined to this helper rather than repeated
  // at each of the call sites below.
  const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
    source.getRepository(entity) as unknown as Repository<T>;

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
    mailer,
    new ConfigService({ PUBLIC_WEBAPP_URL: WEBAPP_URL }),
  );

  const authorization = new AuthorizationService(
    repo<ResourceGrantRecord>(ResourceGrantRecord),
    repo<MembershipRecord>(MembershipRecord),
    audit,
  );

  const principals = new PrincipalService(
    repo<UserRecord>(UserRecord),
    repo<MembershipRecord>(MembershipRecord),
    repo<ResourceGrantRecord>(ResourceGrantRecord),
  );

  let nextAccount = 1;

  const seedAccount = (email: string, displayName: string): User => {
    const id = `tenancy-user-${nextAccount++}` as UserId;
    const normalized = normalizeEmail(email);
    source.seed(UserRecord, [
      {
        id,
        email: normalized,
        displayName,
        status: UserStatus.ACTIVE,
        platformRole: PlatformRole.PLATFORM_USER,
        emailVerifiedAt: SEEDED_AT,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
        deletedAt: null,
      },
    ]);
    return new User({
      id,
      email: normalized,
      displayName,
      status: UserStatus.ACTIVE,
      platformRole: PlatformRole.PLATFORM_USER,
      emailVerifiedAt: SEEDED_AT,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
      deletedAt: null,
    });
  };

  const tokenFor = async (invitation: Invitation): Promise<string> => {
    const row = source.byId(InvitationRecord, invitation.id);
    if (row === undefined) throw new Error(`invitation ${invitation.id} is not in the store`);
    for (const message of sent) {
      const match = /token=([A-Za-z0-9_-]+)/.exec(message.body);
      if (match === null) continue;
      if (hashOpaqueToken(match[1]) === row.tokenHash) return match[1];
    }
    throw new Error(`no mailed token redeems invitation ${invitation.id}`);
  };

  const join = async (
    inviterId: UserId,
    organizationId: OrganizationId,
    user: User,
    role: OrgRole,
  ): Promise<Membership> => {
    // Invited as a MEMBER and promoted afterwards when something else is
    // wanted, rather than invited straight into the role: `inviteMember`
    // accepts any role, but an OWNER seeded by invitation would make a second
    // owner in a world whose suites assert there is exactly one, and promoting
    // through `changeMemberRole` is the path an application really takes.
    const invitation = await organizations.inviteMember(inviterId, organizationId, {
      email: user.email,
      role: OrgRole.MEMBER,
    });
    const membership = await organizations.acceptInvitation(
      user.id,
      await tokenFor(invitation),
    );
    if (role === OrgRole.MEMBER) return membership;
    return organizations.changeMemberRole(inviterId, organizationId, user.id, role);
  };

  const organizationEntity = (organizationId: OrganizationId): Organization => {
    const row = source.byId(OrganizationRecord, organizationId);
    // Loudly, for the reason `IdentityWorld`'s own `rowOf` gives: a world that
    // named a row the store does not hold would otherwise hand a suite an
    // entity built from `undefined`.
    if (row === undefined) throw new Error(`organization ${organizationId} is not in the store`);
    return new Organization({
      id: row.id as OrganizationId,
      name: row.name as string,
      slug: row.slug as string,
      createdAt: row.createdAt as Date,
      updatedAt: row.updatedAt as Date,
      deletedAt: row.deletedAt as Date | null,
    });
  };

  const ownerA = seedAccount('  Ada@Example.COM ', 'Ada');
  const adminA = seedAccount('grace@example.test', 'Grace');
  const memberA = seedAccount('alan@example.test', 'Alan');
  const ownerB = seedAccount('barbara@example.test', 'Barbara');
  const memberB = seedAccount('edsger@example.test', 'Edsger');
  const outsider = seedAccount('outsider@example.test', 'Outsider');

  const createdA = await organizations.createOrganization(ownerA.id, {
    name: 'Acme Works',
    slug: 'acme-works',
  });
  const createdB = await organizations.createOrganization(ownerB.id, {
    name: 'Beta Industries',
    slug: 'beta-industries',
  });

  await join(ownerA.id, createdA.id, adminA, OrgRole.ADMIN);
  await join(ownerA.id, createdA.id, memberA, OrgRole.MEMBER);
  await join(ownerB.id, createdB.id, memberB, OrgRole.MEMBER);

  // B's own open invitation, issued LAST so that nothing above can have
  // redeemed or closed it, and addressed to the one account that belongs
  // nowhere — so a suite can redeem it and watch where the membership lands.
  const invitationFromB = await organizations.inviteMember(ownerB.id, createdB.id, {
    email: outsider.email,
    role: OrgRole.MEMBER,
  });

  return {
    source,
    organizations,
    authorization,
    principals,
    audit,
    sent,

    // Read back from the store rather than passed through from what
    // `createOrganization` returned: the world's promise about an organization
    // must not be the implementation's own account of it.
    orgA: organizationEntity(createdA.id),
    ownerA,
    adminA,
    memberA,

    orgB: organizationEntity(createdB.id),
    ownerB,
    memberB,

    outsider,
    invitationFromB,
    tokenFromB: await tokenFor(invitationFromB),

    // Read AFTER everything above was written, so that every row this world
    // holds was created before the instant its suites call now — an invitation
    // issued a millisecond after it would be judged against a clock reading
    // that predates it.
    now: new Date(),

    seedAccount,
    join,
    tokenFor,
    organizationEntity,
  };
}
