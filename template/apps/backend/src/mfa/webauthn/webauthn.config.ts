/** What a WebAuthn ceremony needs to know about this deployment. */
export interface WebAuthnConfig {
  /** The relying-party ID: the registrable domain credentials are scoped to. */
  rpId: string;
  /** The name an authenticator shows for this deployment. */
  rpName: string;
  /** The one origin a ceremony's client data must have been produced on. */
  origin: string;
}

/** Injection token for the built {@link WebAuthnConfig}, `null` when WebAuthn is absent. */
export const WEBAUTHN_CONFIG = Symbol('WEBAUTHN_CONFIG');

/** The environment as `process.env` presents it. */
export type WebAuthnEnv = Readonly<Record<string, string | undefined>>;

/**
 * `MFA_WEBAUTHN_ENABLED` is a boolean, and is read by explicit comparison, never
 * by truthiness. A raw string read makes every value except the empty one truthy,
 * so `MFA_WEBAUTHN_ENABLED=false` would enable it — `OAUTH_DEV_ENABLED` shipped
 * with exactly that defect once (see `oauth.config.ts`).
 *
 * Unset or empty is off. `'true'` and `'1'` are on; `'false'` and `'0'` are off.
 * Anything else is **refused at start-up**, in the same spirit as
 * `OAUTH_DEV_ENABLED` (which is stricter still: it accepts only `1`, `true` and empty, so it
 * throws on `false` and `0`, where this parser models them as off), and for a stronger
 * reason than consistency: the two flags fail dangerously in
 * opposite directions. The development provider is dangerous when wrongly on.
 * This flag is dangerous when wrongly *off* — an operator who writes `yes` and
 * silently gets no WebAuthn believes a second factor is available that is not,
 * with no error and no log line to say so. A spelling this parser does not
 * model is a configuration to notice and fix, not one to guess about.
 */
function isEnabled(env: WebAuthnEnv): boolean {
  const raw = env.MFA_WEBAUTHN_ENABLED;
  if (raw === undefined || raw === '' || raw === 'false' || raw === '0') return false;
  if (raw === 'true' || raw === '1') return true;
  throw new Error(
    `MFA_WEBAUTHN_ENABLED is set to "${raw}", which is not one of "true", "1", "false" or "0". `
    + 'This deployment refuses to boot rather than guess: reading an unrecognised value as off '
    + 'would leave you believing a second factor is available that is not. Set it to "true" to '
    + 'enable WebAuthn, or to "false" (or unset it) to run without.',
  );
}

function present(env: WebAuthnEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * WebAuthn's configuration, decided once at start-up, or `null` when this
 * deployment has none.
 *
 * `null` means WebAuthn is **absent**, not degraded: nothing downstream
 * registers a passkey method for a deployment that returned `null`, the same
 * way `buildOAuthProviders` leaves an unconfigured provider out of the
 * registry rather than building one that cannot work.
 *
 * Enabled without its relying-party ID or its expected origin, this **throws**.
 * A misconfigured RP ID does not produce a subtly weaker ceremony; it produces
 * one that cannot complete, for every user, at the moment they try to enrol.
 * Finding that out at boot is strictly cheaper than finding it out once per
 * user. The message names each missing variable.
 */
export function buildWebAuthnConfig(env: WebAuthnEnv): WebAuthnConfig | null {
  if (!isEnabled(env)) return null;

  const rpId = present(env, 'MFA_WEBAUTHN_RP_ID');
  const origin = present(env, 'MFA_WEBAUTHN_ORIGIN');

  const missing = [
    rpId === undefined ? 'MFA_WEBAUTHN_RP_ID' : null,
    origin === undefined ? 'MFA_WEBAUTHN_ORIGIN' : null,
  ].filter((name): name is string => name !== null);

  if (rpId === undefined || origin === undefined) {
    throw new Error(
      `MFA_WEBAUTHN_ENABLED is "true" but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} `
      + 'not set. A WebAuthn ceremony without its relying-party ID and expected origin cannot '
      + 'complete for any user, so this deployment refuses to boot rather than fail per user. '
      + `Set ${missing.join(' and ')}, or unset MFA_WEBAUTHN_ENABLED to run without WebAuthn.`,
    );
  }

  return { rpId, rpName: present(env, 'MFA_ISSUER') ?? rpId, origin };
}
