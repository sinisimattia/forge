import { runIAuditServiceContract } from '__FORGE_SCOPE__/core/audit/testing';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { AuditEntryId } from '__FORGE_SCOPE__/core/audit/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { adaptJestToConformanceExpect, makeIdentityWorld } from '../../common/testing';
import { UserRecord } from '../../users/user-record.entity';
import { AuditEntryRecord } from '../audit-entry-record.entity';

/**
 * `AuditService` against core's shared `IAuditService` suite.
 *
 * A gate; it produces nothing. See `users.conformance.spec.ts` for what driving
 * a shared suite from a real implementation establishes (D3).
 *
 * ## THE ASSERTION THIS HARNESS CANNOT FAIL
 *
 * `FakeDataSource`'s inventory of what it cannot express calls audit
 * immutability "the most load-bearing item on this list", and it applies here
 * more directly than anywhere else in this backend: **this store will happily
 * `UPDATE` and `DELETE` an `audit_entries` row.** The guarantee is a privilege
 * revoked from the application role in `1758000002000-AuditAppendOnly`, and
 * nothing driven from a store that has no privileges at all can fail for want of
 * it.
 *
 * The suite knows this, and its own "shape guarantee" test says so at length:
 * what it asserts is that the implementation offers no member whose *name* could
 * change an entry — a smoke alarm, not a lock. That test is failable here and
 * does fail if somebody adds `purgeOlderThan` to `AuditService` one afternoon.
 * What is *not* failable here, by this suite or by any other test in this
 * backend, is that a `DELETE FROM audit_entries` issued by the application is
 * refused. The docker end-to-end suite stands up a real Postgres and proves it; D13 is that
 * property's home. Do not read a green run of this file as evidence for it.
 *
 * ## The world, and why it is written rather than driven
 *
 * Every other conformance driver in this backend builds its world by driving
 * `AuthService.register`. This one must not: registering writes
 * `USER_REGISTERED` and verifying writes `EMAIL_VERIFIED`, so a world built that
 * way arrives holding audit entries nobody asked for, and the suite's very first
 * assertion — that the whole history is exactly the three entries the host
 * promised — would fail on a world that is wrong rather than on an
 * implementation that is.
 *
 * So the reader is a seeded row. It is a platform administrator because
 * `AuditService.query` decides entitlement with core's `can` and `audit:read` is
 * an administrator's permission (ADR-0006); a reader without it is answered with
 * `ForbiddenException` and the suite's first count fails, which is exactly what
 * that assertion's comment says it is there to catch.
 *
 * ## Seeded shuffled, on the suite's explicit instruction
 *
 * `AuditServiceContractContext.seeded` documents the one promise the suite
 * cannot check: the store must not already hold the entries newest-first, or an
 * implementation that sorts nothing passes every ordering assertion. The three
 * rows below are therefore seeded middle, oldest, newest while `seeded` names
 * them newest, middle, oldest.
 */

/** The three seeded instants, strictly decreasing in the order the suite is promised. */
const NEWEST = new Date('2026-03-04T05:06:07.000Z');
const MIDDLE = new Date('2026-03-03T05:06:07.000Z');
const OLDEST = new Date('2026-03-02T05:06:07.000Z');

/** The reader: entitled across the deployment, and the actor of no seeded entry. */
const READER_ID = 'fake-UserRecord-reader' as UserId;

/** The actor the suite narrows by. Named by exactly one entry, and not the newest. */
const FILTER_ACTOR_ID = 'fake-UserRecord-filtered' as UserId;

/** The tenant the newest seeded entry belongs to, and no other. */
const TENANT_ID = 'fake-OrganizationRecord-tenant' as OrganizationId;

runIAuditServiceContract({
  describe,
  it,
  expect: adaptJestToConformanceExpect(),
  makeContext: async () => {
    const world = makeIdentityWorld();

    world.source.seed(UserRecord, [{
      id: READER_ID,
      email: 'root@example.test',
      displayName: 'Root',
      status: UserStatus.ACTIVE,
      platformRole: PlatformRole.PLATFORM_ADMIN,
      emailVerifiedAt: NEWEST,
      createdAt: OLDEST,
      updatedAt: OLDEST,
      deletedAt: null,
    }]);

    // Seeded in an order that is NOT the order the suite is promised. See the
    // note above: newest-first storage makes every ordering assertion below
    // unfailable, and the suite cannot see the store to check.
    const rows = [
      {
        id: 'fake-AuditEntryRecord-middle',
        occurredAt: MIDDLE,
        actorUserId: FILTER_ACTOR_ID,
        action: AuditAction.LOGIN_SUCCEEDED,
      },
      {
        id: 'fake-AuditEntryRecord-oldest',
        occurredAt: OLDEST,
        actorUserId: READER_ID,
        action: AuditAction.LOGIN_SUCCEEDED,
      },
      {
        id: 'fake-AuditEntryRecord-newest',
        occurredAt: NEWEST,
        actorUserId: READER_ID,
        // Carried by exactly one entry, and by a different entry from the one
        // `FILTER_ACTOR_ID` names — which is what makes narrowing by both
        // distinguishable from narrowing by either.
        action: AuditAction.PROFILE_UPDATED,
      },
    ];
    world.source.seed(AuditEntryRecord, rows.map((row) => ({
      ...row,
      // Every field the wire-shape test compares is non-null on the newest
      // row, and only the newest row — see that test's comment on why a
      // null-on-both-sides comparison is no comparison at all.
      organizationId: row.id === 'fake-AuditEntryRecord-newest' ? TENANT_ID : null,
      resourceType: 'user',
      resourceId: String(row.actorUserId),
      metadata: { seeded: true },
      clientAddress: row.id === 'fake-AuditEntryRecord-newest' ? '203.0.113.9' : null,
      clientLabel: row.id === 'fake-AuditEntryRecord-newest' ? 'a seeded client' : null,
    })));

    return {
      service: world.audit,
      readerId: READER_ID,
      seeded: ['fake-AuditEntryRecord-newest', 'fake-AuditEntryRecord-middle', 'fake-AuditEntryRecord-oldest']
        .map((id) => world.auditEntity(id as AuditEntryId)),
      filterAction: AuditAction.PROFILE_UPDATED,
      filterActorId: FILTER_ACTOR_ID,
      // Carried by no seeded entry, so a narrowed query finds exactly what the
      // suite itself wrote and nothing the world came with.
      freshAction: AuditAction.SESSION_REUSE_DETECTED,
      organizationId: TENANT_ID,
    };
  },
});
