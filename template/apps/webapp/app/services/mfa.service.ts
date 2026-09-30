import {
  MfaLabelRequiredError,
  MfaReauthenticationRequiredError,
  MfaVerificationFailedError,
  RecoveryCodeAlreadyConsumedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import type { MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import {
  ApiError,
  deleteMfaMethod,
  getMfaMethods,
  postMfaMethods,
  postMfaVerify,
  postRecoveryCodes,
  postTotpConfirm,
  postTotpEnroll,
  postWebAuthnEnrollOptions,
  postWebAuthnEnrollVerify,
  postWebAuthnLoginOptions,
  postWebAuthnLoginVerify,
} from '~/fetchers';
import type {
  ApiClient,
  AuthResponseBody,
  MfaChallengeMethodBody,
  MfaProofBody,
  MfaVerifyProof,
  RecoveryCodesBody,
  TotpConfirmationBody,
  TotpEnrollmentBody,
  WebAuthnEnrollmentBody,
  WebAuthnOptionsResponseBody,
} from '~/types';

/**
 * The core error a signed-in refusal stands for, or the refusal untouched.
 *
 * **Only the signed-in methods go through here.** The login methods above answer
 * one byte-identical `401` and there is nothing to name; these are the actor
 * working on their own methods, and the backend tells them the difference on
 * purpose. `MFA_REAUTHENTICATION_REQUIRED` (`403`, no proof was sent) and a wrong
 * proof (`422`) are different situations with different remedies, and reach the
 * screen under different names.
 */
function signedInErrorFor(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error;
  switch (error.body.code) {
    case 'MFA_REAUTHENTICATION_REQUIRED':
      return new MfaReauthenticationRequiredError();
    case 'MFA_VERIFICATION_FAILED':
      return new MfaVerificationFailedError();
    case 'RECOVERY_CODE_ALREADY_CONSUMED':
      return new RecoveryCodeAlreadyConsumedError();
    case 'MFA_LABEL_REQUIRED':
      return new MfaLabelRequiredError();
    default:
      return error;
  }
}

/** Runs `call`, rethrowing whatever it throws as {@link signedInErrorFor} names it. */
async function named<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw signedInErrorFor(error);
  }
}

/**
 * Finishing a sign-in that the password did not finish.
 *
 * **Not an `IAuthService`, and it does not translate failures.** Every refusal
 * from these routes is one byte-identical `401`, on purpose: the backend
 * records *why* (an unknown challenge, an expired one, a spent one, a wrong
 * code, a method that is not this account's) and returns none of it, so that a
 * caller who has proven only a password cannot use the answers to probe an
 * account. There is nothing here to map a failure onto. An `ApiError` — or a
 * transport fault — is thrown as it came, and the caller shows the one message
 * that covers both.
 *
 * What it does return is the body a successful verification answers with. Turning
 * that into a session — the credential held in memory, the person adopted — is
 * the auth store's, for the reason `AuthHttpService.takeIssuedCredential` gives.
 *
 * ## The other half is a different caller
 *
 * From {@link MfaHttpService.listMethods} on, the methods serve somebody who *has*
 * signed in and is managing their own second factors. Those refusals are named on
 * purpose (see `signedInErrorFor`) — the difference between "you sent no proof"
 * and "your proof was wrong" is the screen's to show — which is the opposite of
 * the login half above, and the two are not to be merged.
 */
export class MfaHttpService {
  private readonly client: ApiClient;

  public constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * Which methods a challenge may be finished with. **Spends nothing**: the
   * challenge is still good for the verification that follows.
   *
   * @throws ApiError with status 401 when the challenge is not one that can be
   * presented, for any reason
   */
  public methods(challengeToken: string): Promise<MfaChallengeMethodBody[]> {
    return postMfaMethods(this.client, challengeToken);
  }

  /**
   * Presents a proof from one of the account's own methods, or a recovery code.
   *
   * @param challengeToken - the token `POST /auth/login` (or the federated
   * redirect) handed out; spent by this request whatever the outcome
   * @param proof - `{ methodId, code }` or `{ recoveryCode }`
   * @throws ApiError with status 401 for every way this can be refused
   */
  public verify(challengeToken: string, proof: MfaVerifyProof): Promise<AuthResponseBody> {
    return postMfaVerify(this.client, challengeToken, proof);
  }

  /**
   * Asks for the options to sign a passkey assertion over. Spends `challengeToken`.
   *
   * @throws ApiError with status 401 for every way the login branch refuses, and
   * 404 when the deployment has no WebAuthn configured
   */
  public passkeyOptions(challengeToken: string): Promise<WebAuthnOptionsResponseBody> {
    return postWebAuthnLoginOptions(this.client, challengeToken);
  }

  /**
   * Presents an assertion, which is verified against the account's own passkeys.
   *
   * @param challengeToken - the one `passkeyOptions` answered with, not the one
   * it was given
   * @param assertion - the browser library's JSON assertion, forwarded untouched
   * @throws ApiError with status 401 for every way the login branch refuses
   */
  public verifyPasskey(
    challengeToken: string,
    assertion: Record<string, unknown>,
  ): Promise<AuthResponseBody> {
    return postWebAuthnLoginVerify(this.client, challengeToken, assertion);
  }

  /** The actor's own methods, confirmed and not. Carries no secret material. */
  public listMethods(): Promise<MfaMethodJSON[]> {
    return getMfaMethods(this.client);
  }

  /**
   * Offers a new TOTP secret. **The one response that carries it** — the caller
   * shows it and holds it no longer than the panel that does.
   *
   * @throws MfaLabelRequiredError when the label is blank
   */
  public enrollTotp(label: string): Promise<TotpEnrollmentBody> {
    return named(() => postTotpEnroll(this.client, label));
  }

  /**
   * Finishes a TOTP enrollment.
   *
   * @returns the recovery batch on the account's first confirmation, `null` after
   * @throws MfaVerificationFailedError when the code is wrong
   */
  public confirmTotp(methodId: string, code: string): Promise<TotpConfirmationBody> {
    return named(() => postTotpConfirm(this.client, methodId, code));
  }

  /**
   * Registers a passkey the authenticator produced. Its options come from
   * {@link MfaHttpService.passkeyEnrollmentOptions}.
   *
   * @throws MfaLabelRequiredError when the label is blank
   */
  public enrollPasskey(
    label: string,
    attestation: Record<string, unknown>,
  ): Promise<WebAuthnEnrollmentBody> {
    return named(() => postWebAuthnEnrollVerify(this.client, label, attestation));
  }

  /** The options for enrolling a passkey; carries the session and no challenge. */
  public passkeyEnrollmentOptions(): Promise<WebAuthnOptionsResponseBody> {
    return postWebAuthnEnrollOptions(this.client);
  }

  /**
   * Removes one method.
   *
   * @param proof - `null` sends none, which the backend accepts for every method
   * but the last confirmed one
   * @throws MfaReauthenticationRequiredError when a proof was needed and none was sent
   * @throws MfaVerificationFailedError when the proof was wrong
   * @throws RecoveryCodeAlreadyConsumedError when the recovery code was already used
   */
  public removeMethod(methodId: string, proof: MfaProofBody | null): Promise<void> {
    return named(() => deleteMfaMethod(this.client, methodId, proof));
  }

  /**
   * Replaces the recovery codes. The answer is the only copy in the clear.
   *
   * @throws MfaReauthenticationRequiredError when no proof was sent
   * @throws MfaVerificationFailedError when the proof was wrong
   */
  public regenerateRecoveryCodes(proof: MfaProofBody | null): Promise<RecoveryCodesBody> {
    return named(() => postRecoveryCodes(this.client, proof));
  }
}
