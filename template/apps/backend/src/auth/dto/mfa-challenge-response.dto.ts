import type { AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import type { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';

/**
 * One method a client may offer, as a caller who has proven **one** factor is
 * told about it.
 *
 * Three fields, and deliberately **not** `MfaMethod.toJSON()`. That shape also
 * carries `userId`, `createdAt`, `confirmedAt` and `lastUsedAt`, and this is
 * the one response in the application that goes to somebody who has proven a
 * password and nothing else. What such a caller needs is enough to choose a
 * method and label it in a picker; the rest is account history, and account
 * history behind one factor is account history behind one factor.
 *
 * Nothing here could help produce a proof, by construction rather than by
 * care: the shared secret, the public key and the signature counter exist only
 * on `MfaMethodRecord` and never on core's `MfaMethod` at all — see that
 * entity's own TSDoc. There is no field for that to leak through.
 */
export interface MfaChallengeMethodDto {
  /** What to send back as `methodId`. */
  id: string;
  /** Which kind of proof to produce. */
  type: MfaMethodType;
  /** The name the person gave it, so they can tell two of a kind apart. */
  label: string;
}

/**
 * What `POST /auth/login` returns when the password was right and is not
 * enough.
 *
 * **There is no credential of any kind here**, and that is the whole point of
 * the shape existing: no `accessToken`, no `user`, and — the part a response
 * body cannot show — no renewal cookie and no `sessions` row behind it either.
 * `AuthenticationOutcome`'s `MFA_REQUIRED` branch carries nothing to present
 * for the same reason, one layer down.
 *
 * `challengeToken` is not such a credential. It proves only that this server
 * saw a correct password moments ago; it opens nothing on its own, it is spent
 * by the single request that presents it, and it dies in minutes
 * (`MFA_CHALLENGE_TTL_MS`). It is in the body rather than in a cookie because
 * the page that received it is the page that will send it back, in its own
 * `fetch`, and a cookie is the wrong tool for a value one script hands to one
 * request — the opposite of the argument
 * `auth-response.dto.ts` makes for the renewal credential, and the same
 * reasoning applied to a value with the opposite lifetime.
 *
 * `status` is what a client discriminates on. The success shape
 * (`AuthResponseDto`) has no `status` and this has no `accessToken`, so the
 * two are told apart by a discriminant rather than by probing for an absent
 * field — which `d10-mfa-challenge-only.spec.ts` then asserts really is
 * absent.
 */
export interface MfaChallengeResponseDto {
  /** Fixed: `MFA_REQUIRED`. The discriminant against {@link AuthResponseDto}. */
  status: AuthenticationStatus.MFA_REQUIRED;
  /** What to present at `POST /auth/mfa/verify`, once, within minutes. */
  challengeToken: string;
  /** The confirmed methods this account may finish the attempt with. */
  methods: MfaChallengeMethodDto[];
}
