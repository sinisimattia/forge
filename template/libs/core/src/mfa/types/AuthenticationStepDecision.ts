import type { MfaMethod } from '../entities/MfaMethod';
import type { MfaStep } from '../enums/MfaStep';

/**
 * What {@link decideAuthenticationStep} decided, and what the caller needs in
 * order to act on it. One member per {@link MfaStep}, each carrying only what
 * that ending needs.
 */
export type AuthenticationStepDecision
  = | {
    /** Discriminant: nothing further is required; a session may be issued. */
    readonly step: MfaStep.ISSUE_SESSION;
  }
  | {
    /** Discriminant: credentials were proven, and are not enough on their own. */
    readonly step: MfaStep.REQUIRE_SECOND_FACTOR;
    /** The methods a client may offer, already narrowed to ones that can be used. */
    readonly methods: readonly MfaMethod[];
  };
