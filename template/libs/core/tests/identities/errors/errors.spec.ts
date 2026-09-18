import {
  IdentityAccountIdRequiredError,
  IdentityAlreadyLinkedError,
  IdentityNotFoundError,
  LastIdentityRemovalError,
  WeakPasswordError,
} from '__FORGE_SCOPE__/core/identities/errors';
import { DomainError } from '__FORGE_SCOPE__/core/shared/errors';

const CASES: ReadonlyArray<[string, DomainError, string]> = [
  [
    'IdentityAccountIdRequiredError',
    new IdentityAccountIdRequiredError('GOOGLE'),
    'A GOOGLE identity needs an account identifier.',
  ],
  [
    'IdentityAlreadyLinkedError',
    new IdentityAlreadyLinkedError('GOOGLE', 'subject-90210'),
    'The GOOGLE account "subject-90210" is already linked.',
  ],
  [
    'IdentityNotFoundError',
    new IdentityNotFoundError('identity-9'),
    'No identity with id "identity-9".',
  ],
  [
    'LastIdentityRemovalError',
    new LastIdentityRemovalError(),
    'Removing that identity would leave the account with no way in.',
  ],
  [
    'WeakPasswordError',
    new WeakPasswordError(['TOO_SHORT', 'NEEDS_DIGIT']),
    'The proposed phrase does not meet the policy: TOO_SHORT, NEEDS_DIGIT.',
  ],
];

describe('identities errors', () => {
  it.each(CASES)('%s extends DomainError, so a caller can catch broadly', (_name, error) => {
    expect(error).toBeInstanceOf(DomainError);
  });

  it.each(CASES)('%s reports its own name, not the base name', (name, error) => {
    expect(error.name).toBe(name);
  });

  it.each(CASES)('%s carries its message', (_name, error, message) => {
    expect(error.message).toBe(message);
  });

  // The list is what a caller shows a person, so it has to survive the throw.
  it('WeakPasswordError keeps the violations it was raised for', () => {
    expect(new WeakPasswordError(['TOO_LONG']).violations).toEqual(['TOO_LONG']);
  });
});
