import type { UserId } from '../../users/types/UserId';
import type { AuthProvider } from '../enums/AuthProvider';
import type { AuthIdentityId } from './AuthIdentityId';

/**
 * Everything needed to construct an {@link AuthIdentity}.
 *
 * A named object rather than positional parameters: two of the six fields are
 * adjacent strings and two are adjacent instants, so a positional constructor
 * makes a silent transposition possible that no compiler can catch.
 *
 * There is no field here for a derivation, a salt or its parameters — an
 * identity models *which* proof exists, never the proof itself (ADR-0005).
 */
export interface AuthIdentityProps {
  /** The identity's identifier. */
  id: AuthIdentityId;
  /** The person this identity proves. */
  userId: UserId;
  /** Which kind of proof this is. */
  provider: AuthProvider;
  /** The account identifier as given; the entity stores its stable form. */
  providerAccountId: string;
  /** When the identity was linked. */
  createdAt: Date;
  /** When this identity was last used successfully, or `null` if never. */
  lastUsedAt: Date | null;
}
