import type { PaginatedResult } from '../../shared/types/PaginatedResult';
import { CrossTenantGrantError } from '../errors/CrossTenantGrantError';
import { GrantNotFoundError } from '../errors/GrantNotFoundError';
import type { GrantId } from '../types/GrantId';
import type { ResourceGrant } from '../types/ResourceGrant';
import type { IAuthorizationServiceContractDeps } from './IAuthorizationServiceContractDeps';

/**
 * One page large enough to hold everything any world this suite runs against
 * contains, so that no assertion about *which* grants came back is really an
 * assertion about where a page boundary fell.
 */
const EVERYTHING = { page: 1, limit: 100 };

/** The record every assertion is about, and a second one for telling two grants apart. */
const RECORD = 'record-1';
const OTHER_RECORD = 'record-2';

/** How long after the world's `now` a lapsing grant is set to lapse. */
const A_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Whether a page of grants contains one with this id. */
function grantIn(page: PaginatedResult<ResourceGrant>, id: GrantId): boolean {
  return page.data.filter((grant) => grant.id === id).length > 0;
}

/**
 * An instant as a number, or `null`, so that two of them compare by value.
 *
 * `equal` is strict equality and two `Date` objects for the same instant are not
 * equal, so a comparison made directly on them fails an implementation that is
 * right. Nullable because "no expiry" is one of the two answers being asserted.
 *
 * @param at - an instant, or `null` for a grant that does not lapse
 * @returns milliseconds since the epoch, or `null`
 */
function instant(at: Date | null): number | null {
  return at === null ? null : at.getTime();
}

/**
 * The behavior every {@link IAuthorizationService} implementation must exhibit.
 *
 * Each implementation drives this suite with its own runner's
 * `describe`/`it`/`expect`, which is what makes "they behave the same" a fact
 * the build checks rather than a claim a reviewer makes. The suite asserts
 * behavior only: who is *allowed* to administer grants is `can`'s answer to
 * `grant:read`, `grant:create` and `grant:revoke`, enforced where the
 * implementation lives and held to its own suite there.
 *
 * Every assertion has to be one an implementation can actually fail, so each
 * compares what the service returned against the world the host promised —
 * never against something the same call just produced. Two of them would
 * otherwise be tautologies and state the world's promise as their own assertion
 * first: that the issuer is somebody other than the subject, without which
 * "records the actor as the issuer" cannot fail; and that the same person the
 * suite was refused a grant for *can* be granted where they are a member,
 * without which the refusal might be about the person rather than the tenant.
 *
 * The rule the whole of it is about is that a grant is confined to one
 * organization. It is asserted three times over, because there are three ways
 * out of a tenant and each of them is a different mistake: listing that ignores
 * the organization, withdrawing that finds another organization's grant, and
 * issuing to somebody who does not belong.
 *
 * @param deps - the host runner's primitives, a fresh-world factory, and the
 * grant id that is well-formed for the host's store and answers to nothing
 */
export function runIAuthorizationServiceContract(
  deps: IAuthorizationServiceContractDeps,
): void {
  const { describe, it, expect, makeContext, absentGrantId } = deps;

  describe('IAuthorizationService conformance', () => {
    describe('createGrant', () => {
      it('issues a grant carrying what it was asked for, and stores it', async () => {
        const { service, organizationId, actorId, subjectUserId, resourceType }
          = await makeContext();

        const created = await service.createGrant(actorId, organizationId, {
          subjectUserId,
          resourceType,
          resourceId: RECORD,
          permission: 'organization:update',
        });

        expect.equal(created.subjectUserId, subjectUserId, 'it must be for the subject asked for');
        expect.equal(
          created.organizationId,
          organizationId,
          'and confined to the organization it was issued in',
        );
        expect.equal(created.resourceType, resourceType, 'and about the kind of record asked for');
        expect.equal(created.resourceId, RECORD, 'and about the record asked for');
        expect.equal(
          created.permission,
          'organization:update',
          'and carry the permission asked for',
        );
        // A `Date` and not the string a store holds. An implementation that
        // hands back its own row unmapped satisfies every comparison above and
        // fails this one, which is the whole reason it is here.
        expect.ok(
          created.createdAt instanceof Date,
          'an instant must arrive as a Date and not as the string a store keeps it in',
        );

        // Through a later read, because an implementation that builds a perfectly
        // good return value and never writes it passes everything above.
        const page = await service.listGrants(actorId, organizationId, EVERYTHING);
        expect.equal(grantIn(page, created.id), true, 'the grant must be there on a later read');
        expect.equal(page.meta.total, 1, 'and be the only grant this organization holds');
      });

      it('records the actor as the issuer', async () => {
        const { service, organizationId, actorId, subjectUserId, resourceType }
          = await makeContext();
        // The world's promise, stated as its own assertion. In a world where the
        // issuer and the subject are one person, an implementation that recorded
        // the subject as the issuer would pass the assertion below.
        expect.ok(
          actorId !== subjectUserId,
          'the world must issue grants as somebody other than their subject',
        );

        const created = await service.createGrant(actorId, organizationId, {
          subjectUserId,
          resourceType,
          resourceId: RECORD,
          permission: 'organization:update',
        });

        expect.equal(created.grantedBy, actorId, 'the actor must be recorded as the issuer');

        const page = await service.listGrants(actorId, organizationId, EVERYTHING);
        expect.equal(
          page.data[0].grantedBy,
          actorId,
          'and still be the issuer on a later read',
        );
      });

      it('keeps the expiry it was issued with, and invents none when none was asked for', async () => {
        const { service, organizationId, actorId, subjectUserId, resourceType, now }
          = await makeContext();
        const lapses = new Date(now.getTime() + A_WEEK);

        const lapsing = await service.createGrant(actorId, organizationId, {
          subjectUserId,
          resourceType,
          resourceId: RECORD,
          permission: 'organization:update',
          expiresAt: lapses,
        });
        const perpetual = await service.createGrant(actorId, organizationId, {
          subjectUserId,
          resourceType,
          resourceId: OTHER_RECORD,
          permission: 'organization:update',
        });

        // An implementation that drops the expiry conforms to everything else
        // here, and the consequence is silent: `isGrantLive` is what a hydrator
        // applies, and a grant whose expiry was never stored is one it can only
        // ever find live.
        expect.equal(
          instant(lapsing.expiresAt),
          lapses.getTime(),
          'a grant must keep the expiry it was issued with',
        );
        expect.equal(
          instant(perpetual.expiresAt),
          null,
          'and a grant issued without one must not acquire one',
        );
      });

      it('refuses to issue a grant to somebody who is not a member of the organization', async () => {
        const { service, organizationId, otherOrganizationId, actorId, outsiderId, resourceType }
          = await makeContext();

        await expect.rejects(
          () => service.createGrant(actorId, organizationId, {
            subjectUserId: outsiderId,
            resourceType,
            resourceId: RECORD,
            permission: 'organization:update',
          }),
          CrossTenantGrantError,
          'a grant may not be issued to a non-member — it would say an outsider may act here',
        );

        // The same person, the same record, the same permission, in the
        // organization they DO belong to. Without this, an implementation that
        // refused this person every grant anywhere would pass the refusal above,
        // and the assertion would be about the account rather than the boundary.
        const permitted = await service.createGrant(actorId, otherOrganizationId, {
          subjectUserId: outsiderId,
          resourceType,
          resourceId: RECORD,
          permission: 'organization:update',
        });
        expect.equal(
          permitted.subjectUserId,
          outsiderId,
          'the same person must be grantable where they are a member',
        );
      });
    });

    describe('listGrants', () => {
      it('lists only the grants of the organization asked about', async () => {
        const {
          service,
          organizationId,
          otherOrganizationId,
          actorId,
          subjectUserId,
          resourceType,
        } = await makeContext();

        const mine = await service.createGrant(actorId, organizationId, {
          subjectUserId,
          resourceType,
          resourceId: RECORD,
          permission: 'organization:update',
        });
        // The SAME record id in the other organization. Two tenants are free to
        // issue the same id, and an implementation that scoped its listing by
        // resource rather than by organization passes a version of this test
        // where the ids differ.
        const theirs = await service.createGrant(actorId, otherOrganizationId, {
          subjectUserId,
          resourceType,
          resourceId: RECORD,
          permission: 'organization:update',
        });

        const page = await service.listGrants(actorId, organizationId, EVERYTHING);

        expect.equal(grantIn(page, mine.id), true, 'this organization\'s grant must be listed');
        expect.equal(
          grantIn(page, theirs.id),
          false,
          'and another organization\'s grant must not be',
        );
        // The total as well as the page: an implementation that pages correctly
        // and counts the whole store is exactly as broken and fails neither on
        // its own.
        expect.equal(page.meta.total, 1, 'and the total must count only this organization\'s');
      });
    });

    describe('revokeGrant', () => {
      it('withdraws a grant, which stops being listed', async () => {
        const { service, organizationId, actorId, subjectUserId, resourceType }
          = await makeContext();
        const created = await service.createGrant(actorId, organizationId, {
          subjectUserId,
          resourceType,
          resourceId: RECORD,
          permission: 'organization:update',
        });

        const before = await service.listGrants(actorId, organizationId, EVERYTHING);
        expect.equal(
          grantIn(before, created.id),
          true,
          'the world must list the grant before it is withdrawn, or nothing was withdrawn',
        );

        await service.revokeGrant(actorId, organizationId, created.id);

        const after = await service.listGrants(actorId, organizationId, EVERYTHING);
        expect.equal(grantIn(after, created.id), false, 'a withdrawn grant must stop being listed');
        expect.equal(after.meta.total, 0, 'and stop being counted');
      });

      it('answers the same for an id it never issued and for another organization\'s', async () => {
        const {
          service,
          organizationId,
          otherOrganizationId,
          actorId,
          subjectUserId,
          resourceType,
        } = await makeContext();

        await expect.rejects(
          () => service.revokeGrant(actorId, organizationId, absentGrantId),
          GrantNotFoundError,
          'an id nobody issued must not be withdrawable',
        );

        const theirs = await service.createGrant(actorId, otherOrganizationId, {
          subjectUserId,
          resourceType,
          resourceId: RECORD,
          permission: 'organization:update',
        });

        // The same error, and that is the assertion: an implementation that said
        // "not yours" here would confirm the id exists, and trying ids in turn
        // would map another tenant's exceptions.
        await expect.rejects(
          () => service.revokeGrant(actorId, organizationId, theirs.id),
          GrantNotFoundError,
          'and a grant of another organization must be as absent as one never issued',
        );

        // It must still be there afterwards — a refusal that deleted it would be
        // the worse failure, and every assertion above passes while it does.
        const theirPage = await service.listGrants(actorId, otherOrganizationId, EVERYTHING);
        expect.equal(
          grantIn(theirPage, theirs.id),
          true,
          'and the refusal must leave that organization\'s grant where it was',
        );
      });
    });
  });
}
