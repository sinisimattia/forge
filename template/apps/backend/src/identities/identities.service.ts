import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { IIdentityService } from '__FORGE_SCOPE__/core/identities/contracts';
import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { assertAtLeastOneIdentityRemains } from '__FORGE_SCOPE__/core/identities/policies';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import { normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditService } from '../audit/audit.service';
import { AuthIdentityRecord } from './auth-identity-record.entity';
import { PASSWORD_HASHER, type IPasswordHasher, type StoredSecret } from './hashing';

/**
 * Everything that happens to an `auth_identities` row, including the three
 * columns core deliberately does not model (ADR-0005).
 *
 * It exists as its own service rather than as private methods on `AuthService`
 * because the row-to-{@link StoredSecret} mapping below is the one place in this
 * backend where a nullable, untyped `jsonb` column becomes a typed value, and
 * `IPasswordHasher`'s own documentation is explicit that the mapper owes two
 * decisions nobody else can make for it. A decision that lives in one named
 * place can be read; the same decision spread over three call sites is made
 * differently at each.
 */
@Injectable()
export class IdentitiesService implements IIdentityService {
  public constructor(
    @InjectRepository(AuthIdentityRecord)
    private readonly identities: Repository<AuthIdentityRecord>,
    @Inject(PASSWORD_HASHER)
    private readonly hasher: IPasswordHasher,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ IIdentityService

  /**
   * The actor's own identities, as domain entities. There is no path to another
   * user's: `actorId` is the filter, not a thing to check afterwards.
   *
   * @param actorId - the user on whose behalf the call is made
   * @returns every identity the actor currently holds
   */
  public async listIdentities(actorId: UserId): Promise<AuthIdentity[]> {
    const rows = await this.identities.find({ where: { userId: actorId } });
    return rows.map((row) => IdentitiesService.toEntity(row));
  }

  /**
   * Removes one of the actor's identities.
   *
   * **The rule is core's and is not restated here.**
   * `assertAtLeastOneIdentityRemains` decides both refusals and decides them in
   * the order core documents — not-found before last-one — so that a refusal
   * never names a ground that was not the real one. A count query written here
   * instead would be a second copy of a rule, and a second copy is one that can
   * diverge from the webapp's answer to the same question.
   *
   * The whole list is loaded to ask it. That is the cost of expressing the rule
   * as a pure function over the identities themselves rather than as a
   * `COUNT(*)`, and it is a small one: nobody holds many ways of proving who
   * they are.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param identityId - the identity to remove
   * @throws LastIdentityRemovalError if it is the only one they have
   * @throws IdentityNotFoundError if it is not theirs — indistinguishable from
   *   not existing, so the call cannot be used to probe for other people's ids
   */
  public async unlinkIdentity(actorId: UserId, identityId: AuthIdentityId): Promise<void> {
    const held = await this.listIdentities(actorId);
    assertAtLeastOneIdentityRemains(held, identityId);

    const removed = held.find((identity) => identity.id === identityId);
    await this.identities.delete({ id: identityId, userId: actorId });
    await this.audit.record({
      organizationId: null,
      actorId,
      action: AuditAction.IDENTITY_UNLINKED,
      resourceType: 'auth_identity',
      resourceId: identityId,
      // The provider, never the account identifier it names: for a password
      // identity that identifier is the person's address, and an address written
      // into a table nothing may correct is an address that cannot later be
      // forgotten on request.
      metadata: { provider: removed?.provider ?? null },
      clientAddress: null,
      clientLabel: null,
      occurredAt: new Date(),
    });
  }

  // ------------------------------------------------------- this backend's own

  /**
   * The password identity for an address, or `null`.
   *
   * The address is normalized here rather than by the caller, because the
   * uniqueness this lookup relies on is uniqueness of the *normal form* — the
   * column stores it and the unique constraint is on the stored value
   * (`IdentityFoundation1758000001000`). A caller that passed the raw form would
   * silently miss an account whose address differs only by case.
   *
   * @param email - the address as the person typed it
   * @returns the row, or `null` when no password identity answers to it
   */
  public findPasswordIdentity(email: string): Promise<AuthIdentityRecord | null> {
    return this.identities.findOne({
      where: { provider: AuthProvider.PASSWORD, providerAccountId: normalizeEmail(email) },
    });
  }

  /**
   * The password identity belonging to a user, or `null`.
   *
   * Looked up by owner rather than by address, for the callers that have already
   * established who they are dealing with — changing a secret, completing a
   * reset — and so must not depend on the address the person happens to have
   * typed this time.
   *
   * @param userId - the account whose password identity is wanted
   * @returns the row, or `null` when the account has no password identity
   */
  public findPasswordIdentityByUser(userId: UserId): Promise<AuthIdentityRecord | null> {
    return this.identities.findOne({
      where: { userId, provider: AuthProvider.PASSWORD },
    });
  }

  /**
   * Creates the password identity for a new account.
   *
   * @param manager - the transaction the user row was created in, so an identity
   *   and the user it proves are never two separately-committed facts
   * @param userId - the account this identity proves
   * @param email - the address, as the person typed it
   * @param secret - the password they chose
   */
  public async createPasswordIdentity(
    manager: EntityManager,
    userId: UserId,
    email: string,
    secret: string,
  ): Promise<void> {
    const stored = await this.hasher.hash(secret);
    await manager.insert(AuthIdentityRecord, {
      userId,
      provider: AuthProvider.PASSWORD,
      providerAccountId: normalizeEmail(email),
      createdAt: new Date(),
      lastUsedAt: null,
      secretHash: stored.hash,
      secretAlgorithm: stored.algorithm,
      secretParams: stored.params,
    });
  }

  /**
   * Whether `secret` reproduces the value stored on `row`.
   *
   * A row with no stored secret answers `false` rather than throwing: a
   * federated identity has three null columns by design, and this method is
   * reachable with no credentials, where an exception and a rejection are
   * distinguishable by whoever is probing.
   *
   * @param row - the identity being proven
   * @param secret - the password offered, in the clear
   * @returns whether the two agree
   */
  public async verifySecret(row: AuthIdentityRecord, secret: string): Promise<boolean> {
    const stored = IdentitiesService.toStoredSecret(row);
    if (stored === null) return false;
    return this.hasher.verify(secret, stored);
  }

  /**
   * Spends a derivation against a value that belongs to nobody.
   *
   * Called when no identity answers to an address, so that an unknown address
   * costs the same as a known one. See `AuthService.authenticate` for why that
   * matters and what removing it would reopen.
   *
   * @param secret - the password offered, so the work done is a function of the
   *   same input a real verification would have had
   */
  public async spendVerificationOnNobody(secret: string): Promise<void> {
    await this.hasher.verify(secret, DUMMY_STORED_SECRET);
  }

  /**
   * Re-derives and stores `secret` when the stored value was produced under
   * parameters weaker than the ones in force now.
   *
   * Called after a successful verification and nowhere else — this is the only
   * moment the password is in hand and known to be correct, so it is the only
   * moment the upgrade is possible at all.
   *
   * @param row - the identity that has just been proven
   * @param secret - the password that proved it
   * @returns whether a new derivation was written
   */
  public async rehashIfNeeded(row: AuthIdentityRecord, secret: string): Promise<boolean> {
    const stored = IdentitiesService.toStoredSecret(row);
    if (stored === null || !this.hasher.needsRehash(stored)) return false;

    const replacement = await this.hasher.hash(secret);
    await this.identities.update(
      { id: row.id },
      {
        secretHash: replacement.hash,
        secretAlgorithm: replacement.algorithm,
        secretParams: replacement.params,
      },
    );
    return true;
  }

  /**
   * Replaces the stored secret on an identity, wherever the replacement came
   * from — a reset, or a deliberate change.
   *
   * @param identityId - the identity whose secret is being replaced
   * @param secret - the new password
   */
  public async replaceSecret(identityId: string, secret: string): Promise<void> {
    const stored = await this.hasher.hash(secret);
    await this.identities.update(
      { id: identityId },
      {
        secretHash: stored.hash,
        secretAlgorithm: stored.algorithm,
        secretParams: stored.params,
      },
    );
  }

  /** Records that an identity was used successfully. */
  public async markUsed(identityId: string, at: Date): Promise<void> {
    await this.identities.update({ id: identityId }, { lastUsedAt: at });
  }

  /**
   * The mapper `IPasswordHasher`'s documentation calls for, making the two
   * decisions it says cannot be made there.
   *
   * **Decision one: what a row with null columns means.** It means there is no
   * stored secret to verify, which is not the same as a secret that fails to
   * verify — so this returns `null` and the caller decides. Every federated
   * identity is this case by design.
   *
   * **Decision two: what a `secret_params` value that is not a number means.**
   * The column is `jsonb` and nothing in the database constrains it, so a value
   * that is not a number is a row this application did not write, or wrote under
   * an implementation that has since changed. Such a key is dropped rather than
   * coerced: `needsRehash` treats a missing parameter as "weaker than current"
   * and re-derives, which is the safe direction. Coercing it — `Number(value)`,
   * yielding `NaN` — would compare false against every threshold and leave the
   * row unupgraded forever, which is the same silence this mapper exists to
   * avoid.
   */
  /**
   * Row to entity, asserting the two branded ids in one visible line.
   *
   * The three secret columns have no counterpart on the entity and are dropped
   * here — structurally, not by omission: `AuthIdentityProps` has no field they
   * could go in (ADR-0005), so a serialized identity cannot carry a derivation
   * however carelessly this mapper is edited.
   */
  private static toEntity(row: AuthIdentityRecord): AuthIdentity {
    return new AuthIdentity({
      id: row.id as AuthIdentityId,
      userId: row.userId as UserId,
      provider: row.provider,
      providerAccountId: row.providerAccountId,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    });
  }

  private static toStoredSecret(row: AuthIdentityRecord): StoredSecret | null {
    if (row.secretHash === null || row.secretAlgorithm === null) return null;

    const params: Record<string, number> = {};
    for (const [name, value] of Object.entries(row.secretParams ?? {})) {
      if (typeof value === 'number') params[name] = value;
    }

    return { hash: row.secretHash, algorithm: row.secretAlgorithm, params };
  }
}

/**
 * A derivation of a value nobody holds, verified against when no identity
 * answers to an address.
 *
 * It is a real argon2id encoding at the parameters in force, produced once and
 * pasted here, so that verifying against it costs exactly what verifying against
 * a real row costs. It is not a credential and could not be used as one: no
 * `auth_identities` row carries it, so there is nothing it opens, and the
 * password it was derived from was discarded at the moment it was generated.
 *
 * Written as a literal rather than derived at start-up on purpose. Deriving it
 * would cost a real derivation on every boot, and — worse — would make the
 * process's start-up time depend on the same parameters this is meant to keep
 * constant. Regenerating it is only necessary if the cost parameters change, and
 * `Argon2PasswordHasher`'s own suite is what notices that.
 */
export const DUMMY_STORED_SECRET: StoredSecret = {
  hash: '$argon2id$v=19$m=19456,t=2,p=1$USDfq888GEVlIHiq1LAnaQ$zSTkqILubPCrx0rkpyOjCs018tAwGK/xY2ddLZi83ik',
  algorithm: 'argon2id',
  params: { memoryCost: 19456, timeCost: 2, parallelism: 1 },
};
