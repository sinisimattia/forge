import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import { ConsumedTokenError, ExpiredTokenError } from '__FORGE_SCOPE__/core/auth/errors';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { WeakPasswordError } from '__FORGE_SCOPE__/core/identities/errors';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { useIdentities } from '~/composables/useIdentities';
import { useProfile } from '~/composables/useProfile';
import { usePasswordRecovery } from '~/composables/usePasswordRecovery';
import { useRegistration } from '~/composables/useRegistration';
import { useSessions } from '~/composables/useSessions';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import type { ApiClient, ApiRequest } from '~/types';

/**
 * The five composables this task wrote so that a component would not have to
 * touch a service.
 *
 * They shipped with no specs at all, and three of them hold state or a decision:
 * `useSessions` re-reads after a revoke, `useIdentities` separates the one
 * refusal a person can act on from every other, `useProfile` writes the saved
 * record back into the store. The other two are pass-throughs whose documented
 * `@throws` is the whole of their contract, and that is what is asserted — an
 * error that arrives as something other than core's is a page that cannot branch.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';
const SEEDED_AT = '2026-01-01T00:00:00.000Z';
const ACTOR_ID = 'stub-User-1' as UserId;

/** `example.test` is reserved by RFC 6761 and resolves for nobody. */
const ACTOR: UserJSON = {
  id: ACTOR_ID,
  email: 'ada@example.test',
  displayName: 'Ada',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

/** A second session for the actor, so the list has something to revoke. */
function otherSession(id: string) {
  return {
    id: id as SessionId,
    userId: ACTOR_ID,
    createdAt: SEEDED_AT,
    lastUsedAt: SEEDED_AT,
    expiresAt: '2099-01-01T00:00:00.000Z',
    revokedAt: null,
    // The documentation range reserved by RFC 5737. It belongs to nobody.
    clientAddress: '203.0.113.7',
    clientLabel: 'Safari on iOS',
  };
}

function identity(id: string, provider: AuthProvider, account: string) {
  return AuthIdentity.fromJSON({
    id: id as AuthIdentityId,
    userId: ACTOR_ID,
    provider,
    providerAccountId: account,
    createdAt: SEEDED_AT,
    lastUsedAt: null,
  }).toJSON();
}

describe('the account composables', () => {
  let backend: StubBackend;

  beforeEach(() => {
    stubNuxtAutoImports();
    vi.stubGlobal('useRuntimeConfig', () => ({
      apiBaseServer: '',
      public: { apiBase: 'http://backend.test' },
    }));
    setActivePinia(createPinia());
    backend = stubBackend();
    backend.putUser(ACTOR, PLAINTEXT);
    useAuthStore().adoptTransport(backend.client);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Signs in, which is what gives every composable below an actor to act for. */
  async function signIn(): Promise<void> {
    await useAuthStore().login(ACTOR.email, PLAINTEXT);
  }

  describe('useSessions', () => {
    it('reads the actor\'s sessions as entities, carrying the current-session flag', async () => {
      backend.putSession(otherSession('stub-Session-90'));
      await signIn();
      const sessions = useSessions();

      await sessions.load();

      expect(sessions.sessions.value).toHaveLength(2);
      expect(sessions.sessions.value[0]?.session).toBeInstanceOf(Session);
      // The flag is carried, and here it is carried as `false` for every row.
      // **That is the stub, not the composable.** `/auth/sessions` computes
      // `isCurrent` by comparing against the session the *request* was made
      // through, and `stubBackend.actorOf` can only resolve that from
      // `ApiRequest.credential` — which the real transport writes into a header
      // this stub never sees, so every ordinary request resolves by
      // `ApiRequest.actor` with no session at all. The same limit deleted an
      // assertion in `auth.account.spec.ts`; it is recorded here too so nobody
      // reads this expectation as the intended behaviour. What marking looks
      // like when the flag *is* true is `SessionList`'s own suite, which is
      // handed rows directly.
      expect(sessions.sessions.value.every((one) => one.isCurrent === false)).toBe(true);
      expect(sessions.failed.value).toBe(false);
    });

    it('re-reads after a revoke rather than splicing the row out', async () => {
      // The list is a photograph and revoking is the one action that makes a
      // different photograph true. Dropping the row locally is right for the
      // revoked session and wrong for everything else on the screen: another
      // session may have ended elsewhere meanwhile, and a screen that kept
      // showing it offers a button that will refuse.
      backend.putSession(otherSession('stub-Session-90'));
      await signIn();
      const sessions = useSessions();
      await sessions.load();
      const target = 'stub-Session-90' as SessionId;

      await sessions.revoke(target);

      expect(sessions.sessions.value).toHaveLength(1);
      expect(sessions.sessions.value.map((one) => one.session.id)).not.toContain(target);
    });

    it('does NOT ask at all when nobody is signed in', async () => {
      const seen: string[] = [];
      useAuthStore().adoptTransport(<T>(request: ApiRequest): Promise<T> => {
        seen.push(request.path);
        return backend.client<T>(request);
      });
      const sessions = useSessions();

      await sessions.load();

      expect(seen).toEqual([]);
      expect(sessions.sessions.value).toEqual([]);
    });

    it('reports a failure, and does NOT report one after a read that worked', async () => {
      await signIn();
      const sessions = useSessions();
      useAuthStore().adoptTransport(() => Promise.reject(new Error('the backend is not there')));

      await sessions.load();
      expect(sessions.failed.value).toBe(true);
      expect(sessions.sessions.value).toEqual([]);

      useAuthStore().adoptTransport(backend.client);
      await sessions.load();
      expect(sessions.failed.value).toBe(false);
      expect(sessions.sessions.value).toHaveLength(1);
    });
  });

  describe('useIdentities', () => {
    it('reads the actor\'s identities', async () => {
      await signIn();
      backend.putIdentity(identity('stub-AuthIdentity-1', AuthProvider.PASSWORD, ACTOR.email));
      backend.putIdentity(identity('stub-AuthIdentity-2', AuthProvider.GOOGLE, '117392044118'));
      const identities = useIdentities();

      await identities.load();

      expect(identities.identities.value).toHaveLength(2);
      expect(identities.identities.value[0]).toBeInstanceOf(AuthIdentity);
    });

    it('unlinks one, and re-reads', async () => {
      await signIn();
      backend.putIdentity(identity('stub-AuthIdentity-1', AuthProvider.PASSWORD, ACTOR.email));
      backend.putIdentity(identity('stub-AuthIdentity-2', AuthProvider.GOOGLE, '117392044118'));
      const identities = useIdentities();
      await identities.load();

      await identities.unlink('stub-AuthIdentity-2' as AuthIdentityId);

      expect(identities.identities.value).toHaveLength(1);
      expect(identities.lastRemaining.value).toBe(false);
    });

    it('names the last-identity refusal, and does NOT fold it into the generic one', async () => {
      // It is the one refusal with a remedy the person can carry out — add
      // another way in first. Folded into `failed` it becomes "something went
      // wrong", and there is nothing they can do about that.
      await signIn();
      backend.putIdentity(identity('stub-AuthIdentity-1', AuthProvider.PASSWORD, ACTOR.email));
      const identities = useIdentities();
      await identities.load();

      await identities.unlink('stub-AuthIdentity-1' as AuthIdentityId);

      expect(identities.lastRemaining.value).toBe(true);
      expect(identities.failed.value).toBe(false);
      expect(identities.identities.value).toHaveLength(1);
    });

    it('does NOT name it for a refusal that was not that', async () => {
      await signIn();
      backend.putIdentity(identity('stub-AuthIdentity-1', AuthProvider.PASSWORD, ACTOR.email));
      const identities = useIdentities();
      await identities.load();
      useAuthStore().adoptTransport(() => Promise.reject(new Error('the backend is not there')));

      await identities.unlink('stub-AuthIdentity-1' as AuthIdentityId);

      expect(identities.lastRemaining.value).toBe(false);
      expect(identities.failed.value).toBe(true);
    });
  });

  describe('useProfile', () => {
    it('saves the name and writes it back into the store', async () => {
      await signIn();

      await useProfile().save('Ada Lovelace');

      expect(useAuthStore().currentUser?.displayName).toBe('Ada Lovelace');
    });

    it('does NOT touch the store when the server refused', async () => {
      await signIn();
      await expect(useProfile().save('   ')).rejects.toThrow();
      expect(useAuthStore().currentUser?.displayName).toBe('Ada');
    });

    it('refuses to save for nobody', async () => {
      await expect(useProfile().save('Ada Lovelace')).rejects.toThrow();
    });
  });

  describe('useRegistration and usePasswordRecovery', () => {
    /** A transport that answers one path with a chosen envelope. */
    function refusing(path: string, status: number, code: string): ApiClient {
      return <T>(request: ApiRequest): Promise<T> => {
        if (request.path !== path) return backend.client<T>(request);
        return Promise.reject(
          Object.assign(new Error('refused'), {
            name: 'ApiError',
            status,
            body: { error: 'Gone', message: 'no', code },
          }),
        );
      };
    }

    it('re-throws core\'s error unchanged, so a page can branch on it', async () => {
      // The whole of these two composables' contract. An error that arrived as
      // anything else — a boolean, a flag, a raw `ApiError` — is a page that
      // cannot tell a used link from an expired one, which is the distinction
      // `IAuthService.verifyEmail` exists to preserve.
      backend.putVerification(ACTOR_ID, 'stub-fixture-consumed', new Date(Date.now() + 60_000));
      await useRegistration().verify('stub-fixture-consumed');

      await expect(useRegistration().verify('stub-fixture-consumed'))
        .rejects.toBeInstanceOf(ConsumedTokenError);
      await expect(useRegistration().verify('stub-fixture-never-issued'))
        .rejects.toBeInstanceOf(ExpiredTokenError);
    });

    it('re-throws a refused secret as the error that carries the reasons', async () => {
      await expect(useRegistration().register(ACTOR.email, 'Ada', 'short'))
        .rejects.toBeInstanceOf(WeakPasswordError);
      await expect(usePasswordRecovery().reset('whatever', 'short'))
        .rejects.toBeInstanceOf(WeakPasswordError);
    });

    it('resolves for an address nobody answers to, exactly as for one they do', async () => {
      // The enumeration rule, at the layer that could break it by throwing.
      await expect(useRegistration().resend('nobody@example.test')).resolves.toBeUndefined();
      await expect(useRegistration().resend(ACTOR.email)).resolves.toBeUndefined();
      await expect(usePasswordRecovery().request('nobody@example.test')).resolves.toBeUndefined();
      await expect(usePasswordRecovery().request(ACTOR.email)).resolves.toBeUndefined();
    });

    // `refusing` is declared above for the shape a future test will need; it is
    // referenced here so an unused binding does not ship.
    it('leaves an envelope it does not recognise alone', async () => {
      useAuthStore().adoptTransport(refusing('/auth/verify-email', 503, 'NOT_A_DOMAIN_CODE'));
      await expect(useRegistration().verify('anything')).rejects.not.toBeInstanceOf(
        ConsumedTokenError,
      );
    });
  });
});
