import { normalizeEmail } from '../../shared/policies/normalizeEmail';
import type { PaginatedResult } from '../../shared/types/PaginatedResult';
import type { UserId } from '../../users/types/UserId';
import { Invitation } from '../entities/Invitation';
import { Membership } from '../entities/Membership';
import { Organization } from '../entities/Organization';
import { InvitationStatus } from '../enums/InvitationStatus';
import { OrgRole } from '../enums/OrgRole';
import { AlreadyAMemberError } from '../errors/AlreadyAMemberError';
import { InvitationNoLongerOpenError } from '../errors/InvitationNoLongerOpenError';
import { InvitationNotFoundError } from '../errors/InvitationNotFoundError';
import { LastOwnerError } from '../errors/LastOwnerError';
import { OrganizationNotFoundError } from '../errors/OrganizationNotFoundError';
import type { IOrganizationServiceContractDeps } from './IOrganizationServiceContractDeps';

/**
 * One page large enough to hold everything any world this suite runs against
 * contains, so that no assertion about *which* records came back is really an
 * assertion about where a page boundary fell.
 */
const EVERYTHING = { page: 1, limit: 100 };

/**
 * How many memberships a conforming world's organization holds: `owner`,
 * `admin` and `member`.
 *
 * Not a number chosen for this file — it is
 * `IOrganizationServiceContractDeps`'s own obligation, which names those three
 * as members of `organization` and `outsider` as belonging to no organization
 * at all. The membership assertions are only meaningful because the host is
 * forbidden to seed a fourth member, so they read that obligation by name
 * instead of repeating its arithmetic as a literal.
 */
const SEEDED_MEMBERS = 3;

/** The membership of one user in a page of them, or `undefined` if it is not there. */
function membershipOf(
  page: PaginatedResult<Membership>,
  userId: UserId,
): Membership | undefined {
  return page.data.filter((membership) => membership.userId === userId)[0];
}

/** Whether a page of organizations contains one with this id. */
function lists(page: PaginatedResult<Organization>, organizationId: string): boolean {
  return page.data.filter((organization) => organization.id === organizationId).length > 0;
}

/**
 * The behavior every {@link IOrganizationService} implementation must exhibit.
 *
 * Each implementation drives this suite with its own runner's
 * `describe`/`it`/`expect`, which is what makes "they behave the same" a fact
 * the build checks rather than a claim a reviewer makes. The suite asserts
 * behavior only: who is *allowed* to do these things is enforced where the
 * implementation lives, and is held to its own suite there.
 *
 * Every assertion here has to be one an implementation can actually fail, so
 * each one compares what the service returned against the world the host
 * promised — never against something the same call just produced — and proves
 * that what came back is a real entity rather than the raw shape some store or
 * peer handed over. Four of them are the ones a careless reading turns into
 * tautologies: that the creator becomes the sole OWNER, that the last owner can
 * be neither demoted nor removed, and that an accepted invitation confers the
 * role the invitation carried. Each of those states the world's promise as its
 * own assertion first, so a world that failed to keep it fails loudly rather
 * than quietly proving nothing.
 *
 * **Tenant isolation is deliberately absent.** That a member of one
 * organization asking for another's resource is answered as though it did not
 * exist is a property of a *server*, and an implementation that talks to one
 * could satisfy it here only by refusing on its own account — which would prove
 * that it refuses and nothing about the deployment. It is asserted where it can
 * fail for the right reason, in the security suite beside the server.
 *
 * @param deps - the host runner's primitives, a fresh-world factory, and the
 * ids and token that are well-formed for the host's store and answer to nothing
 */
export function runIOrganizationServiceContract(deps: IOrganizationServiceContractDeps): void {
  const {
    describe,
    it,
    expect,
    makeContext,
    absentOrganizationId,
    absentInvitationId,
    absentToken,
  } = deps;

  describe('IOrganizationService conformance', () => {
    describe('createOrganization', () => {
      it('creates an organization and returns a real entity', async () => {
        const { service, owner } = await makeContext();
        const created = await service.createOrganization(owner.id, {
          name: 'Second Works',
          slug: 'second-works',
        });
        expect.ok(created instanceof Organization, 'createOrganization must return a real entity');
        expect.equal(created.name, 'Second Works', 'it must carry the name it was asked for');
        expect.equal(created.slug, 'second-works', 'and the slug it was asked for');
        expect.equal(created.isDeleted, false, 'and must not arrive already deleted');
      });

      // An organization always has at least one OWNER. That invariant starts
      // here, at creation, and it is the one most easily asserted so that it
      // cannot fail: an organization with no OWNER can be
      // administered by nobody, and nothing inside the domain can put one back.
      //
      // It is asserted through `listMembers` rather than through anything
      // `createOrganization` returned, because the fault it exists to catch is
      // an implementation that makes the organization and forgets the
      // membership. Such an implementation returns a perfectly good
      // `Organization`, so every assertion made on that return value passes;
      // only asking the store who the members are finds nothing there.
      //
      // The total is compared against 1 as well as the page length, because an
      // implementation that creates the membership but reports the count of
      // some other set is exactly as broken and fails neither on its own.
      it('makes the creator its sole OWNER', async () => {
        const { service, owner } = await makeContext();
        const created = await service.createOrganization(owner.id, {
          name: 'Second Works',
          slug: 'second-works',
        });

        const members = await service.listMembers(owner.id, created.id, EVERYTHING);
        expect.equal(members.meta.total, 1, 'a new organization must have exactly one member');
        expect.equal(members.data.length, 1, 'and must return exactly that one');

        const only = members.data[0];
        expect.ok(only instanceof Membership, 'listMembers must return real entities');
        expect.equal(only.userId, owner.id, 'the sole member must be whoever created it');
        expect.equal(only.role, OrgRole.OWNER, 'and must hold OWNER, not a lesser role');
      });
    });

    describe('listOrganizations', () => {
      // Both directions, because either one alone passes for an implementation
      // that is simply wrong in one way. A service that returns nothing at all
      // satisfies "the outsider sees none"; a service that returns every
      // organization there is satisfies "the owner sees theirs".
      it('lists only organizations the actor belongs to', async () => {
        const { service, organization, owner, outsider } = await makeContext();

        const mine = await service.listOrganizations(owner.id, EVERYTHING);
        expect.ok(
          lists(mine, organization.id),
          'a member must be shown the organization the world says they belong to',
        );
        expect.ok(
          mine.data[0] instanceof Organization,
          'listOrganizations must return real entities',
        );

        const theirs = await service.listOrganizations(outsider.id, EVERYTHING);
        expect.equal(theirs.data.length, 0, 'somebody who belongs to none must be shown none');
        expect.equal(theirs.meta.total, 0, 'and must be told there are none, not merely shown none');
      });
    });

    describe('getOrganization', () => {
      it('rejects an organization id that does not exist', async () => {
        const { service, owner } = await makeContext();
        await expect.rejects(
          () => service.getOrganization(owner.id, absentOrganizationId),
          OrganizationNotFoundError,
        );
      });

      // The same error as for an id nobody ever issued, on purpose: an answer
      // that distinguished the two would let somebody learn which organizations
      // exist by asking about them one at a time.
      //
      // The read by a member comes first and is load-bearing. Without it an
      // implementation that answers `OrganizationNotFoundError` to *everything*
      // passes this and the assertion above, and the pair would report a green
      // suite for a service that never finds anything at all.
      it('refuses an organization the actor does not belong to, indistinguishably', async () => {
        const { service, organization, owner, outsider } = await makeContext();
        const readable = await service.getOrganization(owner.id, organization.id);
        expect.ok(readable instanceof Organization, 'getOrganization must return a real entity');
        expect.equal(
          readable.id,
          organization.id,
          'the world must seed an organization its own owner can read',
        );

        await expect.rejects(
          () => service.getOrganization(outsider.id, organization.id),
          OrganizationNotFoundError,
          'a non-member must be answered exactly as for an id that does not exist',
        );
      });
    });

    describe('updateOrganization', () => {
      // The later read is the point. An implementation that builds an updated
      // entity and returns it without ever storing it satisfies everything
      // asserted about the return value, and a caller only discovers it on the
      // next page load.
      it('updates the name and the change is readable afterwards', async () => {
        const { service, organization, owner } = await makeContext();
        const updated = await service.updateOrganization(owner.id, organization.id, {
          name: 'Renamed Works',
        });
        expect.ok(updated instanceof Organization, 'updateOrganization must return a real entity');
        expect.equal(updated.name, 'Renamed Works', 'the returned name must be the new one');

        const reread = await service.getOrganization(owner.id, organization.id);
        expect.equal(reread.name, 'Renamed Works', 'and must still be the new one on a later read');
        expect.equal(reread.slug, organization.slug, 'an omitted field must be left alone');
      });
    });

    describe('deleteOrganization', () => {
      // The listing before the delete is load-bearing: an organization that was
      // never listed stops being listed for free, and the assertion would hold
      // for an implementation whose `deleteOrganization` does nothing whatever.
      //
      // That the record is *retained* — the half of a soft delete that makes
      // history referencing it stay readable — is deliberately not asserted
      // here. No method on this contract shows a caller a deleted organization,
      // so there is nothing a conforming implementation could be asked for that
      // would distinguish a soft delete from a hard one. Asserting it would mean
      // inventing a way to look, and an assertion on a method that exists only
      // to be asserted on proves that the method exists.
      it('deletes an organization, and it stops being listed', async () => {
        const { service, organization, owner } = await makeContext();
        const before = await service.listOrganizations(owner.id, EVERYTHING);
        expect.ok(
          lists(before, organization.id),
          'the world must list the organization before it is deleted',
        );

        await service.deleteOrganization(owner.id, organization.id);

        const after = await service.listOrganizations(owner.id, EVERYTHING);
        expect.equal(
          lists(after, organization.id),
          false,
          'a deleted organization must stop being listed',
        );
      });
    });

    describe('listMembers', () => {
      // Against the three people the world promised, by identity and by role —
      // not against a total the service reported, which an implementation that
      // lost a membership reports just as confidently as one that did not.
      it('lists the seeded members', async () => {
        const { service, organization, owner, admin, member } = await makeContext();
        const page = await service.listMembers(owner.id, organization.id, EVERYTHING);
        expect.equal(page.meta.total, SEEDED_MEMBERS, 'every seeded member must be counted');
        expect.equal(page.data.length, SEEDED_MEMBERS, 'and every one of them returned');
        expect.ok(page.data[0] instanceof Membership, 'listMembers must return real entities');

        const ownerMembership = membershipOf(page, owner.id);
        const adminMembership = membershipOf(page, admin.id);
        const memberMembership = membershipOf(page, member.id);
        expect.ok(ownerMembership !== undefined, 'the owner must be listed');
        expect.ok(adminMembership !== undefined, 'the admin must be listed');
        expect.ok(memberMembership !== undefined, 'the ordinary member must be listed');

        // Each against the role the world's own obligation names for that
        // person, so an implementation that lists the right people with the
        // wrong roles fails here rather than passing for having the right count.
        expect.equal(ownerMembership?.role, OrgRole.OWNER, 'the owner must be listed as OWNER');
        expect.equal(adminMembership?.role, OrgRole.ADMIN, 'the admin must be listed as ADMIN');
        expect.equal(memberMembership?.role, OrgRole.MEMBER, 'the member must be listed as MEMBER');
      });
    });

    describe('changeMemberRole', () => {
      // The guard states what the world promised about `member` before the
      // change is made. Promoting somebody who was already an ADMIN would leave
      // this green for an implementation whose `changeMemberRole` does nothing.
      it('changes a member\'s role and the change is readable afterwards', async () => {
        const { service, organization, owner, member } = await makeContext();
        const before = await service.listMembers(owner.id, organization.id, EVERYTHING);
        expect.equal(
          membershipOf(before, member.id)?.role,
          OrgRole.MEMBER,
          'the world must seed an ordinary member for this change to be a change',
        );

        const changed = await service.changeMemberRole(
          owner.id,
          organization.id,
          member.id,
          OrgRole.ADMIN,
        );
        expect.ok(changed instanceof Membership, 'changeMemberRole must return a real entity');
        expect.equal(changed.role, OrgRole.ADMIN, 'the returned role must be the new one');
        expect.equal(changed.userId, member.id, 'and it must be the membership of whoever was named');

        const after = await service.listMembers(owner.id, organization.id, EVERYTHING);
        expect.equal(
          membershipOf(after, member.id)?.role,
          OrgRole.ADMIN,
          'and the change must still be there on a later read',
        );
      });

      // The world promises `owner` is the ONLY owner, so this is the invariant and
      // not a coincidence of fixtures. The guard asserts that promise first: a
      // host that seeded a second owner would otherwise make this pass for the
      // wrong reason, and report a green suite for an implementation with no
      // last-owner rule at all.
      //
      // `admin` is the actor and `owner` is the target — deliberately not
      // `owner` acting on themselves. The invariant is "an organization always
      // has at least one OWNER", which is a fact about a COUNT of remaining
      // owners, not about whether the actor and the target are the same
      // person. `if (targetUserId === actorId) throw new LastOwnerError()` is
      // the wrong implementation this distinguishes: it satisfies every
      // assertion in this suite that has the owner act on their own
      // membership, and an ADMIN demoting the sole OWNER is not the owner
      // demoting themselves. A suite that only ever had `owner` act on `owner`
      // would pass that wrong implementation and every other one — which is
      // what injecting exactly that implementation demonstrated against the
      // weaker, owner-acting-on-owner form this assertion replaced.
      it('refuses to demote the last owner, whoever is asking', async () => {
        const { service, organization, owner, admin } = await makeContext();
        const members = await service.listMembers(owner.id, organization.id, EVERYTHING);
        const owners = members.data.filter((m) => m.role === OrgRole.OWNER);
        expect.equal(owners.length, 1, 'the world must seed exactly one owner for this assertion to mean anything');

        await expect.rejects(
          () => service.changeMemberRole(admin.id, organization.id, owner.id, OrgRole.ADMIN),
          LastOwnerError,
        );
      });
    });

    describe('removeMember', () => {
      // The same guard, for the same reason, on the other half of the
      // invariant: a rule enforced in `changeMemberRole` and forgotten in
      // `removeMember` leaves the organization exactly as ownerless, by a
      // different route. `admin` acting on `owner`, for the same reason as
      // `changeMemberRole`'s own comment above: an ADMIN removing the sole
      // OWNER is not the owner leaving, and a suite that never asked that
      // question would not catch an implementation that only refuses the
      // owner's own request.
      it('refuses to remove the last owner, whoever is asking', async () => {
        const { service, organization, owner, admin } = await makeContext();
        const members = await service.listMembers(owner.id, organization.id, EVERYTHING);
        const owners = members.data.filter((m) => m.role === OrgRole.OWNER);
        expect.equal(owners.length, 1, 'the world must seed exactly one owner for this assertion to mean anything');

        await expect.rejects(
          () => service.removeMember(admin.id, organization.id, owner.id),
          LastOwnerError,
        );
      });
    });

    describe('inviteMember', () => {
      // Issued as a VIEWER on purpose: it is the role no defaulting
      // implementation would pick, so the assertion on `role` fails for one
      // that hands out MEMBER regardless of what it was asked for.
      //
      // The listing at the end is the counterpart of the later read in
      // `updateOrganization`: an implementation that builds an invitation and
      // returns it without storing it satisfies everything asserted about the
      // return value, and nobody finds out until the invitation cannot be
      // revoked or redeemed.
      it('issues an invitation that is PENDING and carries the invited role', async () => {
        const { service, organization, owner, uninvitedEmail, now } = await makeContext();
        const invitation = await service.inviteMember(owner.id, organization.id, {
          email: uninvitedEmail,
          role: OrgRole.VIEWER,
        });
        expect.ok(invitation instanceof Invitation, 'inviteMember must return a real entity');
        expect.equal(invitation.status, InvitationStatus.PENDING, 'a new invitation is PENDING');
        expect.equal(invitation.role, OrgRole.VIEWER, 'it must carry the role it was asked for');
        expect.equal(
          invitation.email,
          normalizeEmail(uninvitedEmail),
          'addressed to the address it was asked for, in normal form',
        );
        expect.equal(invitation.organizationId, organization.id, 'in the inviting organization');
        // `invitedByUserId` is `UserId | null` on the type — `null` is what a
        // later read may answer once the inviter's account has been deleted —
        // but issuing one never produces it. Guarded the same way commit
        // 2203f99 guarded `AuditEntry.organizationId`: without this, a future
        // implementation that always answered `null` here would still satisfy
        // `equal` for a world where the comparison degenerated, though `owner.id`
        // itself is never null, so this is belt-and-braces against exactly that
        // degeneration rather than a comparison that is vacuous today.
        expect.ok(invitation.invitedByUserId !== null, 'a freshly issued invitation must name a real inviter');
        expect.equal(invitation.invitedByUserId, owner.id, 'and naming whoever sent it');
        expect.ok(
          invitation.isOpenAt(now),
          'a freshly issued invitation must still be open as of the world\'s own now',
        );

        const pending = await service.listInvitations(owner.id, organization.id, {
          ...EVERYTHING,
          status: InvitationStatus.PENDING,
        });
        expect.equal(
          pending.data.filter((issued) => issued.id === invitation.id).length,
          1,
          'and it must be there when the organization\'s pending invitations are listed',
        );
      });

      // A second membership would give the same person two roles in the same
      // organization with no rule for which one governs. The guard states the
      // world's promise that `member` is one: an implementation that refuses
      // every invitation would otherwise pass this without the address having
      // mattered at all.
      it('refuses to invite somebody who is already a member', async () => {
        const { service, organization, owner, member } = await makeContext();
        const members = await service.listMembers(owner.id, organization.id, EVERYTHING);
        expect.ok(
          membershipOf(members, member.id) !== undefined,
          'the world must seed the member it promises for this refusal to be about them',
        );

        await expect.rejects(
          () => service.inviteMember(owner.id, organization.id, {
            email: member.email,
            role: OrgRole.MEMBER,
          }),
          AlreadyAMemberError,
        );
      });
    });

    describe('revokeInvitation', () => {
      // Two halves, and the second is the one that matters. An implementation
      // that flips the status field and leaves the value the recipient holds
      // still redeemable satisfies everything asserted about the returned
      // entity, and the invitation it "withdrew" is accepted the next time
      // somebody opens the link they were already sent. So the state change is
      // tied to its consequence in one assertion rather than trusted to imply
      // it.
      //
      // The token is taken before the revocation, because that is when a
      // recipient got theirs: an implementation is under no obligation to still
      // hand one out for an invitation that is closed.
      it('revokes an invitation, and its token stops redeeming', async () => {
        const { service, organization, owner, outsider, tokenFor } = await makeContext();
        const invitation = await service.inviteMember(owner.id, organization.id, {
          email: outsider.email,
          role: OrgRole.MEMBER,
        });
        const token = await tokenFor(invitation);
        expect.equal(
          invitation.status,
          InvitationStatus.PENDING,
          'the world must issue an open invitation for withdrawing it to be a change',
        );

        const revoked = await service.revokeInvitation(owner.id, organization.id, invitation.id);
        expect.ok(revoked instanceof Invitation, 'revokeInvitation must return a real entity');
        expect.equal(revoked.id, invitation.id, 'and must be the invitation it was asked about');
        expect.equal(
          revoked.status,
          InvitationStatus.REVOKED,
          'the returned invitation must be REVOKED',
        );

        await expect.rejects(
          () => service.acceptInvitation(outsider.id, token),
          InvitationNoLongerOpenError,
          'and the value its recipient holds must stop redeeming',
        );
      });

      // `InvitationNotFoundError`, not `InvitationNoLongerOpenError`. The three
      // CLOSED reasons — revoked, accepted, expired — collapse into one answer
      // so that a caller cannot learn which of them happened. Never-issued stays
      // separate, because that collapse is justified by an identifier being
      // guessable and this one is not: somebody managing invitations needs to
      // know whether there is anything left to withdraw.
      it('rejects an invitation id that does not exist', async () => {
        const { service, organization, owner } = await makeContext();
        await expect.rejects(
          () => service.revokeInvitation(owner.id, organization.id, absentInvitationId),
          InvitationNotFoundError,
        );
      });
    });

    describe('acceptInvitation', () => {
      // The role the membership ends up with must come from the INVITATION, not
      // from a default. A service that ignores the invited role and always
      // creates a MEMBER satisfies every other assertion in this suite: the
      // invitation is still PENDING-then-ACCEPTED, the membership still exists,
      // the member still appears in the list. So the invitation is issued with a
      // role that is NOT the one a defaulting implementation would pick.
      //
      // It is addressed to the account that redeems it. An invitation is
      // addressed to an email and not to whoever happens to be signed in when
      // the link is opened — `InvitationAddressMismatchError` exists for exactly
      // that case — so an assertion that had somebody redeem an offer sent to an
      // address they do not hold would oblige every implementation to abandon
      // that rule in order to stay green.
      it('accepts an invitation, creating a membership with the role the invitation carried', async () => {
        const { service, organization, owner, outsider, tokenFor } = await makeContext();
        const invitation = await service.inviteMember(owner.id, organization.id, {
          email: outsider.email,
          role: OrgRole.ADMIN,
        });
        expect.equal(invitation.role, OrgRole.ADMIN, 'the world must issue the invitation it was asked for');

        const membership = await service.acceptInvitation(outsider.id, await tokenFor(invitation));
        expect.ok(membership instanceof Membership, 'acceptInvitation must return a real entity');
        expect.equal(
          membership.role,
          OrgRole.ADMIN,
          'the membership must carry the role the invitation carried, not a default',
        );
        expect.equal(membership.organizationId, organization.id, 'and must be in the inviting organization');
        expect.equal(membership.userId, outsider.id, 'and must belong to whoever redeemed it');
      });

      // An invitation is single-use. The first acceptance is not decoration: it
      // is what puts the invitation into the state this refusal is about, and it
      // throws on its own if the implementation cannot redeem one at all.
      it('refuses a token that has already been redeemed', async () => {
        const { service, organization, owner, outsider, tokenFor } = await makeContext();
        const invitation = await service.inviteMember(owner.id, organization.id, {
          email: outsider.email,
          role: OrgRole.MEMBER,
        });
        const token = await tokenFor(invitation);
        await service.acceptInvitation(outsider.id, token);

        await expect.rejects(
          () => service.acceptInvitation(outsider.id, token),
          InvitationNoLongerOpenError,
        );
      });

      // A value nobody issued, answered the same way as an id nobody issued and
      // deliberately not the same way as one that has closed — see the note on
      // `revokeInvitation` above for why that distinction survives here.
      it('rejects a token that redeems nothing', async () => {
        const { service, outsider } = await makeContext();
        await expect.rejects(
          () => service.acceptInvitation(outsider.id, absentToken),
          InvitationNotFoundError,
        );
      });
    });
  });
}
