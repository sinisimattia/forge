import type { PaginatedResult } from '../../shared/types/PaginatedResult';
import type { UserId } from '../../users/types/UserId';
import { Membership } from '../entities/Membership';
import { InvitationStatus } from '../enums/InvitationStatus';
import { OrgRole } from '../enums/OrgRole';
import { InvitationNotFoundError } from '../errors/InvitationNotFoundError';
import { MembershipNotFoundError } from '../errors/MembershipNotFoundError';
import { OrganizationNotFoundError } from '../errors/OrganizationNotFoundError';
import type { IOrganizationServiceSecurityContractDeps } from './IOrganizationServiceSecurityContractDeps';

/**
 * One page large enough to hold everything any world this suite runs against
 * contains, so that no assertion about *which* records came back is really an
 * assertion about where a page boundary fell.
 */
const EVERYTHING = { page: 1, limit: 100 };

/** Whether a page of memberships holds one for this person. */
function listsMember(page: PaginatedResult<Membership>, userId: UserId): boolean {
  return page.data.filter((membership) => membership.userId === userId).length > 0;
}

/**
 * D9 — tenant isolation: a member of one organization must not reach another
 * organization's records, by any route this contract offers.
 *
 * ## Why this is a separate suite (DEC-1)
 *
 * It is driven by the server that owns the store and by nothing else. The
 * reasoning is in {@link IOrganizationServiceSecurityContractDeps}'s own
 * preamble and in the shared suite's: an implementation that reaches its data
 * over the wire could satisfy these assertions only by refusing on its own
 * account, which proves that it refuses. **If a cross-tenant assertion ever
 * looks like it belongs in `runIOrganizationServiceContract`, it belongs
 * here.**
 *
 * ## The fault these assertions are written against
 *
 * There are two ways a tenant boundary is crossed, and only one of them is
 * realistic today:
 *
 * - **The asker is resolved from the wrong place.** An implementation that
 *   worked out *who is asking* from the organization the request names, rather
 *   than from whatever proved the caller's identity, would compare the request
 *   against itself. That is not a property of this contract — nothing here is
 *   told how a caller is identified — so it is asserted wherever identification
 *   happens. It is also, in practice, *fail-closed*: looking a person up by an
 *   organization's identifier finds nobody and refuses everything.
 * - **The asker is right, the tenant is right, and the TARGET is resolved by id
 *   alone.** The membership check passes for the organization the caller named,
 *   and then the implementation fetches the invitation, the membership or the
 *   record by its own id with no `organization_id` in the predicate. Nothing
 *   fails closed; the caller reaches straight into the other tenant. **That is
 *   the fault that can actually leak, and the write-side assertions below —
 *   revoke, change-role, remove, invite — are written against it.** Each one is
 *   made by a legitimate OWNER of tenant A, inside tenant A, naming a row of
 *   tenant B: exactly the request a scoped query refuses and an unscoped one
 *   serves.
 *
 * Each of those pairs its refusal with a check that the other tenant's state
 * was **not** changed, because an implementation can refuse the caller and still
 * have written the row first.
 *
 * @param deps - the host runner's primitives, a two-tenant world factory, and
 * the ids that are well-formed for the host's store and answer to nothing
 */
export function runIOrganizationServiceSecurityContract(
  deps: IOrganizationServiceSecurityContractDeps,
): void {
  const { describe, it, expect, makeContext, absentOrganizationId, absentInvitationId } = deps;

  describe('IOrganizationService tenant isolation (D9)', () => {
    describe('the read boundary', () => {
      // The core of D9, and the assertion most easily written so that it cannot
      // fail. Comparing the two REFUSALS rather than only their types is the
      // point: an implementation that answered `OrganizationNotFoundError` to
      // both, with "no such organization" in one message and "you are not a
      // member of this organization" in the other, satisfies a type comparison
      // and leaks precisely the fact the shared answer was chosen to hide.
      //
      // The two messages cannot be compared byte for byte, because each names
      // the id it was asked about and the two ids differ — that difference is
      // the caller's own input echoed back and reveals nothing. So the absent
      // id is substituted into the absent refusal's text and the result must be
      // the foreign refusal's text exactly: same sentence, same shape, nothing
      // in one that is not in the other.
      //
      // The control read comes first and is load-bearing. Without it an
      // implementation that refuses EVERY read passes this and every other
      // refusal in this suite.
      it('answers a cross-tenant read exactly as it answers a missing one', async () => {
        const { service, organization, owner, otherOrganization } = await makeContext();

        const readable = await service.getOrganization(owner.id, organization.id);
        expect.equal(
          readable.id,
          organization.id,
          'the world must seed an organization its own owner can read',
        );

        // Caught rather than asserted through the runner's `rejects`, which
        // asserts a refusal's *type* and hands the refusal itself to nobody.
        // What this assertion is about is the sentence the refusal carries, so
        // it needs the object. `.catch` rather than `try`/`catch` so that a
        // refusal is the value of an expression and nothing here depends on a
        // path that only runs when the implementation is already broken.
        const foreign: unknown = await service
          .getOrganization(owner.id, otherOrganization.id)
          .catch((error: unknown) => error);
        const missing: unknown = await service
          .getOrganization(owner.id, absentOrganizationId)
          .catch((error: unknown) => error);

        expect.ok(
          foreign instanceof OrganizationNotFoundError,
          'another tenant\'s organization must be refused as one that does not exist',
        );
        expect.ok(
          missing instanceof OrganizationNotFoundError,
          'and an id nobody issued must be refused the same way',
        );
        expect.equal(
          (foreign as Error).constructor.name,
          (missing as Error).constructor.name,
          'the two refusals must be the same refusal, not two that share a base class',
        );
        expect.equal(
          (foreign as Error).message,
          (missing as Error).message.split(absentOrganizationId).join(otherOrganization.id),
          'and must carry the same sentence, differing only in the id the caller itself supplied',
        );
      });

      // The other half of the same boundary, and the one that catches an
      // unscoped `SELECT * FROM memberships`: A's owner asks for A's members and
      // must be shown A's, not everybody's. Both directions, because either one
      // alone passes for an implementation that is simply wrong in one way — a
      // service that returns nothing satisfies "B's people are absent", and one
      // that returns everything satisfies "A's people are present".
      it('never returns another tenant\'s members', async () => {
        const { service, organization, owner, member, otherOrganization, otherOwner, otherMember }
          = await makeContext();

        const mine = await service.listMembers(owner.id, organization.id, EVERYTHING);
        expect.ok(listsMember(mine, owner.id), 'the world must list A\'s own owner');
        expect.ok(listsMember(mine, member.id), 'and A\'s own member');
        expect.equal(
          listsMember(mine, otherOwner.id),
          false,
          'B\'s owner must not appear in A\'s member list',
        );
        expect.equal(
          listsMember(mine, otherMember.id),
          false,
          'nor must B\'s member',
        );
        expect.equal(
          mine.meta.total,
          mine.data.length,
          'and the total must count the same set that was returned, not a wider one',
        );

        await expect.rejects(
          () => service.listMembers(owner.id, otherOrganization.id, EVERYTHING),
          OrganizationNotFoundError,
          'and asking for B\'s members directly must be refused as a missing organization',
        );
      });

      it('never returns another tenant\'s invitations', async () => {
        const { service, organization, owner, otherOrganization, otherInvitation }
          = await makeContext();

        const mine = await service.listInvitations(owner.id, organization.id, EVERYTHING);
        expect.equal(
          mine.data.filter((invitation) => invitation.id === otherInvitation.id).length,
          0,
          'B\'s invitation must not appear in A\'s invitation list',
        );
        expect.equal(
          mine.data.filter((invitation) => invitation.organizationId !== organization.id).length,
          0,
          'and nothing in the page may belong to any organization but A',
        );

        await expect.rejects(
          () => service.listInvitations(owner.id, otherOrganization.id, EVERYTHING),
          OrganizationNotFoundError,
          'and asking for B\'s invitations directly must be refused as a missing organization',
        );
      });

      // `listOrganizations` is a join through memberships, never a scan of
      // organizations, and the difference is the whole of tenant isolation on
      // that method. Both directions again, for the same reason.
      it('lists no organization the actor does not belong to', async () => {
        const { service, organization, owner, otherOrganization } = await makeContext();

        const mine = await service.listOrganizations(owner.id, EVERYTHING);
        expect.equal(
          mine.data.filter((listed) => listed.id === organization.id).length,
          1,
          'A\'s owner must be shown A',
        );
        expect.equal(
          mine.data.filter((listed) => listed.id === otherOrganization.id).length,
          0,
          'and must not be shown B',
        );
      });
    });

    // The realistic fault, stated four times over. In each of these the actor is
    // a legitimate OWNER acting inside their own organization — every membership
    // check on the way in passes — and the row they name belongs to the other
    // tenant. Only a lookup that carries the organization into its predicate
    // refuses them.
    describe('the write boundary: a legitimate actor naming another tenant\'s row', () => {
      it('refuses to revoke another tenant\'s invitation, and leaves it redeemable', async () => {
        const {
          service,
          organization,
          owner,
          otherOrganization,
          otherInvitation,
          otherInvitationToken,
          outsider,
          now,
        } = await makeContext();

        expect.equal(
          otherInvitation.status,
          InvitationStatus.PENDING,
          'the world must issue an open invitation in B for this to be a revocation',
        );
        expect.ok(
          otherInvitation.isOpenAt(now),
          'and it must still be open as of the world\'s own now',
        );

        // The same error as an id nobody ever issued, and asserted against the
        // absent id in the same test, so that an implementation that answered
        // one of them differently fails here rather than somewhere quieter.
        await expect.rejects(
          () => service.revokeInvitation(owner.id, organization.id, otherInvitation.id),
          InvitationNotFoundError,
          'B\'s invitation, named from inside A, must answer as one that does not exist',
        );
        await expect.rejects(
          () => service.revokeInvitation(owner.id, organization.id, absentInvitationId),
          InvitationNotFoundError,
          'which is what an id nobody ever issued answers',
        );

        // The consequence, not the status: an implementation that refuses the
        // caller AFTER closing the row satisfies the refusal above and has still
        // destroyed the other tenant's invitation. Redeeming it is the only way
        // to ask whether it survived.
        const membership = await service.acceptInvitation(outsider.id, otherInvitationToken);
        expect.ok(membership instanceof Membership, 'B\'s invitation must still redeem');
        expect.equal(
          membership.organizationId,
          otherOrganization.id,
          'and must still place its recipient in B',
        );
      });

      it('refuses to change the role of another tenant\'s member, and changes nothing', async () => {
        const { service, organization, owner, otherOrganization, otherOwner, otherMember }
          = await makeContext();

        await expect.rejects(
          () => service.changeMemberRole(
            owner.id,
            organization.id,
            otherMember.id,
            OrgRole.ADMIN,
          ),
          MembershipNotFoundError,
          'B\'s member, named from inside A, must not be found there',
        );

        // Read back through B's own owner, who is entitled to see it. An
        // implementation that wrote the row and then refused the caller is
        // caught here and nowhere else.
        const theirs = await service.listMembers(otherOwner.id, otherOrganization.id, EVERYTHING);
        // Read as a list of roles rather than through an optional lookup: the
        // count IS half the assertion, and `[0]?.role` would quietly compare
        // `undefined` against `undefined` if B's member had gone.
        const roles = theirs.data
          .filter((each) => each.userId === otherMember.id)
          .map((each) => each.role);
        expect.equal(roles.length, 1, 'B\'s member must still be a member of B');
        expect.equal(roles[0], OrgRole.MEMBER, 'and must still hold the role B gave them');
      });

      it('refuses to remove another tenant\'s member, who stays a member', async () => {
        const { service, organization, owner, otherOrganization, otherOwner, otherMember }
          = await makeContext();

        await expect.rejects(
          () => service.removeMember(owner.id, organization.id, otherMember.id),
          MembershipNotFoundError,
          'B\'s member, named from inside A, must not be removable from A',
        );

        const theirs = await service.listMembers(otherOwner.id, otherOrganization.id, EVERYTHING);
        expect.ok(
          listsMember(theirs, otherMember.id),
          'and must still be a member of B afterwards',
        );
      });

      // The write boundary in the other direction: not naming B's row from
      // inside A, but naming B itself. An implementation that takes the
      // organization straight off its parameter and writes with it — never
      // asking whether the actor belongs to it — issues an invitation into a
      // tenant the actor has nothing to do with.
      it('refuses to invite anybody into another tenant, and issues nothing', async () => {
        const { service, owner, otherOrganization, otherOwner, outsider } = await makeContext();

        const before = await service.listInvitations(
          otherOwner.id,
          otherOrganization.id,
          EVERYTHING,
        );

        await expect.rejects(
          () => service.inviteMember(owner.id, otherOrganization.id, {
            email: outsider.email,
            role: OrgRole.ADMIN,
          }),
          OrganizationNotFoundError,
          'A\'s owner must not be able to invite into B',
        );

        const after = await service.listInvitations(
          otherOwner.id,
          otherOrganization.id,
          EVERYTHING,
        );
        expect.equal(
          after.meta.total,
          before.meta.total,
          'and B must hold no invitation it did not hold before',
        );
      });
    });

    describe('redemption lands in the inviting organization and nowhere else', () => {
      // An invitation carries its organization; nothing a redeemer says can move
      // it. The assertion is the pair: the membership is in B, AND the redeemer
      // gained nothing in A. An implementation that placed every redeemer into
      // some default organization satisfies the first half on its own if that
      // default happened to be B.
      it('places a redeemer in the inviting organization only', async () => {
        const {
          service,
          organization,
          otherOrganization,
          otherInvitationToken,
          outsider,
        } = await makeContext();

        const membership = await service.acceptInvitation(outsider.id, otherInvitationToken);
        expect.equal(
          membership.organizationId,
          otherOrganization.id,
          'the membership must be in the organization that issued the invitation',
        );
        expect.equal(membership.userId, outsider.id, 'and must belong to whoever redeemed it');

        const theirs = await service.listOrganizations(outsider.id, EVERYTHING);
        expect.equal(
          theirs.data.filter((listed) => listed.id === otherOrganization.id).length,
          1,
          'the redeemer must now belong to B',
        );
        expect.equal(
          theirs.data.filter((listed) => listed.id === organization.id).length,
          0,
          'and must have gained nothing in A',
        );
      });
    });
  });
}
