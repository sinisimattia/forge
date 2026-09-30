import type { MfaMethodId } from './MfaMethodId';

/**
 * Proof that the caller controls a second factor already on file, offered
 * for an action that is not itself completing an enrollment — removing a
 * method or regenerating recovery codes.
 *
 * A discriminated union on **field presence**, never a single string an
 * implementation has to sniff apart to tell a code from a recovery code.
 * An earlier phase modelled this as one string field and inferred which
 * kind it was from its shape — a check a well-formed input of the wrong
 * kind could still pass. A field name cannot be fooled that way: a caller
 * states which proof it is offering by which field it populates, and
 * `'methodId' in proof` (or the type checker, statically) is the whole of
 * how an implementation tells the branches apart.
 */
export type MfaProof
  = | {
    /** The confirmed method this code was generated against. */
    readonly methodId: MfaMethodId;
    /** The time-based code produced for that method right now. */
    readonly code: string;
  }
  | {
    /** One of the account's own unused recovery codes. */
    readonly recoveryCode: string;
  };
