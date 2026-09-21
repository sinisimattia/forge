import { describe, it, expect } from 'vitest';
import { API_ERROR_CODES } from '../api';

/**
 * Half of the cross-check that keeps this webapp's copy of the wire vocabulary
 * honest against a *rename*. The other half is
 * `apps/backend/src/common/filters/__tests__/http-exception.filter.spec.ts`,
 * which pins the same names against the backend's own table.
 *
 * ## Why a literal list and not something cleverer
 *
 * The two apps share no package a wire error code could live in: it is transport
 * vocabulary, so `libs/core` may not hold it (ADR-0008), and there is nothing
 * else between them. So the vocabulary is written twice, and the only thing that
 * can make a *rename* drift visible without inventing a third package is a
 * literal on each side that somebody has to come and change.
 *
 * ## What it costs to leave this out, measured — twice now
 *
 * Renaming `TOKEN_CONSUMED` to `TOKEN_SPENT` in all three webapp files that name
 * it left **96 of 96 tests green** while the backend went on emitting
 * `TOKEN_CONSUMED` — so `AuthHttpService.verifyEmail` would have stopped raising
 * `ConsumedTokenError` in production and nothing would have said so. The reason
 * is the same species of tautology the conformance drivers are written to avoid,
 * one level up: `stubBackend` emits the strings these services switch on, so the
 * webapp stayed perfectly consistent with itself and wrong about the world.
 *
 * **This test does not catch the backend adding a code and this list staying
 * silent — that is a different failure, and it already happened once.**
 * `API_ERROR_CODES` fell eleven codes behind `DOMAIN_ERROR_CODES` across Tasks
 * 10–14 (the organization, membership, invitation and grant codes), and this
 * exact test stayed green throughout: an eleven-item literal here compared
 * itself to an eleven-item literal, equal to itself, while the backend's own
 * table — which derives its list rather than typing it out — grew to
 * twenty-two. `API_ERROR_CODES`'s own TSDoc says what is and is not checked
 * as a result, and it is worth reading before trusting this test to mean more
 * than it does.
 *
 * This test's subject is therefore the *literal*, not the type. Asserting that
 * `API_ERROR_CODES` matches the `ApiErrorCode` union would be unfailable — the
 * union is derived from it.
 */
describe('the wire vocabulary this webapp expects', () => {
  // Written out rather than computed, because a computed expectation would move
  // with the value it is checking. Renaming a code turns this red, and the
  // person who fixes it is sent to the backend's table by the comment above.
  // A rename is what this catches — see this file's own header for what a
  // silent *addition* on the backend's side would not turn red here.
  it('is exactly the snapshot this webapp was last told about', () => {
    expect([...API_ERROR_CODES]).toEqual([
      'ALREADY_A_MEMBER',
      'CROSS_TENANT_GRANT',
      'DISPLAY_NAME_REQUIRED',
      'EMAIL_ALREADY_REGISTERED',
      'GRANT_NOT_FOUND',
      'IDENTITY_ALREADY_LINKED',
      'IDENTITY_NOT_FOUND',
      'INVALID_CREDENTIALS',
      'INVALID_ORGANIZATION_SLUG',
      'INVITATION_ADDRESS_MISMATCH',
      'INVITATION_NO_LONGER_OPEN',
      'INVITATION_NOT_FOUND',
      'LAST_IDENTITY_REMOVAL',
      'LAST_OWNER',
      'MEMBERSHIP_NOT_FOUND',
      'ORGANIZATION_NAME_REQUIRED',
      'ORGANIZATION_NOT_FOUND',
      'SERIALIZATION_CONFLICT',
      'SESSION_NOT_FOUND',
      'TOKEN_CONSUMED',
      'TOKEN_EXPIRED',
      'USER_NOT_FOUND',
      'WEAK_PASSWORD',
    ]);
  });

  // Sorted, so that the two lists can be compared by eye across two repositories'
  // worth of file, and so that adding a code has one obvious place to put it.
  // Compared with `localeCompare`, not the default comparator, because that is
  // what the backend sorts `DOMAIN_ERROR_CODES` with
  // (`apps/backend/src/common/filters/http-exception.filter.ts`), and the two
  // lists disagree on at least one pair under the default UTF-16 code-unit
  // order (`INVITATION_NO_LONGER_OPEN` vs `INVITATION_NOT_FOUND`) — so a plain
  // `.sort()` here would make this test pass while making the file wrong to
  // eyeball against the backend's.
  it('is sorted the same way the backend sorts its copy', () => {
    expect([...API_ERROR_CODES]).toEqual(
      [...API_ERROR_CODES].sort((left, right) => left.localeCompare(right)),
    );
  });
});
