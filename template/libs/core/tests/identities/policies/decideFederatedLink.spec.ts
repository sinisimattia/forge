import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider, FederatedLinkOutcome } from '__FORGE_SCOPE__/core/identities/enums';
import { decideFederatedLink } from '__FORGE_SCOPE__/core/identities/policies';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

const ACTOR = 'user-ada' as UserId;
const OUTSIDER = 'user-outsider' as UserId;

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

describe('decideFederatedLink', () => {
  it('links when nothing holds the subject', () => {
    const decision = decideFederatedLink({
      actorUserId: ACTOR,
      linkedIdentity: null,
    });

    expect(decision).toEqual({ outcome: FederatedLinkOutcome.LINK });
  });

  it('treats linking again as a no-op when the actor already holds the subject', () => {
    const decision = decideFederatedLink({
      actorUserId: ACTOR,
      linkedIdentity: linked(ACTOR),
    });

    expect(decision).toEqual({
      outcome: FederatedLinkOutcome.ALREADY_LINKED_TO_ACTOR,
      identityId: 'identity-1',
    });
  });

  it('refuses, without disclosing whose, when somebody else holds the subject', () => {
    const decision = decideFederatedLink({
      actorUserId: ACTOR,
      linkedIdentity: linked(OUTSIDER),
    });

    expect(decision).toEqual({ outcome: FederatedLinkOutcome.LINKED_TO_ANOTHER_ACCOUNT });
    // Stated as its own assertion because it is the property, not a detail of
    // the shape: unlike REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT, this outcome is
    // returned to the actor who asked, so it must never carry whose account it is.
    expect(decision).not.toHaveProperty('userId');
  });
});
