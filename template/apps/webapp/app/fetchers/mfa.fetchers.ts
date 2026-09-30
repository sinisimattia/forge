import type { MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import type {
  ApiClient,
  AuthResponseBody,
  MfaProofBody,
  RecoveryCodesBody,
  TotpConfirmationBody,
  TotpEnrollmentBody,
  WebAuthnEnrollmentBody,
  WebAuthnOptionsResponseBody,
} from '~/types';

/**
 * The `/mfa` endpoints, one function apiece, in two halves for two callers.
 *
 * The first two serve somebody who has not finished signing in: the login half
 * of the passkey ceremony, carrying a challenge and no session. The rest, from
 * {@link getMfaMethods} down, serve somebody who has and is managing their own
 * methods: they carry a session and no challenge (see the note above it).
 *
 * **The two login functions carry the challenge token in the body and no session credential.** The
 * backend refuses a request presenting both, and a caller who has not signed in
 * has only the one to present — the transport attaches no `Authorization` here
 * because the store holds no access credential while a challenge is pending.
 */

/**
 * Asks for the options to hand to `navigator.credentials.get`.
 *
 * **Spends `challengeToken`.** What comes back carries a new one, and that is
 * the one to present to {@link postWebAuthnLoginVerify}.
 */
export async function postWebAuthnLoginOptions(
  client: ApiClient,
  challengeToken: string,
): Promise<WebAuthnOptionsResponseBody> {
  return client<WebAuthnOptionsResponseBody>({
    method: 'POST',
    path: '/mfa/webauthn/options',
    body: { challengeToken },
    withCookie: true,
  });
}

/**
 * Presents the authenticator's assertion and, if it verifies, opens the session.
 *
 * @param response - the library's JSON assertion, forwarded as it came
 */
export async function postWebAuthnLoginVerify(
  client: ApiClient,
  challengeToken: string,
  response: Record<string, unknown>,
): Promise<AuthResponseBody> {
  return client<AuthResponseBody>({
    method: 'POST',
    path: '/mfa/webauthn/verify',
    body: { challengeToken, response },
    withCookie: true,
  });
}

/*
 * The signed-in half.
 *
 * Every function below is issued on the authenticated client and carries the
 * session and never a challenge; `POST /mfa/webauthn/*` serves both callers
 * and decides which one this is from the credential it received, and a request
 * carrying both is refused. Nothing here sets `withCookie`, for the reason the
 * login pair above does the opposite — the renewal cookie belongs to the auth
 * paths.
 */

/** The actor's methods, confirmed and not. Carries no secret material. */
export async function getMfaMethods(client: ApiClient): Promise<MfaMethodJSON[]> {
  return client<MfaMethodJSON[]>({ method: 'GET', path: '/mfa/methods' });
}

/**
 * Offers a new TOTP secret under `label`. **The answer is the only place the
 * secret is ever returned.**
 */
export async function postTotpEnroll(
  client: ApiClient,
  label: string,
): Promise<TotpEnrollmentBody> {
  return client<TotpEnrollmentBody>({ method: 'POST', path: '/mfa/totp/enroll', body: { label } });
}

/** Finishes a TOTP enrollment. `recoveryCodes` is non-null only on the account's first. */
export async function postTotpConfirm(
  client: ApiClient,
  methodId: string,
  code: string,
): Promise<TotpConfirmationBody> {
  return client<TotpConfirmationBody>({
    method: 'POST',
    path: '/mfa/totp/confirm',
    body: { methodId, code },
  });
}

/** Removes one method. `proof` is required for the last confirmed one. */
export async function deleteMfaMethod(
  client: ApiClient,
  methodId: string,
  proof: MfaProofBody | null,
): Promise<void> {
  await client<undefined>({
    method: 'DELETE',
    path: `/mfa/${encodeURIComponent(methodId)}`,
    ...(proof === null ? {} : { body: proof }),
  });
}

/** Replaces the recovery codes with a fresh batch. Always needs a proof. */
export async function postRecoveryCodes(
  client: ApiClient,
  proof: MfaProofBody | null,
): Promise<RecoveryCodesBody> {
  return client<RecoveryCodesBody>({
    method: 'POST',
    path: '/mfa/recovery-codes',
    body: proof ?? {},
  });
}

/** The options for enrolling a passkey. `challengeToken` is `null` for this caller. */
export async function postWebAuthnEnrollOptions(
  client: ApiClient,
): Promise<WebAuthnOptionsResponseBody> {
  return client<WebAuthnOptionsResponseBody>({
    method: 'POST',
    path: '/mfa/webauthn/options',
    body: {},
  });
}

/** Registers the passkey the authenticator produced under `label`. */
export async function postWebAuthnEnrollVerify(
  client: ApiClient,
  label: string,
  response: Record<string, unknown>,
): Promise<WebAuthnEnrollmentBody> {
  return client<WebAuthnEnrollmentBody>({
    method: 'POST',
    path: '/mfa/webauthn/verify',
    body: { response, label },
  });
}
