import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isGrantLive } from '__FORGE_SCOPE__/core/authorization/policies';
import type { Principal } from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { MembershipRecord } from '../organizations/membership-record.entity';
import { UserRecord } from '../users/user-record.entity';
import { ResourceGrantRecord } from './resource-grant-record.entity';
import { toGrantEntity } from './to-grant';

/**
 * Reads the three facts an access decision is allowed to know about whoever is
 * asking, and assembles them into the `Principal` that `can` evaluates.
 *
 * It decides nothing. `can` is the one decision (ADR-0006); this is the one
 * place its input is established, and the division matters in both directions —
 * a hydrator that refused a request would be a second statement of the rules,
 * and a decision that looked a fact up would stop being the pure function both
 * sides of the wire can evaluate.
 *
 * ## Everything comes from the row, nothing from the credential
 *
 * The access credential carries two claims — `userId` and `sessionId` — and
 * that is deliberate. It is minted once, lives
 * `ACCESS_TOKEN_TTL_SECONDS`, and is **not** re-issued when a role changes, a
 * membership ends or a grant is withdrawn. A membership copied into it would go
 * on authorizing for the whole of that window after being revoked, which makes
 * "a grant revoked mid-session is denied on the next request" (D12) not merely
 * untested but unsatisfiable by construction. So the subject of the credential
 * is the only thing this service is given, and every other fact is read here,
 * per request. `PlatformAdminGuard` states the same reasoning for the platform
 * role alone; this is that argument applied to all three layers.
 *
 * **Nothing is cached, and nothing may be.** A cache with a lifetime longer
 * than one request re-creates exactly the window the credential was kept thin
 * to avoid.
 *
 * ## This is the only place a grant's expiry is judged
 *
 * `can` does not read `expiresAt`, because reading it needs a clock and a clock
 * would stop the same principal and resource producing the same answer — which
 * is what lets a client predict what the server will say. So `isGrantLive` is
 * the rule, `now` is a parameter, and this method is where it runs.
 * `Principal.grants` means "live as of hydration", and **an expired grant that
 * survives the filter below is honoured by `can` without complaint**. There is
 * no second check anywhere to catch it.
 *
 * ## What it does not filter
 *
 * A soft-deleted account is hydrated like any other, matching
 * `PlatformAdminGuard`, which reads its row the same way. The window is the one
 * `JwtStrategy` documents and bounds: closing an account ends its sessions, so
 * the credential cannot be renewed, and it lapses within
 * `ACCESS_TOKEN_TTL_SECONDS`. A deployment that needs that window closed
 * immediately changes `JwtStrategy.validate`, which is where the question
 * belongs — one lookup on the way in, not a `deletedAt` clause repeated in every
 * reader.
 */
@Injectable()
export class PrincipalService {
  public constructor(
    @InjectRepository(UserRecord)
    private readonly users: Repository<UserRecord>,
    @InjectRepository(MembershipRecord)
    private readonly memberships: Repository<MembershipRecord>,
    @InjectRepository(ResourceGrantRecord)
    private readonly grants: Repository<ResourceGrantRecord>,
  ) {}

  /**
   * Hydrates the principal for `userId`, as of `now`.
   *
   * @param userId - the subject of the presented credential, and nothing else.
   *   Never a route parameter: an id the request names is a claim about what the
   *   request is *about*, and building the asker out of it makes `can` compare
   *   the request against itself.
   * @param now - the instant expiry is judged against, supplied rather than read
   *   here so that a test can state it and `isGrantLive` stays a pure rule
   * @returns the whole input an access decision is allowed to read
   * @throws NotFoundException when no account answers to `userId` — the same
   *   answer `PermissionsGuard` gives for a refusal, on purpose: a credential
   *   whose subject no longer exists learns nothing from being told so
   */
  public async hydrate(userId: UserId, now: Date): Promise<Principal> {
    const row = await this.users.findOne({ where: { id: userId } });
    if (row === null) throw new NotFoundException();

    const memberships = await this.memberships.find({ where: { userId } });
    const grants = await this.grants.find({ where: { subjectUserId: userId } });

    return {
      userId: row.id as UserId,
      // From the row, never from the credential — `PlatformAdminGuard` states
      // the reasoning: the credential is not re-issued when a role changes.
      platformRole: row.platformRole,
      // EVERY membership, not the one for "the current organization". `can`
      // chooses among them by the resource's organization, and narrowing here
      // would re-introduce the ambient tenancy ADR-0007 forbids — and would put
      // the choosing in two places, one of which cannot see the resource.
      memberships: memberships.map((membership) => ({
        organizationId: membership.organizationId as OrganizationId,
        role: membership.role,
      })),
      // The ONLY place the expiry rule runs, in the whole system. An expired
      // grant that survives this filter is honoured by `can` without complaint.
      grants: grants.map(toGrantEntity).filter((grant) => isGrantLive(grant, now)),
    };
  }
}
