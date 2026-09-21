import request from 'supertest';
import type { Response } from 'supertest';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { MembershipRecord } from '../../organizations/membership-record.entity';
import {
  buildWorld, ADMIN_A, ORG_A, OWNER_A, SECOND_OWNER_A, type DiscriminatingWorld,
} from './world';

/**
 * D15 — "the last OWNER tries to leave or demote themselves → rejected".
 *
 * ## The wrong implementation this file exists to distinguish
 *
 * `if (targetUserId === actorId) throw new LastOwnerError()`.
 *
 * It satisfies D15 *as the row is worded* — "the last OWNER tries to leave or
 * demote **themselves**" — and it is wrong, because the invariant is not about
 * who is asking. Spec §9.4 says an organization always has at least one OWNER.
 * That is a fact about a **count of remaining owners**, and the two differ in
 * both directions:
 *
 * - An ADMIN removing the sole OWNER is not the owner acting on themselves. The
 *   equality form lets it through, and the organization is left ownerless with
 *   no path back short of intervention outside the domain.
 * - An OWNER leaving an organization that has *another* OWNER is the owner
 *   acting on themselves, and is perfectly legal. The equality form refuses it,
 *   which is the half nobody reports: the person it affects assumes they are not
 *   allowed to.
 *
 * So this file's table is deliberately two-dimensional — {self, another
 * administrator} × {demote, remove} × {sole owner, two owners} — and the
 * equality form reds exactly four of its rows, watched going red before this
 * file's assertions were written.
 *
 * ## What this adds over the suites next door
 *
 * `organizations.service.spec.ts` and core's `IOrganizationService` contract
 * both assert "whoever is asking" at the domain level, and
 * `members.controller.spec.ts` asserts the 409 reaches the wire. What none of
 * them has is the **permitted** column: with a second OWNER present, both verbs
 * must *succeed*, and the membership must really be gone or really be changed.
 * Without it every assertion here passes for an implementation that refuses
 * every demotion and every removal there is — which is a rule nobody would ship
 * on purpose and which no refusal-only suite can see.
 */
describe('D15 — the last OWNER can neither leave nor be demoted, whoever is asking', () => {
  let world: DiscriminatingWorld;

  beforeEach(async () => {
    world = await buildWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  /** A second OWNER of A, so the invariant is no longer at stake. */
  const seedSecondOwner = (): void => {
    world.source.seed(MembershipRecord, [{
      id: `membership-${ORG_A}-${SECOND_OWNER_A}`,
      organizationId: ORG_A,
      userId: SECOND_OWNER_A,
      role: OrgRole.OWNER,
      createdAt: new Date('2026-09-20T10:00:00.000Z'),
      updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    }]);
  };

  const owners = (): string[] => world.source.all(MembershipRecord)
    .filter((row) => row.organizationId === ORG_A && row.role === OrgRole.OWNER)
    .map((row) => String(row.userId));

  const demote = (actor: UserId, target: UserId): Promise<Response> =>
    request(world.app.getHttpServer())
      .patch(`/organizations/${ORG_A}/members/${target}`)
      .set('Authorization', world.bearer(actor))
      .send({ role: OrgRole.ADMIN });

  const remove = (actor: UserId, target: UserId): Promise<Response> =>
    request(world.app.getHttpServer())
      .delete(`/organizations/${ORG_A}/members/${target}`)
      .set('Authorization', world.bearer(actor));

  /**
   * The guard on the fixtures. `buildWorld` seeds OWNER_A as A's only OWNER, and
   * every refusal below means nothing if that stops being true — a world with
   * two owners passes the whole refusal column for an implementation with no
   * last-owner rule at all.
   */
  it('seeds exactly one OWNER, which is what every refusal below depends on', () => {
    expect(owners()).toEqual([OWNER_A]);
  });

  describe('when the OWNER is the last one', () => {
    it('refuses the owner demoting themselves, with 409 LAST_OWNER', async () => {
      const response = await demote(OWNER_A, OWNER_A);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('LAST_OWNER');
      expect(owners()).toEqual([OWNER_A]);
    });

    it('refuses the owner removing themselves, with 409 LAST_OWNER', async () => {
      const response = await remove(OWNER_A, OWNER_A);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('LAST_OWNER');
      expect(owners()).toEqual([OWNER_A]);
    });

    // THE DISCRIMINATING PAIR. An ADMIN acting on the OWNER is not the owner
    // acting on themselves, so `targetUserId === actorId` does not fire and the
    // organization is left with no OWNER. Neither of these can be satisfied by
    // any rule that reads the actor.
    it('refuses an ADMIN demoting the sole OWNER, with 409 LAST_OWNER', async () => {
      const response = await demote(ADMIN_A, OWNER_A);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('LAST_OWNER');
      expect(owners()).toEqual([OWNER_A]);
    });

    it('refuses an ADMIN removing the sole OWNER, with 409 LAST_OWNER', async () => {
      const response = await remove(ADMIN_A, OWNER_A);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('LAST_OWNER');
      expect(owners()).toEqual([OWNER_A]);
    });
  });

  /**
   * The permitted column. The rule is "at least one OWNER remains", not "an
   * OWNER may never go", and a suite made only of refusals cannot tell the two
   * apart.
   */
  describe('when another OWNER remains', () => {
    beforeEach(() => {
      seedSecondOwner();
      expect(owners().sort()).toEqual([OWNER_A, SECOND_OWNER_A].sort());
    });

    it('lets an owner demote themselves', async () => {
      const response = await demote(OWNER_A, OWNER_A);

      expect(response.status).toBe(200);
      expect(owners()).toEqual([SECOND_OWNER_A]);
    });

    it('lets an owner remove themselves', async () => {
      const response = await remove(OWNER_A, OWNER_A);

      expect(response.status).toBe(204);
      expect(owners()).toEqual([SECOND_OWNER_A]);
    });

    it('lets an ADMIN demote one of two owners', async () => {
      const response = await demote(ADMIN_A, OWNER_A);

      expect(response.status).toBe(200);
      expect(owners()).toEqual([SECOND_OWNER_A]);
    });

    it('lets an ADMIN remove one of two owners', async () => {
      const response = await remove(ADMIN_A, OWNER_A);

      expect(response.status).toBe(204);
      expect(owners()).toEqual([SECOND_OWNER_A]);
    });
  });
});
