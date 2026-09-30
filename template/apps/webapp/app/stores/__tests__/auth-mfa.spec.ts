import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pinia } from 'pinia';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { ApiError } from '~/fetchers';
import { AuthHttpService } from '~/services';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import type { ApiClient, ApiRequest, LoginResponseBody } from '~/types';

/**
 * The auth store's second-factor half, driven through the shipped store, its
 * real service and fetchers, against a model of the backend.
 *
 * ## What this file exists to hold
 *
 * The challenge token is a single-use credential that a person holds for a few
 * minutes. `auth.spec.ts` spends a task's worth of comments on why the access
 * credential lives in memory and nowhere else; the same argument applies here,
 * and the same three places need watching: a cookie, storage, and the state
 * Pinia serialises into the server-rendered page.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';
const SEEDED_AT = '2026-01-01T00:00:00.000Z';
const ACTOR_ID = 'stub-User-1' as UserId;
const OTHER_ID = 'stub-User-2' as UserId;

/** What the world will accept for the authenticator, and for nothing else. */
const AUTHENTICATOR_ID = 'stub-method-totp';
const AUTHENTICATOR_ANSWER = '123456';
const WRONG_ANSWER = '654321';
const PASSKEY_ANSWER = 'stub-passkey-1';
const RECOVERY_ANSWER = 'stub-recovery-1';
/** A token of the right shape that names nothing the world minted. */
const STUB_CHALLENGE = 'stub-challenge-fixture';

function actor(id: UserId, email: string): UserJSON {
  return {
    id,
    email,
    displayName: 'Ada',
    status: UserStatus.ACTIVE,
    platformRole: PlatformRole.PLATFORM_USER,
    emailVerifiedAt: SEEDED_AT,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    deletedAt: null,
  };
}

const ACTOR = actor(ACTOR_ID, 'ada@example.test');

describe('useAuthStore — the second factor', () => {
  let backend: StubBackend;
  let store: ReturnType<typeof useAuthStore>;
  /** Every challenge token the world answered a login with, read off the wire. */
  let tokens: string[];

  /** The world, with a tap on it: what a page could not see, this can. */
  function tapped(): ApiClient {
    return async <T>(request: ApiRequest): Promise<T> => {
      const answer = await backend.client<T>(request);
      const body = answer as unknown as LoginResponseBody | undefined;
      if (body !== undefined && body.status === AuthenticationStatus.MFA_REQUIRED) {
        tokens.push(body.challengeToken);
      }
      return answer;
    };
  }

  beforeEach(() => {
    stubNuxtAutoImports();
    vi.stubGlobal('useRuntimeConfig', () => ({
      apiBaseServer: '',
      public: { apiBase: 'http://backend.test' },
    }));
    tokens = [];
    setActivePinia(createPinia());
    backend = stubBackend();
    backend.putUser(ACTOR, PLAINTEXT);
    backend.putUser(actor(OTHER_ID, 'grace@example.test'), PLAINTEXT);
    backend.requireSecondFactor(ACTOR_ID, {
      methods: [
        { id: AUTHENTICATOR_ID, type: 'TOTP', label: 'Phone', code: AUTHENTICATOR_ANSWER },
        { id: 'stub-method-key', type: 'WEBAUTHN', label: 'Key', code: PASSKEY_ANSWER },
      ],
      recoveryCodes: [RECOVERY_ANSWER],
    });
    store = useAuthStore();
    store.adoptTransport(tapped());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'cookie');
  });

  describe('a sign-in that is owed a second factor', () => {
    it('reports the challenge and its methods, and signs nobody in', async () => {
      const outcome = await store.login(ACTOR.email, PLAINTEXT);

      expect(outcome.status).toBe(AuthenticationStatus.MFA_REQUIRED);
      expect(outcome).toEqual({
        status: AuthenticationStatus.MFA_REQUIRED,
        methods: [
          { id: AUTHENTICATOR_ID, type: 'TOTP', label: 'Phone' },
          { id: 'stub-method-key', type: 'WEBAUTHN', label: 'Key' },
        ],
      });
      expect(store.challenge?.methods).toHaveLength(2);
      expect(store.status).toBe('unknown');
      expect(store.currentUser).toBeNull();
      expect(store.accessToken).toBeNull();
    });

    // The wire says it and this asserts the world agrees: a challenge is not a
    // session. An implementation that opened one and returned the challenge shape
    // would satisfy every assertion above.
    it('opens no session in the world: no credential issued, no renewal cookie', async () => {
      await store.login(ACTOR.email, PLAINTEXT);

      expect(backend.issuedCredentials()).toEqual([]);
      expect(backend.renewalCookie()).toBeNull();
      expect(tokens).toHaveLength(1);
    });

    it('does NOT hand the token to whoever asked to sign in', async () => {
      const outcome = await store.login(ACTOR.email, PLAINTEXT);

      // Present-and-undefined would pass `toEqual`; the property must not exist.
      expect(Object.keys(outcome)).not.toContain('challengeToken');
      expect(JSON.stringify(outcome)).not.toContain(tokens[0]);
      expect(JSON.stringify(store.challenge)).not.toContain(tokens[0]);
    });

    it('keeps the token out of the state pinia serialises', async () => {
      await store.login(ACTOR.email, PLAINTEXT);
      const federated = backend.mintChallenge(ACTOR_ID);
      store.adoptChallenge(federated);

      const state = (getActivePinia() as Pinia).state.value.auth as Record<string, unknown>;

      // The same keys `auth.spec.ts` pins for the credential, and no more: a
      // challenge held as a returned `ref` would add a key here and put the token
      // in the markup.
      expect(Object.keys(state).sort()).toEqual(['status', 'user']);
      expect(JSON.stringify(state)).not.toContain(tokens[0]);
      expect(JSON.stringify(state)).not.toContain(federated);
    });

    it('puts the token in no storage and no cookie', async () => {
      const local: string[][] = [];
      const session: string[][] = [];
      const cookies: string[] = [];
      const recording = (writes: string[][]): Storage => {
        const held = new Map<string, string>();
        return {
          get length() {
            return held.size;
          },
          clear: () => held.clear(),
          getItem: (key: string) => held.get(key) ?? null,
          key: (index: number) => [...held.keys()][index] ?? null,
          removeItem: (key: string) => {
            held.delete(key);
          },
          setItem: (key: string, value: string) => {
            writes.push([key, value]);
            held.set(key, value);
          },
        };
      };
      vi.stubGlobal('localStorage', recording(local));
      vi.stubGlobal('sessionStorage', recording(session));
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => '',
        set: (value: string) => {
          cookies.push(value);
        },
      });

      await store.login(ACTOR.email, PLAINTEXT);
      store.adoptChallenge(backend.mintChallenge(ACTOR_ID));
      await store.completeSecondFactor({ recoveryCode: RECOVERY_ANSWER });

      expect(local).toEqual([]);
      expect(session).toEqual([]);
      expect(cookies).toEqual([]);
    });

    // `authenticate` is core's contract and core's MFA arm needs a user the wire
    // does not carry. It refuses rather than invent one.
    it('is one `beginSignIn` answers, and `authenticate` refuses to flatten', async () => {
      const service = new AuthHttpService(tapped());

      await expect(service.authenticate({
        email: ACTOR.email,
        secret: PLAINTEXT,
        client: { address: null, label: null },
      })).rejects.toThrow(/second factor/);

      const result = await service.beginSignIn({
        email: ACTOR.email,
        secret: PLAINTEXT,
        client: { address: null, label: null },
      });
      expect(result.status).toBe(AuthenticationStatus.MFA_REQUIRED);
    });

    it('still signs in an account that owes nothing, exactly as before', async () => {
      const outcome = await store.login('grace@example.test', PLAINTEXT);

      expect(outcome.status).toBe(AuthenticationStatus.AUTHENTICATED);
      expect(store.challenge).toBeNull();
      expect(store.status).toBe('authenticated');
    });

    it('refuses a wrong password as before, and holds no challenge for it', async () => {
      const outcome = await store.login(ACTOR.email, `${PLAINTEXT}-not`);

      expect(outcome.status).toBe(AuthenticationStatus.REJECTED);
      expect(store.challenge).toBeNull();
    });
  });

  describe('finishing with a code', () => {
    it('sends the challenge token, the method and the code — and takes up the session', async () => {
      await store.login(ACTOR.email, PLAINTEXT);

      await store.completeSecondFactor({ methodId: AUTHENTICATOR_ID, code: AUTHENTICATOR_ANSWER });

      expect(backend.mfaVerifyBodies()).toEqual([{
        challengeToken: tokens[0],
        methodId: AUTHENTICATOR_ID,
        code: AUTHENTICATOR_ANSWER,
      }]);
      expect(store.status).toBe('authenticated');
      expect(store.currentUser?.email).toBe(ACTOR.email);
      // Against what the WORLD issued, not against what the store says it holds.
      expect(store.accessToken).toBe(backend.issuedCredentials()[0]);
      expect(store.challenge).toBeNull();
    });

    it('sends a recovery code with no method and no code beside it', async () => {
      await store.login(ACTOR.email, PLAINTEXT);

      await store.completeSecondFactor({ recoveryCode: RECOVERY_ANSWER });

      const [sent] = backend.mfaVerifyBodies();
      // Key sets, not values: an `undefined` that JSON drops would hide behind
      // `toEqual`, and "never both" is a claim about which fields are present.
      expect(Object.keys(sent ?? {}).sort()).toEqual(['challengeToken', 'recoveryCode']);
      expect(store.status).toBe('authenticated');
    });

    it('spends the recovery code: the same one does not sign in twice', async () => {
      await store.login(ACTOR.email, PLAINTEXT);
      await store.completeSecondFactor({ recoveryCode: RECOVERY_ANSWER });

      // A new page load: a store that has never heard of the first.
      setActivePinia(createPinia());
      const second = useAuthStore();
      second.adoptTransport(tapped());
      await second.login(ACTOR.email, PLAINTEXT);

      await expect(
        second.completeSecondFactor({ recoveryCode: RECOVERY_ANSWER }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    it('holds nothing afterwards on a refusal, because the backend spent the challenge first', async () => {
      await store.login(ACTOR.email, PLAINTEXT);

      await expect(
        store.completeSecondFactor({ methodId: AUTHENTICATOR_ID, code: WRONG_ANSWER }),
      ).rejects.toBeInstanceOf(ApiError);

      expect(store.challenge).toBeNull();
      expect(backend.liveChallenges()).toBe(0);
      expect(store.status).toBe('unknown');
      expect(backend.issuedCredentials()).toEqual([]);
      // Nothing left to present: a second try does not reach the network.
      await expect(
        store.completeSecondFactor({ methodId: AUTHENTICATOR_ID, code: AUTHENTICATOR_ANSWER }),
      ).rejects.toThrow('No sign-in is waiting');
      expect(backend.mfaVerifyBodies()).toHaveLength(1);
    });

    // The enumeration property, from this side: every way of being refused is one
    // answer, so that somebody holding one factor learns nothing about the account
    // from which way they were turned away.
    it('is refused with one answer, whichever of six ways it was refused', async () => {
      const refusals: ApiError[] = [];
      const wrongCode = { methodId: AUTHENTICATOR_ID, code: WRONG_ANSWER };
      const rightCode = { methodId: AUTHENTICATOR_ID, code: AUTHENTICATOR_ANSWER };
      const refused = async (attempt: () => Promise<void>): Promise<void> => {
        try {
          await attempt();
        } catch (error) {
          if (error instanceof ApiError) refusals.push(error);
        }
      };

      // 1. A wrong code.
      await store.login(ACTOR.email, PLAINTEXT);
      await refused(() => store.completeSecondFactor(wrongCode));
      // 2. A method that is not the account's.
      await store.login(ACTOR.email, PLAINTEXT);
      await refused(() => store.completeSecondFactor({ methodId: 'stub-method-elsewhere', code: AUTHENTICATOR_ANSWER }));
      // 3. A recovery code that was never issued.
      await store.login(ACTOR.email, PLAINTEXT);
      await refused(() => store.completeSecondFactor({ recoveryCode: 'stub-recovery-unknown' }));
      // 4. A challenge that answers to nothing.
      store.adoptChallenge(STUB_CHALLENGE);
      await refused(() => store.completeSecondFactor(rightCode));
      // 5. A challenge already spent.
      await store.login(ACTOR.email, PLAINTEXT);
      const spent = tokens[tokens.length - 1] ?? '';
      await refused(() => store.completeSecondFactor(wrongCode));
      store.adoptChallenge(spent);
      await refused(() => store.completeSecondFactor(rightCode));
      // 6. A proof that fits neither shape, sent past the type system.
      await store.login(ACTOR.email, PLAINTEXT);
      await refused(() => store.completeSecondFactor({
        methodId: AUTHENTICATOR_ID,
        code: AUTHENTICATOR_ANSWER,
        recoveryCode: RECOVERY_ANSWER,
      } as never));

      expect(refusals).toHaveLength(7);
      const [first, ...rest] = refusals;
      for (const each of rest) {
        expect(each.status).toBe(first?.status);
        expect(each.body).toEqual(first?.body);
      }
      expect(first?.status).toBe(401);
      expect(store.status).toBe('unknown');
    });
  });

  describe('finishing with a passkey', () => {
    it('spends the token it is given and continues with the one it is answered with', async () => {
      await store.login(ACTOR.email, PLAINTEXT);
      expect(backend.liveChallenges()).toBe(1);

      const options = await store.beginPasskey();

      expect(options).toEqual({ challenge: 'stub-assertion-nonce', rpId: 'localhost' });
      // One live, and it is not the first: the leg before it was spent.
      expect(backend.liveChallenges()).toBe(1);
      expect(store.challenge?.methods).toHaveLength(2);

      await store.completePasskey({ id: PASSKEY_ANSWER });

      expect(store.status).toBe('authenticated');
      expect(store.challenge).toBeNull();
      expect(backend.liveChallenges()).toBe(0);
    });

    it('is refused as every other proof is, and leaves nothing held', async () => {
      await store.login(ACTOR.email, PLAINTEXT);
      await store.beginPasskey();

      await expect(store.completePasskey({ id: 'stub-passkey-other' })).rejects.toBeInstanceOf(ApiError);

      expect(store.challenge).toBeNull();
      expect(store.status).toBe('unknown');
    });
  });

  describe('a challenge that arrived by redirect', () => {
    it('is held with its methods unknown, not with none, until they are asked for', () => {
      store.adoptChallenge(backend.mintChallenge(ACTOR_ID));

      // `null` says "not told"; `[]` would say "has no way in".
      expect(store.challenge).toEqual({ methods: null });
    });

    it('learns the methods without spending the challenge, and can then finish with a code', async () => {
      const federated = backend.mintChallenge(ACTOR_ID);
      store.adoptChallenge(federated);

      await store.loadChallengeMethods();

      expect(store.challenge?.methods).toEqual([
        { id: AUTHENTICATOR_ID, type: 'TOTP', label: 'Phone' },
        { id: 'stub-method-key', type: 'WEBAUTHN', label: 'Key' },
      ]);
      expect(backend.liveChallenges()).toBe(1);
      await store.completeSecondFactor({ methodId: AUTHENTICATOR_ID, code: AUTHENTICATOR_ANSWER });
      expect(backend.mfaVerifyBodies()).toEqual([{
        challengeToken: federated,
        methodId: AUTHENTICATOR_ID,
        code: AUTHENTICATOR_ANSWER,
      }]);
      expect(store.status).toBe('authenticated');
    });

    it('drops a challenge the backend will not present, and holds nothing', async () => {
      store.adoptChallenge(STUB_CHALLENGE);

      await store.loadChallengeMethods();

      expect(store.challenge).toBeNull();
    });

    it('keeps the challenge, methods still unknown, when the question could not be asked', async () => {
      store.adoptChallenge(backend.mintChallenge(ACTOR_ID));
      store.adoptTransport(() => Promise.reject(new Error('the backend is not there')));

      await store.loadChallengeMethods();

      expect(store.challenge).toEqual({ methods: null });
    });

    it('does nothing when nothing is held', async () => {
      await expect(store.loadChallengeMethods()).resolves.toBeUndefined();
      expect(store.challenge).toBeNull();
    });

    it('finishes a sign-in with a recovery code', async () => {
      store.adoptChallenge(backend.mintChallenge(ACTOR_ID));

      await store.completeSecondFactor({ recoveryCode: RECOVERY_ANSWER });

      expect(store.status).toBe('authenticated');
    });

    it('is forgotten when abandoned', () => {
      store.adoptChallenge(backend.mintChallenge(ACTOR_ID));

      store.abandonChallenge();

      expect(store.challenge).toBeNull();
    });
  });

  // Compile-time, and here because `nuxt typecheck` is what reads it. The brief
  // for this file's task named the debt: `POST /auth/login` was typed as the
  // success body alone, which stopped being true the day it could answer a
  // challenge. If either directive below is unused, the union has stopped
  // narrowing and the typecheck says so.
  describe('the login response type', () => {
    it('makes a caller that ignores the second arm a compile error', () => {
      const unhandled = (body: LoginResponseBody): string => {
        // @ts-expect-error `user` is not on the challenge arm.
        return body.user.id;
      };
      const handled = (body: LoginResponseBody): string => (
        body.status === AuthenticationStatus.MFA_REQUIRED ? body.challengeToken : body.user.id
      );

      expect(typeof unhandled).toBe('function');
      expect(handled({
        status: AuthenticationStatus.MFA_REQUIRED,
        challengeToken: STUB_CHALLENGE,
        methods: [],
      })).toBe(STUB_CHALLENGE);
    });
  });
});
