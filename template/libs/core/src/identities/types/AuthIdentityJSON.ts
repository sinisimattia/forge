import type { UserId } from '../../users/types/UserId';
import type { AuthProvider } from '../enums/AuthProvider';
import type { AuthIdentityId } from './AuthIdentityId';

/**
 * The wire shape of an {@link AuthIdentity}: the same six facts, with every
 * instant as an ISO-8601 string, because a serialized payload has no `Date`.
 *
 * There is no field here for a derivation, a salt or its parameters, and there
 * never will be — the entity has none to serialize, so no payload built from
 * one can carry one (ADR-0005). The conformance suite asserts this key set
 * exactly, so a field added here is a test failure rather than a leak.
 */
export interface AuthIdentityJSON {
  /** The identity's identifier. */
  id: AuthIdentityId;
  /** The person this identity proves. */
  userId: UserId;
  /** Which kind of proof this is. */
  provider: AuthProvider;
  /** The account identifier in its stable form. */
  providerAccountId: string;
  /** When the identity was linked. */
  createdAt: string;
  /** When this identity was last used successfully, or `null` if never. */
  lastUsedAt: string | null;
}
