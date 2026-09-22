import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider, FederatedSignInOutcome } from '__FORGE_SCOPE__/core/identities/enums';
import { decideFederatedSignIn } from '__FORGE_SCOPE__/core/identities/policies';
import type { AuthIdentityId, FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

const ADA = 'user-ada' as UserId;
const OUTSIDER = 'user-outsider' as UserId;

function account(overrides: Partial<FederatedAccount> = {}): FederatedAccount {
  return {
    provider: AuthProvider.GOOGLE,
    subject: '117392044118',
    email: 'ada@example.test',
    emailVerified: true,
    displayName: 'Ada',
    ...overrides,
  };
}

function linked(userId: UserId): AuthIdentity {
  return new AuthIdentity({
    id: 'identity-1' as AuthIdentityId,
    userId,
    provider: AuthProvider.GOOGLE,
    providerAccountId: '117392044118',
    createdAt: new Date('2026-09-01T09:00:00.000Z'),
    lastUsedAt: null,
  });
}

describe('decideFederatedSignIn', () => {
  it('signs in the account the subject is already linked to', () => {
    const decision = decideFederatedSignIn({
      account: account(),
      linkedIdentity: linked(ADA),
      userWithMatchingEmail: null,
    });

    expect(decision).toEqual({
      outcome: FederatedSignInOutcome.SIGN_IN_EXISTING,
      userId: ADA,
      identityId: 'identity-1',
    });
  });

  it('signs in a linked subject even when the provider has stopped asserting a verified address', () => {
    // The link was established under these rules; the subject is the proof, not
    // the address. A provider that changes what it discloses must not lock
    // somebody out of an account they already hold.
    const decision = decideFederatedSignIn({
      account: account({ email: null, emailVerified: false }),
      linkedIdentity: linked(ADA),
      userWithMatchingEmail: null,
    });

    expect(decision.outcome).toBe(FederatedSignInOutcome.SIGN_IN_EXISTING);
  });

  it('refuses an unlinked subject whose address the provider has not verified', () => {
    const decision = decideFederatedSignIn({
      account: account({ emailVerified: false }),
      linkedIdentity: null,
      // Deliberately present: an unverified address must be refused BEFORE it is
      // compared with anything, so this account is never reached.
      userWithMatchingEmail: { id: ADA },
    });

    expect(decision).toEqual({ outcome: FederatedSignInOutcome.REFUSE_UNVERIFIED_EMAIL });
  });

  it('refuses an unlinked subject whose address the provider did not supply at all', () => {
    const decision = decideFederatedSignIn({
      account: account({ email: null, emailVerified: true }),
      linkedIdentity: null,
      userWithMatchingEmail: null,
    });

    expect(decision).toEqual({ outcome: FederatedSignInOutcome.REFUSE_UNVERIFIED_EMAIL });
  });

  it('refuses an unlinked subject whose provider-verified "address" is not shaped like one', () => {
    // `emailVerified: true` is the provider's own claim about a string, not a
    // guarantee the string is an address — a self-hosted OIDC issuer whose
    // `email` claim is a bare username, or a misconfigured development
    // provider, can assert this. Nothing downstream of PROVISION_NEW
    // re-validates the shape, so it has to be refused here.
    const decision = decideFederatedSignIn({
      account: account({ email: 'devuser', emailVerified: true }),
      linkedIdentity: null,
      userWithMatchingEmail: null,
    });

    expect(decision).toEqual({ outcome: FederatedSignInOutcome.REFUSE_UNVERIFIED_EMAIL });
  });

  // ─── D11 ───────────────────────────────────────────────────────────────────
  it('refuses, and does NOT link, when a verified address belongs to an existing account', () => {
    const decision = decideFederatedSignIn({
      account: account(),
      linkedIdentity: null,
      userWithMatchingEmail: { id: OUTSIDER },
    });

    expect(decision).toEqual({
      outcome: FederatedSignInOutcome.REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT,
      existingUserId: OUTSIDER,
    });
  });

  // The property above the shape: not "this one input refuses", but "no input
  // shaped like this ever signs in". Kept as its own table-driven case, over a
  // setup none of the other cases use, so it reds independently of the D11
  // `toEqual` rather than behind it — a `toEqual` on a specific shape and a
  // property quantified over several inputs fail for different reasons, and a
  // suite that only ever exercises the first has not actually tested the
  // second, however it reads.
  it.each<[string, Partial<FederatedAccount>, { readonly id: UserId } | null]>([
    ['a verified address matching an existing account', {}, { id: OUTSIDER }],
    ['a verified address matching nobody', {}, null],
    ['an unverified address', { emailVerified: false }, null],
    ['an absent address', { email: null }, null],
    ['a verified value not shaped like an address', { email: 'devuser' }, null],
  ])('never signs in an unlinked subject — %s', (_description, accountOverrides, userWithMatchingEmail) => {
    const decision = decideFederatedSignIn({
      account: account(accountOverrides),
      linkedIdentity: null,
      userWithMatchingEmail,
    });

    expect(decision.outcome).not.toBe(FederatedSignInOutcome.SIGN_IN_EXISTING);
  });

  it('provisions a new account for a verified address nobody holds', () => {
    const decision = decideFederatedSignIn({
      account: account({ email: 'Ada@Example.test' }),
      linkedIdentity: null,
      userWithMatchingEmail: null,
    });

    expect(decision).toEqual({
      outcome: FederatedSignInOutcome.PROVISION_NEW,
      // Normal form, so the account created here and an account registered by
      // password at the same address are the same address.
      email: 'ada@example.test',
      displayName: 'Ada',
    });
  });
});
