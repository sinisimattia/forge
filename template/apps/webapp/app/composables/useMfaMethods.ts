import type { Ref } from 'vue';
import {
  MfaLabelRequiredError,
  MfaReauthenticationRequiredError,
  MfaVerificationFailedError,
  RecoveryCodeAlreadyConsumedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import type { MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import { MfaHttpService } from '~/services';
import { useAuthStore } from '~/stores/auth';
import type { MfaProofBody, TotpEnrollmentBody } from '~/types';

/**
 * Why the proof form is on screen, which decides what it says.
 *
 * - `required` — nothing was sent and the server wants something. Not a fault:
 *   this is the rule working, and the screen explains it.
 * - `wrong` — something was sent and it did not check out, or was a recovery code
 *   already spent. A different situation with a different remedy (try another
 *   code), so a different message.
 */
export type ProofReason = 'required' | 'wrong';

/** What the proof form is being asked for. */
export interface ProofRequest {
  /** The action the proof will unlock. */
  readonly action: 'remove' | 'regenerate';
  /** The method being removed, for `remove`. */
  readonly methodId: string | null;
  /** Why the form is showing. */
  readonly reason: ProofReason;
}

/** The security screen's second-factor state, and what it can do. */
export interface UseMfaMethods {
  /** The actor's own methods. Carry no secret material. Empty until {@link load} resolves. */
  readonly methods: Ref<MfaMethodJSON[]>;
  /** Whether a request is in flight. */
  readonly loading: Ref<boolean>;
  /** Whether the last request failed for a reason the screen has no name for. */
  readonly failed: Ref<boolean>;
  /**
   * An enrollment in progress, or `null`.
   *
   * **Shared-secret material, held in this ref and nowhere else**: not the
   * store, not `useState`, not storage. It is dropped on {@link cancelEnrollment}
   * and on a successful confirmation.
   */
  readonly enrollment: Ref<TotpEnrollmentBody | null>;
  /** Whether the last confirmation code was wrong. */
  readonly wrongCode: Ref<boolean>;
  /** Whether the label the person typed was blank. */
  readonly labelMissing: Ref<boolean>;
  /**
   * Whether the browser's passkey prompt was closed, dismissed or timed out, so
   * nothing was sent. Not a fault, and not the server's refusal: the remedy is to
   * try again, and the screen says that.
   */
  readonly passkeyDismissed: Ref<boolean>;
  /**
   * The recovery codes to show, or `null`.
   *
   * **Shown once.** Set by the confirmation that gives the account its first
   * confirmed method, and by a regeneration; cleared by {@link dismissRecoveryCodes}
   * and by nothing else setting it back. The server holds only digests, so there
   * is no call that could fetch them again — this ref is the only copy there is.
   */
  readonly recoveryCodes: Ref<readonly string[] | null>;
  /** The proof form's request, or `null` when it is not showing. */
  readonly proofRequest: Ref<ProofRequest | null>;
  /** Reads the list again, and clears any earlier failure first. */
  readonly load: () => Promise<void>;
  /** Begins a TOTP enrollment under `label`. */
  readonly beginTotp: (label: string) => Promise<void>;
  /** Finishes it with the code the authenticator now shows. */
  readonly confirmTotp: (code: string) => Promise<void>;
  /** Abandons an enrollment. The method it created stays unconfirmed and gates nothing. */
  readonly cancelEnrollment: () => void;
  /** Enrols a passkey under `label`. */
  readonly enrollPasskey: (label: string) => Promise<void>;
  /** Asks the server to remove `methodId`, presenting `proof` when there is one. */
  readonly remove: (methodId: string, proof?: MfaProofBody) => Promise<void>;
  /** Shows the proof form for a regeneration, which always needs one. */
  readonly beginRegeneration: () => void;
  /** Presents `proof` for whichever action the form is asking about. */
  readonly submitProof: (proof: MfaProofBody) => Promise<void>;
  /** Closes the proof form without doing anything. */
  readonly cancelProof: () => void;
  /** Drops the codes from the screen. There is no way back. */
  readonly dismissRecoveryCodes: () => void;
  /** Whether this browser can enrol a passkey at all. */
  readonly passkeySupported: () => Promise<boolean>;
}

/**
 * The actor's own second factors, as the security screen holds them.
 *
 * **The removal rule is the server's and is not re-implemented here.** Whether
 * a method is the last confirmed one is decided where every method is visible,
 * and a count here could disagree with it. This asks the server to remove the
 * method with no proof; when it answers `MFA_REAUTHENTICATION_REQUIRED` this
 * raises the proof form with the reason `required`, and when it refuses the
 * proof it raises it again with `wrong`. Deleting the composable's handling of
 * the `403` would change what the person sees and nothing about what is allowed
 * — it would leave them with a button that does nothing.
 *
 * @returns the state and the verbs a screen needs
 */
export function useMfaMethods(): UseMfaMethods {
  const store = useAuthStore();
  const methods = ref<MfaMethodJSON[]>([]);
  const loading = ref(false);
  const failed = ref(false);
  const enrollment = ref<TotpEnrollmentBody | null>(null);
  const wrongCode = ref(false);
  const labelMissing = ref(false);
  const passkeyDismissed = ref(false);
  const recoveryCodes = ref<readonly string[] | null>(null);
  const proofRequest = ref<ProofRequest | null>(null);

  const service = (): MfaHttpService => new MfaHttpService(store.authenticatedClient());

  /**
   * Reads the list, and touches `failed` only when the read itself fails.
   *
   * **Every verb ends with this and not with {@link load}.** A verb that failed
   * has just set the flag, and a read that reset it would wipe the only
   * explanation the screen was about to show. The verbs clear the flag when they
   * start, and the two ways of backing out clear it too.
   */
  async function read(): Promise<void> {
    loading.value = true;
    try {
      methods.value = await service().listMethods();
    } catch {
      failed.value = true;
      methods.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function load(): Promise<void> {
    failed.value = false;
    await read();
  }

  /** Takes a batch of codes onto the screen when the answer carried one. */
  function take(codes: readonly string[] | null): void {
    if (codes !== null) recoveryCodes.value = [...codes];
  }

  async function beginTotp(label: string): Promise<void> {
    labelMissing.value = false;
    wrongCode.value = false;
    loading.value = true;
    failed.value = false;
    try {
      enrollment.value = await service().enrollTotp(label);
    } catch (error) {
      if (error instanceof MfaLabelRequiredError) labelMissing.value = true;
      else failed.value = true;
    } finally {
      loading.value = false;
    }
    await read();
  }

  async function confirmTotp(code: string): Promise<void> {
    const offer = enrollment.value;
    if (offer === null) return;
    wrongCode.value = false;
    loading.value = true;
    failed.value = false;
    try {
      const confirmed = await service().confirmTotp(offer.methodId, code);
      enrollment.value = null;
      take(confirmed.recoveryCodes);
    } catch (error) {
      if (error instanceof MfaVerificationFailedError) wrongCode.value = true;
      else failed.value = true;
    } finally {
      loading.value = false;
    }
    await read();
  }

  function cancelEnrollment(): void {
    enrollment.value = null;
    wrongCode.value = false;
    failed.value = false;
    void read();
  }

  async function passkeySupported(): Promise<boolean> {
    try {
      const { browserSupportsWebAuthn } = await import('@simplewebauthn/browser');
      return browserSupportsWebAuthn();
    } catch {
      return false;
    }
  }

  async function enrollPasskey(label: string): Promise<void> {
    labelMissing.value = false;
    passkeyDismissed.value = false;
    loading.value = true;
    failed.value = false;
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const options = await service().passkeyEnrollmentOptions();
      let attestation;
      try {
        attestation = await startRegistration({
          optionsJSON: options.publicKey as Parameters<typeof startRegistration>[0]['optionsJSON'],
        });
      } catch {
        // Only the browser's own ceremony is caught here: a person closing the
        // prompt, a timeout, an authenticator that refused. Nothing was sent, so
        // there is no server answer to tell apart from it.
        passkeyDismissed.value = true;
        return;
      }
      const enrolled = await service().enrollPasskey(
        label,
        attestation as unknown as Record<string, unknown>,
      );
      take(enrolled.recoveryCodes);
    } catch (error) {
      if (error instanceof MfaLabelRequiredError) labelMissing.value = true;
      else failed.value = true;
    } finally {
      loading.value = false;
    }
    await read();
  }

  async function remove(methodId: string, proof?: MfaProofBody): Promise<void> {
    loading.value = true;
    failed.value = false;
    try {
      await service().removeMethod(methodId, proof ?? null);
      proofRequest.value = null;
    } catch (error) {
      const reason = reasonFor(error);
      if (reason === null) failed.value = true;
      else proofRequest.value = { action: 'remove', methodId, reason };
    } finally {
      loading.value = false;
    }
    await read();
  }

  function beginRegeneration(): void {
    proofRequest.value = { action: 'regenerate', methodId: null, reason: 'required' };
  }

  async function regenerate(proof: MfaProofBody): Promise<void> {
    loading.value = true;
    failed.value = false;
    try {
      const fresh = await service().regenerateRecoveryCodes(proof);
      proofRequest.value = null;
      take(fresh.recoveryCodes);
    } catch (error) {
      const reason = reasonFor(error);
      if (reason === null) failed.value = true;
      else proofRequest.value = { action: 'regenerate', methodId: null, reason };
    } finally {
      loading.value = false;
    }
  }

  async function submitProof(proof: MfaProofBody): Promise<void> {
    const request = proofRequest.value;
    if (request === null) return;
    if (request.action === 'regenerate') await regenerate(proof);
    else if (request.methodId !== null) await remove(request.methodId, proof);
  }

  function cancelProof(): void {
    proofRequest.value = null;
    failed.value = false;
  }

  function dismissRecoveryCodes(): void {
    recoveryCodes.value = null;
  }

  return {
    methods,
    loading,
    failed,
    enrollment,
    wrongCode,
    labelMissing,
    passkeyDismissed,
    recoveryCodes,
    proofRequest,
    load,
    beginTotp,
    confirmTotp,
    cancelEnrollment,
    enrollPasskey,
    remove,
    beginRegeneration,
    submitProof,
    cancelProof,
    dismissRecoveryCodes,
    passkeySupported,
  };
}

/**
 * Which of the proof form's two messages a refusal calls for, or `null` when it
 * is neither and the screen has no name for it.
 *
 * A spent recovery code is a wrong proof as far as the person can act on it:
 * the remedy is the same, another code.
 */
function reasonFor(error: unknown): ProofReason | null {
  if (error instanceof MfaReauthenticationRequiredError) return 'required';
  if (error instanceof MfaVerificationFailedError) return 'wrong';
  if (error instanceof RecoveryCodeAlreadyConsumedError) return 'wrong';
  return null;
}
