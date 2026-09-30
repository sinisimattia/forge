import type { UserId } from '../../users/types/UserId';
import type { MfaMethodType } from '../enums/MfaMethodType';
import type { MfaMethodId } from './MfaMethodId';

/**
 * The wire shape of an {@link MfaMethod}: the same seven facts, with every
 * instant as an ISO-8601 string, because a serialized payload has no `Date`.
 *
 * There is no field here for a secret, a public key or a counter, and there
 * never will be — the entity has none to serialize, so no payload built from
 * one can carry one. The conformance suite asserts this key set exactly, so a
 * field added here is a test failure rather than a leak.
 */
export interface MfaMethodJSON {
  /** The method's identifier. */
  id: MfaMethodId;
  /** The person this method belongs to. */
  userId: UserId;
  /** Which kind of second factor this is. */
  type: MfaMethodType;
  /** The name the person gave this method. */
  label: string;
  /** When the method was enrolled. */
  createdAt: string;
  /** When enrollment was completed by a successful proof, or `null` if it never was. */
  confirmedAt: string | null;
  /** When this method was last used successfully, or `null` if never. */
  lastUsedAt: string | null;
}
