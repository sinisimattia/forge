import type { MfaMethod } from '../../mfa/entities/MfaMethod';
import type { User } from '../../users/entities/User';
import type { Session } from '../entities/Session';
import type { AuthenticationRejectionReason } from '../enums/AuthenticationRejectionReason';
import type { AuthenticationStatus } from '../enums/AuthenticationStatus';

/**
 * The result of an authentication attempt.
 *
 * A discriminated union rather than a boolean or a credential, because the set
 * of ways an attempt can end is going to grow — a deployment that requires a
 * second factor introduces an outcome that is neither success nor failure but
 * "not yet". Adding a member here makes every `switch` that does not handle it
 * a compile error, which is precisely the property that makes that change
 * cheap. Every consumer ends its `switch` with `assertNever`. It happened:
 * `MFA_REQUIRED` is that outcome, below.
 *
 * Note what is absent: no credential of any kind, on any branch, including
 * `MFA_REQUIRED`'s. An implementation that also has to hand a caller something
 * to present later — a credential to return with a second factor, same as one
 * to return with a session — carries that beside this shape and takes it out
 * before returning; the domain never learns it existed. And `reason` lives
 * only on the rejected branch, which is why it can be recorded without being
 * returned — see {@link AuthenticationRejectionReason}.
 */
export type AuthenticationOutcome
  = | {
    /** Discriminant: the attempt succeeded. */
    readonly status: AuthenticationStatus.AUTHENTICATED;
    /** Who was proven. */
    readonly user: User;
    /** The session that now exists for them. */
    readonly session: Session;
  }
  | {
    /** Discriminant: the attempt failed. */
    readonly status: AuthenticationStatus.REJECTED;
    /** For the audit record. Never shown to whoever made the attempt. */
    readonly reason: AuthenticationRejectionReason;
  }
  | {
    /** Discriminant: credentials were proven; a second factor is owed. */
    readonly status: AuthenticationStatus.MFA_REQUIRED;
    /** Who was proven, but not yet signed in. */
    readonly user: User;
    /** The second factors this user may complete the attempt with. */
    readonly methods: readonly MfaMethod[];
  };
