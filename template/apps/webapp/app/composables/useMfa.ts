import type { ComputedRef } from 'vue';
import { useAuthStore } from '~/stores/auth';
import type { MfaChallengeMethodBody } from '~/types';

/** What a component gets when it is finishing a sign-in the password did not finish. */
export interface UseMfa {
  /**
   * Whether a challenge is held, and the methods it may be finished with —
   * `null` methods when this side was not told which. **Never the token**: it
   * stays in the store, so a component has nothing to put in a URL or a log.
   */
  readonly challenge: ComputedRef<{ methods: readonly MfaChallengeMethodBody[] | null } | null>;
  /**
   * Holds a token that arrived in a redirect, and asks which methods it may be
   * finished with. Used once, by the page that received it. Resolves when that
   * question is answered; afterwards `challenge` is `null` if the token turned
   * out not to be presentable.
   */
  readonly adoptChallenge: (token: string) => Promise<void>;
  /** Forgets the challenge. */
  readonly abandonChallenge: () => void;
  /** Whether this browser can answer a passkey ceremony at all. */
  readonly passkeySupported: () => Promise<boolean>;
  /**
   * Finishes with a code from one of the account's own methods.
   *
   * @throws when it is refused, for any reason, and whatever the reason — the
   * challenge is spent either way
   */
  readonly verifyCode: (methodId: string, code: string) => Promise<void>;
  /** Finishes with a recovery code. Same refusal, same cost. */
  readonly verifyRecoveryCode: (recoveryCode: string) => Promise<void>;
  /**
   * Finishes with a passkey: fetch the options, let the authenticator sign,
   * present the assertion.
   *
   * @throws when any leg fails, including the person dismissing the browser's
   * own prompt
   */
  readonly verifyPasskey: () => Promise<void>;
}

/**
 * The second step of signing in.
 *
 * The passkey ceremony lives here rather than in the store because it is the
 * one leg that touches the browser: `@simplewebauthn/browser` is imported on the
 * first call and not at load, so a page that never offers a passkey — or one
 * rendered on the server, where there is no `navigator.credentials` — never
 * evaluates it. The store owns the two things either side of it, the options
 * request and the assertion, because both spend the token and the token is the
 * store's.
 */
export function useMfa(): UseMfa {
  const store = useAuthStore();

  return {
    challenge: computed(() => store.challenge),
    adoptChallenge: async (token: string) => {
      store.adoptChallenge(token);
      await store.loadChallengeMethods();
    },
    abandonChallenge: () => store.abandonChallenge(),
    passkeySupported: async () => {
      const { browserSupportsWebAuthn } = await import('@simplewebauthn/browser');
      return browserSupportsWebAuthn();
    },
    verifyCode: (methodId: string, code: string) => (
      store.completeSecondFactor({ methodId, code })
    ),
    verifyRecoveryCode: (recoveryCode: string) => (
      store.completeSecondFactor({ recoveryCode })
    ),
    verifyPasskey: async () => {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const optionsJSON = await store.beginPasskey();
      // The options are the server's own, in the library's own JSON shape; this
      // application neither reads nor rewrites them.
      const assertion = await startAuthentication({
        optionsJSON: optionsJSON as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      });
      await store.completePasskey(assertion as unknown as Record<string, unknown>);
    },
  };
}
