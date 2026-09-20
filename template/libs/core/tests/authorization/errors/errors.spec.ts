import {
  CrossTenantGrantError,
  GrantNotFoundError,
} from '__FORGE_SCOPE__/core/authorization/errors';
import { DomainError } from '__FORGE_SCOPE__/core/shared/errors';

const CASES: ReadonlyArray<[string, DomainError, string]> = [
  [
    'CrossTenantGrantError',
    new CrossTenantGrantError('org-1', 'user-1'),
    'User "user-1" is not a member of organization "org-1", '
    + 'so no grant can be issued to them in it.',
  ],
  [
    'GrantNotFoundError',
    new GrantNotFoundError('grant-9'),
    'No grant with id "grant-9".',
  ],
];

describe('authorization errors', () => {
  // The class name is the identifier a caller matches on — these errors carry no
  // `code` — so `name` being the class name is a fact worth pinning rather than
  // a detail of `Error`.
  it.each(CASES)('%s is a DomainError naming itself', (name, error) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error.name).toBe(name);
  });

  // The message reaches an operator reading a log, so it names the ids the
  // refusal was about rather than restating the rule in the abstract.
  it.each(CASES)('%s says what it was about', (_name, error, message) => {
    expect(error.message).toBe(message);
  });
});
