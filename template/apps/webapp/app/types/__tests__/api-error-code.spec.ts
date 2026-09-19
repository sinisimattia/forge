import { describe, it, expect } from 'vitest';
import { API_ERROR_CODES } from '../api';

/**
 * Half of the cross-check that keeps this webapp's copy of the wire vocabulary
 * honest. The other half is
 * `apps/backend/src/common/filters/__tests__/http-exception.filter.spec.ts`,
 * which pins the same eleven names against the backend's own table.
 *
 * ## Why a literal list and not something cleverer
 *
 * The two apps share no package a wire error code could live in: it is transport
 * vocabulary, so `libs/core` may not hold it (ADR-0008), and there is nothing
 * else between them. So the vocabulary is written twice, and the only thing that
 * can make a drift visible without inventing a third package is a literal on each
 * side that somebody has to come and change.
 *
 * ## What it costs to leave this out, measured
 *
 * Renaming `TOKEN_CONSUMED` to `TOKEN_SPENT` in all three webapp files that name
 * it left **96 of 96 tests green** while the backend went on emitting
 * `TOKEN_CONSUMED` — so `AuthHttpService.verifyEmail` would have stopped raising
 * `ConsumedTokenError` in production and nothing would have said so. The reason
 * is the same species of tautology the conformance drivers are written to avoid,
 * one level up: `stubBackend` emits the strings these services switch on, so the
 * webapp stayed perfectly consistent with itself and wrong about the world.
 *
 * This test's subject is therefore the *literal*, not the type. Asserting that
 * `API_ERROR_CODES` matches the `ApiErrorCode` union would be unfailable — the
 * union is derived from it.
 */
describe('the wire vocabulary this webapp expects', () => {
  // Written out rather than computed, because a computed expectation would move
  // with the value it is checking. Renaming a code turns this red, and the
  // person who fixes it is sent to the backend's table by the comment above.
  it('is exactly the list the backend emits', () => {
    expect([...API_ERROR_CODES]).toEqual([
      'DISPLAY_NAME_REQUIRED',
      'EMAIL_ALREADY_REGISTERED',
      'IDENTITY_ALREADY_LINKED',
      'IDENTITY_NOT_FOUND',
      'INVALID_CREDENTIALS',
      'LAST_IDENTITY_REMOVAL',
      'SESSION_NOT_FOUND',
      'TOKEN_CONSUMED',
      'TOKEN_EXPIRED',
      'USER_NOT_FOUND',
      'WEAK_PASSWORD',
    ]);
  });

  // Sorted, so that the two lists can be compared by eye across two repositories'
  // worth of file, and so that adding a code has one obvious place to put it.
  it('is sorted, so the two copies read the same way', () => {
    expect([...API_ERROR_CODES]).toEqual([...API_ERROR_CODES].sort());
  });
});
