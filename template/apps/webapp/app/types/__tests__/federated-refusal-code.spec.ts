import { describe, it, expect } from 'vitest';
import { FEDERATED_REFUSAL_CODES } from '../api';

/**
 * The literal snapshot of `FederatedRefusalCode`
 * (`apps/backend/src/auth/oauth/oauth.service.ts`), pinned the same way
 * `types/__tests__/api-error-code.spec.ts` pins `API_ERROR_CODES` — see
 * `FEDERATED_REFUSAL_CODES`'s own TSDoc for why this is a *second* snapshot
 * and not a second copy of the same one.
 *
 * ## The comparator, and what this particular seven cannot prove
 *
 * A past sort-comparator mismatch in `API_ERROR_CODES` went undetected this
 * exact way: it was sorted with a bare `.sort()` instead of `.localeCompare()`.
 * The two disagree on `INVITATION_NO_LONGER_OPEN` vs `INVITATION_NOT_FOUND`,
 * and the sortedness check passed anyway because it used a different
 * comparator from the backend's — it compared the (wrongly sorted) array to
 * itself, sorted the same wrong way.
 *
 * This file uses `.localeCompare()` for the same reason — consistency with the
 * one convention that already caused a real defect — but a check on *this*
 * particular set of seven strings cannot repeat that specific catch: run
 * against every adjacent pair below, `.localeCompare()` and the default
 * code-unit `.sort()` produce the identical order. There is no pair among
 * these seven where an underscore sits where a bare sort and a locale-aware
 * one would rank it differently. That was verified directly (`node -e`,
 * comparing `[...codes].sort()` against `[...codes].sort((a,b) =>
 * a.localeCompare(b))`) rather than assumed from the `API_ERROR_CODES`
 * precedent.
 *
 * So what the second test below proves is real — the array is written in
 * sorted order, and reordering it turns the test red — but it does not prove
 * the comparator choice specifically, the way `api-error-code.spec.ts`'s twin
 * does. `.localeCompare()` is still the right default: the day an eighth code
 * is added, it may be exactly the pair that disagrees, and writing the
 * comparator out consistently now is what makes that day's check mean
 * something.
 */
describe('the federated refusal vocabulary this webapp expects', () => {
  it('is exactly the snapshot this webapp was last told about', () => {
    expect([...FEDERATED_REFUSAL_CODES]).toEqual([
      'ACCOUNT_UNAVAILABLE',
      'AUTHORIZATION_EXPIRED',
      'AUTHORIZATION_UNKNOWN',
      'EMAIL_ALREADY_REGISTERED',
      'EMAIL_UNVERIFIED',
      'IDENTITY_ALREADY_LINKED',
      'PROVIDER_UNAVAILABLE',
    ]);
  });

  it('names each code once', () => {
    expect(new Set(FEDERATED_REFUSAL_CODES).size).toBe(FEDERATED_REFUSAL_CODES.length);
  });

  // Sorted with the same comparator `API_ERROR_CODES`'s own sortedness check
  // uses — see this file's own header for what this particular seven can and
  // cannot prove about that choice.
  it('is sorted with localeCompare', () => {
    expect([...FEDERATED_REFUSAL_CODES]).toEqual(
      [...FEDERATED_REFUSAL_CODES].sort((left, right) => left.localeCompare(right)),
    );
  });
});
