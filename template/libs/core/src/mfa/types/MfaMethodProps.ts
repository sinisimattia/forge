import type { UserId } from '../../users/types/UserId';
import type { MfaMethodType } from '../enums/MfaMethodType';
import type { MfaMethodId } from './MfaMethodId';

/**
 * Everything needed to construct an {@link MfaMethod}.
 *
 * A named object rather than positional parameters: three of the seven fields
 * are adjacent instants, so a positional constructor makes a silent
 * transposition possible that no compiler can catch.
 *
 * There is no field here for a secret, a public key or a counter — a method
 * models *that* a second factor is enrolled, never the material that proves
 * it.
 */
export interface MfaMethodProps {
  /** The method's identifier. */
  id: MfaMethodId;
  /** The person this method belongs to. */
  userId: UserId;
  /** Which kind of second factor this is. */
  type: MfaMethodType;
  /** The name the person gave this method, so they can tell it apart from another of the same kind. */
  label: string;
  /** When the method was enrolled. */
  createdAt: Date;
  /** When enrollment was completed by a successful proof, or `null` if it never was. */
  confirmedAt: Date | null;
  /** When this method was last used successfully, or `null` if never. */
  lastUsedAt: Date | null;
}
