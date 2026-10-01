import {
  MfaReauthenticationRequiredError,
  TooManyMfaMethodsError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import {
  currentCodeFor,
  makeMfaWorld,
  type MfaWorld,
} from '../../common/testing';
import { MfaMethodRecord } from '../entities/mfa-method-record.entity';
import { MAX_MFA_METHODS } from '../mfa-limits';

/**
 * The most methods one account may hold, enforced where a method comes into
 * being.
 *
 * ## What the bound is made of
 *
 * Every row counts, confirmed or not: an abandoned enrollment is a row, and a
 * caller holding only a session can write them without ever confirming one.
 * `counts unconfirmed methods toward the bound` is the test that fails if the
 * count is narrowed to confirmed methods.
 *
 * ## It must not make the first factor impossible
 *
 * The check is made over the methods an account holds when a new one is about
 * to be written, so an account holding none is never refused, and confirming a
 * method that already exists adds no row and is never refused by it.
 * `still confirms an enrollment begun before the bound was reached` is the
 * control against a bound that was put on confirmation instead.
 */
describe('the bound on an account\'s methods', () => {
  let world: MfaWorld;

  beforeEach(async () => {
    world = await makeMfaWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  const rowsOf = (userId: string): MfaMethodRecord[] =>
    (world.source.all(MfaMethodRecord) as unknown as MfaMethodRecord[])
      .filter((row) => row.userId === userId);

  it('refuses enrollment past the bound', async () => {
    const user = await world.seedUserWithoutMfa();
    for (let i = 0; i < MAX_MFA_METHODS; i += 1) {
      await world.mfa.beginTotpEnrollment(user.userId, `k${i}`);
    }

    await expect(world.mfa.beginTotpEnrollment(user.userId, 'one too many')).rejects.toBeInstanceOf(
      TooManyMfaMethodsError,
    );
    expect(rowsOf(user.userId)).toHaveLength(MAX_MFA_METHODS);
  });

  it('counts unconfirmed methods toward the bound', async () => {
    // Abandoned enrollments are rows too, and an attacker who only needs a
    // session can create them without ever confirming one.
    const user = await world.seedUserWithoutMfa();
    for (let i = 0; i < MAX_MFA_METHODS; i += 1) {
      await world.mfa.beginTotpEnrollment(user.userId, `k${i}`);
    }
    expect(rowsOf(user.userId).every((row) => row.confirmedAt === null)).toBe(true);

    await expect(world.mfa.beginTotpEnrollment(user.userId, 'another')).rejects.toBeInstanceOf(
      TooManyMfaMethodsError,
    );
  });

  it('counts confirmed methods toward the bound too', async () => {
    const user = await world.seedUserWithConfirmedTotp();
    for (let i = 1; i < MAX_MFA_METHODS; i += 1) {
      await world.mfa.beginTotpEnrollment(user.userId, `k${i}`);
    }

    await expect(world.mfa.beginTotpEnrollment(user.userId, 'another')).rejects.toBeInstanceOf(
      TooManyMfaMethodsError,
    );
  });

  it('still enrols the first factor of an account holding none', async () => {
    const user = await world.seedUserWithoutMfa();
    const offer = await world.mfa.beginTotpEnrollment(user.userId, 'Phone');

    const batch = await world.mfa.confirmTotpEnrollment(
      user.userId,
      offer.methodId,
      currentCodeFor(offer.secret),
      null,
    );

    expect(batch).not.toBeNull();
  });

  it('still confirms an enrollment begun before the bound was reached', async () => {
    const user = await world.seedUserWithoutMfa();
    const first = await world.mfa.beginTotpEnrollment(user.userId, 'k0');
    for (let i = 1; i < MAX_MFA_METHODS; i += 1) {
      await world.mfa.beginTotpEnrollment(user.userId, `k${i}`);
    }

    // At the bound, with nothing confirmed: confirming adds no row, and an
    // account's first factor is owed no proof.
    await expect(
      world.mfa.confirmTotpEnrollment(
        user.userId,
        first.methodId,
        currentCodeFor(first.secret),
        null,
      ),
    ).resolves.not.toBeNull();
  });

  it('is not answered as a missing proof, whichever of the two applies', async () => {
    // An account at the bound that also owes a proof to confirm anything: the
    // refusal to enrol is the bound's, and the refusal to confirm is the
    // proof's, and neither stands in for the other.
    const user = await world.seedUserWithConfirmedTotp();
    const pending = await world.mfa.beginTotpEnrollment(user.userId, 'k1');
    for (let i = 2; i < MAX_MFA_METHODS; i += 1) {
      await world.mfa.beginTotpEnrollment(user.userId, `k${i}`);
    }

    await expect(world.mfa.beginTotpEnrollment(user.userId, 'another')).rejects.toBeInstanceOf(
      TooManyMfaMethodsError,
    );
    await expect(
      world.mfa.confirmTotpEnrollment(
        user.userId,
        pending.methodId,
        currentCodeFor(pending.secret),
        null,
      ),
    ).rejects.toBeInstanceOf(MfaReauthenticationRequiredError);
  });

  it('holds when enrollments begin concurrently', async () => {
    const user = await world.seedUserWithoutMfa();

    const results = await Promise.allSettled(
      Array.from({ length: MAX_MFA_METHODS + 4 }, (_, i) =>
        world.mfa.beginTotpEnrollment(user.userId, `k${i}`)),
    );

    expect(rowsOf(user.userId)).toHaveLength(MAX_MFA_METHODS);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(4);
  });
});
