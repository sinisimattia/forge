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
  /**
   * The action the proof will unlock. `confirmTotp` and `enrollPasskey` are the
   * two ways a factor is added to an account that already holds one.
   */
  readonly action: 'remove' | 'regenerate' | 'confirmTotp' | 'enrollPasskey';
  /** The method being removed, for `remove`. */
  readonly methodId: string | null;
  /** Why the form is showing. */
  readonly reason: ProofReason;
}

/** The security screen's second-factor state, and what it can do. */
export interface UseMfaMethods {
  /** The actor's own methods. Carry no secret material. Empty until {@link load} resolves. */
  readonly methods: Ref<MfaMethodJSON[]>;
  /**
   * How many recovery codes the account has left to spend, or `null` until a
   * read has answered. `null` means *not known* and `0` means *none left*: the
   * two are different facts and the screen treats them differently.
   */
  readonly recoveryCodesRemaining: Ref<number | null>;
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
   * Whether a passkey ceremony was spent without registering it, so the person
   * has to touch their key again. Not a fault: the proof that went with it was
   * refused after the server had already used up the ceremony.
   */
  readonly passkeyRestart: Ref<boolean>;
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
  /**
   * Finishes it with the code the authenticator now shows. An account that
   * already holds a confirmed method is asked for a proof first, through
   * {@link proofRequest}; `proof` is that proof, on the retry.
   */
  readonly confirmTotp: (code: string, proof?: MfaProofBody) => Promise<void>;
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
 * **Adding a factor follows the same pattern, and the rule is the server's here
 * too.** Confirming a method on an account that already has one costs a proof of
 * it, for either way in — an authenticator app or a passkey. The client does not
 * decide who is owed one: it sends none, and a `MFA_REAUTHENTICATION_REQUIRED`
 * raises the proof form, so an account's first factor, which the server admits
 * free, is never asked. What the person already did is held until the proof
 * arrives — the typed code for an app, and for a passkey the attestation the
 * authenticator produced, so the key is touched once and not again. They are held
 * in this closure and dropped on success, on backing out, and on cancelling the
 * enrollment.
 *
 * **What a retry survives depends on where the server refused.** A *missing*
 * proof is refused before the passkey ceremony's challenge is spent, so the held
 * attestation is still good and is sent again with the proof. Every refusal
 * *after* a proof was sent — a wrong one, a spent recovery code, an attestation
 * that did not verify — comes after the challenge was spent, so that attestation
 * can never succeed and is dropped: the person is told to touch the key again
 * ({@link UseMfaMethods.passkeyRestart}). An authenticator app's held code has no
 * such limit; it is simply stale after a minute or so.
 *
 * @returns the state and the verbs a screen needs
 */
export function useMfaMethods(): UseMfaMethods {
  const store = useAuthStore();
  const methods = ref<MfaMethodJSON[]>([]);
  const recoveryCodesRemaining = ref<number | null>(null);
  const loading = ref(false);
  const failed = ref(false);
  const enrollment = ref<TotpEnrollmentBody | null>(null);
  const wrongCode = ref(false);
  const labelMissing = ref(false);
  const passkeyDismissed = ref(false);
  const passkeyRestart = ref(false);
  const recoveryCodes = ref<readonly string[] | null>(null);
  const proofRequest = ref<ProofRequest | null>(null);
  /** The code typed for the enrollment a proof is being asked about. Never exposed. */
  let heldCode: string | null = null;
  /** The passkey ceremony a proof is being asked about, already performed. Never exposed. */
  let heldPasskey: { readonly label: string; readonly attestation: Record<string, unknown> } | null
    = null;

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
      const listed = await service().listMethods();
      methods.value = listed.methods;
      recoveryCodesRemaining.value = listed.recoveryCodesRemaining;
    } catch {
      failed.value = true;
      methods.value = [];
      recoveryCodesRemaining.value = null;
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

  async function confirmTotp(code: string, proof?: MfaProofBody): Promise<void> {
    const offer = enrollment.value;
    if (offer === null) return;
    wrongCode.value = false;
    loading.value = true;
    failed.value = false;
    try {
      const confirmed = await service().confirmTotp(offer.methodId, code, proof ?? null);
      enrollment.value = null;
      heldCode = null;
      proofRequest.value = null;
      take(confirmed.recoveryCodes);
    } catch (error) {
      const reason = enrollmentProofReason(error, proof !== undefined);
      if (reason !== null) {
        heldCode = code;
        proofRequest.value = { action: 'confirmTotp', methodId: null, reason };
      } else if (error instanceof MfaVerificationFailedError) wrongCode.value = true;
      else failed.value = true;
    } finally {
      loading.value = false;
    }
    await read();
  }

  function cancelEnrollment(): void {
    enrollment.value = null;
    heldCode = null;
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
    passkeyRestart.value = false;
    loading.value = true;
    failed.value = false;
    let attestation: Record<string, unknown>;
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const options = await service().passkeyEnrollmentOptions();
      try {
        attestation = await startRegistration({
          optionsJSON: options.publicKey as Parameters<typeof startRegistration>[0]['optionsJSON'],
        }) as unknown as Record<string, unknown>;
      } catch {
        // Only the browser's own ceremony is caught here: a person closing the
        // prompt, a timeout, an authenticator that refused. Nothing was sent, so
        // there is no server answer to tell apart from it.
        passkeyDismissed.value = true;
        loading.value = false;
        return;
      }
    } catch {
      failed.value = true;
      loading.value = false;
      await read();
      return;
    }
    await registerPasskey(label, attestation, undefined);
  }

  /**
   * Sends a performed ceremony to the server, with a proof when there is one.
   * Split from {@link enrollPasskey} so that a proof asked for afterwards can be
   * sent with the *same* attestation — but only after a **missing** proof, which
   * the server refuses before it spends the ceremony's challenge. Once a proof
   * was sent, the refusals that concern it — a wrong proof, a spent recovery
   * code, a missing-proof answer found again under the lock, an attestation that
   * did not verify — come after the challenge is spent: the attestation is dead,
   * is dropped, and the person is asked to touch the key again. A refusal with no
   * name the screen knows (a conflict, a refusal with no code, a server fault) is
   * not one of those: it shows the generic failure and leaves the form as it was.
   */
  async function registerPasskey(
    label: string,
    attestation: Record<string, unknown>,
    proof: MfaProofBody | undefined,
  ): Promise<void> {
    loading.value = true;
    failed.value = false;
    try {
      const enrolled = await service().enrollPasskey(label, attestation, proof ?? null);
      heldPasskey = null;
      proofRequest.value = null;
      take(enrolled.recoveryCodes);
    } catch (error) {
      const reason = enrollmentProofReason(error, proof !== undefined);
      if (reason !== null && proof === undefined) {
        heldPasskey = { label, attestation };
        proofRequest.value = { action: 'enrollPasskey', methodId: null, reason };
      } else if (reason !== null) {
        heldPasskey = null;
        proofRequest.value = null;
        passkeyRestart.value = true;
      } else if (error instanceof MfaLabelRequiredError) labelMissing.value = true;
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
    // The count changed with the batch, so it is read again like after every
    // other verb. Without this the screen would go on warning about codes that
    // were retired the moment the new ones were issued.
    await read();
  }

  async function submitProof(proof: MfaProofBody): Promise<void> {
    const request = proofRequest.value;
    if (request === null) return;
    if (request.action === 'regenerate') await regenerate(proof);
    else if (request.action === 'confirmTotp') {
      if (heldCode !== null) await confirmTotp(heldCode, proof);
    } else if (request.action === 'enrollPasskey') {
      if (heldPasskey !== null) {
        await registerPasskey(heldPasskey.label, heldPasskey.attestation, proof);
      }
    } else if (request.methodId !== null) await remove(request.methodId, proof);
  }

  function cancelProof(): void {
    proofRequest.value = null;
    // Backing out of a passkey drops the ceremony; backing out of an app's proof
    // returns to the enrollment panel, which still holds its offer.
    heldPasskey = null;
    heldCode = null;
    failed.value = false;
  }

  function dismissRecoveryCodes(): void {
    recoveryCodes.value = null;
  }

  return {
    methods,
    recoveryCodesRemaining,
    loading,
    failed,
    enrollment,
    wrongCode,
    labelMissing,
    passkeyDismissed,
    passkeyRestart,
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

/**
 * Which proof-form message a refusal of an *enrollment* calls for, or `null`
 * when the screen has no proof to ask about.
 *
 * Narrower than {@link reasonFor}, because the confirm routes answer one error
 * for two different faults: `MFA_VERIFICATION_FAILED` means the new method's own
 * code was wrong, or the proof was. With no proof sent it can only be the code,
 * which the enrollment panel reports itself; once a proof was sent it is
 * reported as the proof, and the person can back out to the panel to retype the
 * code.
 */
function enrollmentProofReason(error: unknown, proofSent: boolean): ProofReason | null {
  if (error instanceof MfaReauthenticationRequiredError) return 'required';
  return proofSent ? reasonFor(error) : null;
}
