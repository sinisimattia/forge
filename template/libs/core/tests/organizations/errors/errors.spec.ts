import { DomainError } from '__FORGE_SCOPE__/core/shared/errors';
import {
  AlreadyAMemberError,
  InvalidOrganizationSlugError,
  InvitationAddressMismatchError,
  InvitationNoLongerOpenError,
  InvitationNotFoundError,
  LastOwnerError,
  MembershipNotFoundError,
  OrganizationNameRequiredError,
  OrganizationNotFoundError,
} from '__FORGE_SCOPE__/core/organizations/errors';

const CASES: ReadonlyArray<[string, DomainError, string]> = [
  [
    'AlreadyAMemberError',
    new AlreadyAMemberError('org-1', 'user-1'),
    'User "user-1" is already a member of organization "org-1".',
  ],
  [
    'InvalidOrganizationSlugError',
    new InvalidOrganizationSlugError('ACME'),
    '"ACME" is not a usable organization slug.',
  ],
  [
    'InvitationAddressMismatchError',
    new InvitationAddressMismatchError('invitation-9'),
    'Invitation "invitation-9" was not addressed to this account.',
  ],
  [
    'InvitationNoLongerOpenError',
    new InvitationNoLongerOpenError('invitation-9'),
    'Invitation "invitation-9" is no longer open.',
  ],
  [
    'InvitationNotFoundError',
    new InvitationNotFoundError('invitation-9'),
    'No invitation with id "invitation-9".',
  ],
  [
    'LastOwnerError',
    new LastOwnerError(),
    'An organization must always have at least one OWNER.',
  ],
  [
    'MembershipNotFoundError',
    new MembershipNotFoundError('membership-9'),
    'No membership with id "membership-9".',
  ],
  [
    'OrganizationNameRequiredError',
    new OrganizationNameRequiredError(),
    'An organization name is required.',
  ],
  [
    'OrganizationNotFoundError',
    new OrganizationNotFoundError('org-9'),
    'No organization with id "org-9".',
  ],
];

describe('organizations errors', () => {
  it.each(CASES)('%s extends DomainError, so a caller can catch broadly', (_name, error) => {
    expect(error).toBeInstanceOf(DomainError);
  });

  it.each(CASES)('%s reports its own name, not the base name', (name, error) => {
    expect(error.name).toBe(name);
  });

  it.each(CASES)('%s carries its message', (_name, error, message) => {
    expect(error.message).toBe(message);
  });
});
