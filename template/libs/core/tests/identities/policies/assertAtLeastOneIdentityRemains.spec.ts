import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import {
  IdentityNotFoundError,
  LastIdentityRemovalError,
} from '__FORGE_SCOPE__/core/identities/errors';
import { assertAtLeastOneIdentityRemains } from '__FORGE_SCOPE__/core/identities/policies';
import { makeAuthIdentityJSON } from '__FORGE_SCOPE__/core/identities/testing';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';

function identity(id: string): AuthIdentity {
  return AuthIdentity.fromJSON(makeAuthIdentityJSON({ id: id as AuthIdentityId }));
}

const FIRST = 'identity-1' as AuthIdentityId;
const SECOND = 'identity-2' as AuthIdentityId;
const ABSENT = 'identity-9' as AuthIdentityId;

describe('assertAtLeastOneIdentityRemains', () => {
  it('returns normally when two identities exist and one is being removed', () => {
    expect(() => assertAtLeastOneIdentityRemains(
      [identity(FIRST), identity(SECOND)],
      FIRST,
    )).not.toThrow();
  });

  it('throws IdentityNotFoundError when the id is not among the identities', () => {
    expect(() => assertAtLeastOneIdentityRemains(
      [identity(FIRST), identity(SECOND)],
      ABSENT,
    )).toThrow(IdentityNotFoundError);
  });

  it('throws LastIdentityRemovalError when the list holds exactly that one identity', () => {
    expect(() => assertAtLeastOneIdentityRemains([identity(FIRST)], FIRST))
      .toThrow(LastIdentityRemovalError);
  });

  // Not-found wins, and it has to. An empty list contains nothing, so the id
  // being removed is not in it, and "this identity is not yours" is the honest
  // answer; LastIdentityRemovalError would claim the caller owned something it
  // never did, and would tell a caller holding a guessed id that the id exists.
  it('throws IdentityNotFoundError, not LastIdentityRemovalError, for an empty list', () => {
    expect(() => assertAtLeastOneIdentityRemains([], FIRST)).toThrow(IdentityNotFoundError);
    expect(() => assertAtLeastOneIdentityRemains([], FIRST)).not.toThrow(LastIdentityRemovalError);
  });
});
