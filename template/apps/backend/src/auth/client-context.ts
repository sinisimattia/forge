import type { Request } from 'express';
import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';

/**
 * What could be told about where a request came from.
 *
 * Both values are recorded and neither is ever trusted for a decision — they
 * exist so the person who owns a session can recognize it in a list, and so an
 * audit entry says something about where an attempt came from. The address is
 * taken from Express's own `req.ip`, which honours the `trust proxy` setting;
 * behind a proxy that is not configured it is the proxy's address, which is
 * wrong but harmless, whereas reading `X-Forwarded-For` directly would take a
 * value the client itself chose.
 *
 * Extracted from `AuthController`'s own private `clientOf` when `OAuthController`
 * became the second caller (Task 12): a second hand-written copy is a second
 * place for the two to disagree about what counts as "where this came from,"
 * and the label's 200-character bound in particular is a decision worth making
 * once.
 */
export function clientContextOf(request: Request): ClientContext {
  const label = request.get('user-agent');
  return {
    address: request.ip ?? null,
    // Bounded, because it is stored: a header is whatever its sender made it,
    // and an unbounded one is a way to write as much as you like into a table.
    label: label === undefined ? null : label.slice(0, 200),
  };
}
