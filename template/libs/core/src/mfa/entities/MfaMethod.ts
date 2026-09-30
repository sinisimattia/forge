import type { UserId } from '../../users/types/UserId';
import { MfaLabelRequiredError } from '../errors/MfaLabelRequiredError';
import type { MfaMethodType } from '../enums/MfaMethodType';
import type { MfaMethodId } from '../types/MfaMethodId';
import type { MfaMethodJSON } from '../types/MfaMethodJSON';
import type { MfaMethodProps } from '../types/MfaMethodProps';

/**
 * One second factor a particular user has enrolled.
 *
 * Holds nothing that could be used to produce a valid proof: no shared
 * secret, no public key, no signature counter. A TOTP method and a WebAuthn
 * method are proven by entirely different math against entirely different
 * material, and neither kind of material is something this entity needs in
 * order to say what it says — that a method of a given kind exists for a
 * user, carries the label they gave it, and has or has not yet been
 * confirmed. That material stays with whatever owns the store, beside the
 * record it belongs to, and never becomes a field here. A method can
 * therefore be listed, shown to the person who enrolled it, or logged, in
 * full, without ever being the thing that lets somebody else pass as its
 * owner — there is no field for that to leak.
 */
export class MfaMethod {
  /** The method's identifier. */
  readonly id: MfaMethodId;
  /** The person this method belongs to. */
  readonly userId: UserId;
  /** Which kind of second factor this is. */
  readonly type: MfaMethodType;
  /** The name the person gave this method, so they can tell it apart from another of the same kind. */
  readonly label: string;
  /** When the method was enrolled. */
  readonly createdAt: Date;
  /** When enrollment was completed by a successful proof, or `null` if it never was. */
  readonly confirmedAt: Date | null;
  /** When this method was last used successfully, or `null` if never. */
  readonly lastUsedAt: Date | null;

  /**
   * @param props - the seven facts that make up a method
   * @throws MfaLabelRequiredError when the label is absent or only whitespace
   */
  constructor(props: MfaMethodProps) {
    const label = props.label.trim();
    if (label === '') throw new MfaLabelRequiredError();

    this.id = props.id;
    this.userId = props.userId;
    this.type = props.type;
    this.label = label;
    this.createdAt = props.createdAt;
    this.confirmedAt = props.confirmedAt;
    this.lastUsedAt = props.lastUsedAt;
  }

  /** Whether enrollment was completed by a successful proof. */
  isConfirmed(): boolean {
    return this.confirmedAt !== null;
  }

  /** The wire shape: instants as ISO-8601 strings. */
  toJSON(): MfaMethodJSON {
    return {
      id: this.id,
      userId: this.userId,
      type: this.type,
      label: this.label,
      createdAt: this.createdAt.toISOString(),
      confirmedAt: this.confirmedAt?.toISOString() ?? null,
      lastUsedAt: this.lastUsedAt?.toISOString() ?? null,
    };
  }

  /**
   * Rebuilds a method from its wire shape, re-running every invariant.
   *
   * @param json - a method as it crosses a serialization boundary
   * @returns the same method as a real entity, instants revived
   */
  static fromJSON(json: MfaMethodJSON): MfaMethod {
    return new MfaMethod({
      id: json.id,
      userId: json.userId,
      type: json.type,
      label: json.label,
      createdAt: new Date(json.createdAt),
      confirmedAt: json.confirmedAt === null ? null : new Date(json.confirmedAt),
      lastUsedAt: json.lastUsedAt === null ? null : new Date(json.lastUsedAt),
    });
  }
}
