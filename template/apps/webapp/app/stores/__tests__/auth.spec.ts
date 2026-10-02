import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pinia } from 'pinia';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { AuthenticationRejectionReason, AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import { useAuthStore } from '~/stores/auth';

/**
 * The auth store, driven against a model of the backend.
 *
 * ## What is being driven, and what is standing in
 *
 * The store is the shipped `defineStore` — its real actions, its real
 * `AuthHttpService`, its real fetchers. What is replaced is one thing: the
 * transport at the bottom, through `adoptTransport`, which is the same door the
 * server plugin uses in production. Nothing here re-declares a store, a service
 * or a fetcher in a fixture, because a re-declared fixture eventually goes on
 * agreeing with a production file that has changed.
 *
 * ## Where the expectations come from
 *
 * From the world. `backend.issuedCredentials()` is what the stub minted and
 * `backend.refreshRequests()` is what it was asked for; asserting the store's
 * token against a value the store itself produced would pass for a store that
 * invented one. That is the same rule the conformance drivers and the seam spec
 * follow.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/**
 * The same phrase, spoilt, for the attempt that has to be refused.
 *
 * A named binding rather than a literal at its use: it is built from
 * `PLAINTEXT`, so the correct phrase has one spelling and this one is visibly
 * derived from it.
 */
const WRONG_PLAINTEXT = `${PLAINTEXT}-not`;

/** One instant for the world, which nothing here compares. */
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

const ACTOR_ID = 'stub-User-1' as UserId;
const ACTOR_EMAIL = 'ada@example.test';

/** The one account this world holds: verified, active, usable. */
const ACTOR: UserJSON = {
  id: ACTOR_ID,
  email: ACTOR_EMAIL,
  displayName: 'Ada',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

/** Everything a browser offers for putting a value somewhere it outlives a tab. */
interface StorageWatch {
  /** Every `[key, value]` written to `localStorage`, in order. */
  readonly local: string[][];
  /** Every `[key, value]` written to `sessionStorage`, in order. */
  readonly session: string[][];
  /** Every value assigned to `document.cookie`, in order. */
  readonly cookies: string[];
  /** Puts `document.cookie` back. */
  readonly restore: () => void;
}

/** A `Storage` that works and writes down every `setItem` it is given. */
function recordingStorage(writes: string[][]): Storage {
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
}

/**
 * Watches the three places a credential could be persisted.
 *
 * **Observes the write API rather than reading the keys back**, and the
 * difference is the whole value of the assertion. "`localStorage.getItem('token')` is
 * `null`" passes for an application that stores nothing, for one that stores it
 * under a different key, and for one that has no storage at all — it is true
 * before the feature exists and stays true after it is broken. What is actually
 * being defended against is a later commit adding "remember me", and that commit
 * will write through the API, not to a key anybody guessed in advance.
 *
 * An observer that never fires proves nothing on its own either, which is why
 * there is a test below that writes through each of these three and asserts this
 * instrumentation sees it.
 */
function watchStorage(): StorageWatch {
  const local: string[][] = [];
  const session: string[][] = [];
  const cookies: string[] = [];
  // Installed rather than spied on. `localStorage` does not exist at all under
  // this runner — checked, not guessed: a `vi.spyOn(globalThis.localStorage, …)`
  // here fails with "could not find an object to spy upon". Which means a spec
  // that only spied on what happens to exist would silently stop watching the
  // most likely of the three places a credential gets parked.
  vi.stubGlobal('localStorage', recordingStorage(local));
  vi.stubGlobal('sessionStorage', recordingStorage(session));
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => '',
    set: (value: string) => {
      cookies.push(value);
    },
  });
  return {
    local,
    session,
    cookies,
    restore: () => {
      Reflect.deleteProperty(document, 'cookie');
    },
  };
}

describe('useAuthStore', () => {
  let backend: StubBackend;
  let store: ReturnType<typeof useAuthStore>;

  beforeEach(() => {
    stubNuxtAutoImports();
    // The store builds its browser transport in its setup, from the same config
    // `nuxt.config.ts` declares. It is replaced immediately below; this is only
    // so that building it does not throw.
    vi.stubGlobal('useRuntimeConfig', () => ({
      apiBaseServer: '',
      public: { apiBase: 'http://backend.test' },
    }));
    setActivePinia(createPinia());
    backend = stubBackend();
    backend.putUser(ACTOR, PLAINTEXT);
    store = useAuthStore();
    store.adoptTransport(presenting(() => store.accessToken));
  });

  /**
   * The world's transport, presenting whatever credential the store holds.
   *
   * `createApiClient` puts that credential in an `Authorization` header; this
   * stub has no headers to read, and `ApiRequest.credential` is the same fact in
   * the vocabulary it does read. It is one line and it mirrors one documented
   * line of the real client rather than re-implementing it.
   *
   * Without it every request arrives as "the actor claims to be X" with no
   * session attached, and `POST /auth/logout` — whose whole job is to end *the
   * session the request was made through* — has none to end, so a spec asserting
   * that signing out really ends it would pass against a store that never
   * called it.
   */
  function presenting(credential: () => string | null) {
    return async <T>(request: Parameters<StubBackend['client']>[0]): Promise<T> => {
      const held = request.credential ?? credential() ?? undefined;
      return backend.client<T>(held === undefined ? request : { ...request, credential: held });
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // `unknown` and not `anonymous`: nobody has been asked yet. Everything else in
  // this file depends on the store starting in the third state, so it is asserted
  // rather than assumed.
  it('starts not knowing, which is not the same as knowing nobody is signed in', () => {
    expect(store.status).toBe('unknown');
    expect(store.accessToken).toBeNull();
    expect(store.currentUser).toBeNull();
    expect(store.isAuthenticated).toBe(false);
  });

  /**
   * The credential is not state, and nothing but an assertion on
   * `pinia.state.value` can see that.
   *
   * Pinia sorts a setup store's return: a `ref` becomes state, a `computed`
   * becomes a getter, and only state is what `@pinia/nuxt` hands to the SSR
   * payload. `store.accessToken` reads the same either way, and so does the type
   * system, so the one line that keeps a bearer credential out of the HTML is
   * invisible everywhere else. `plugins/__tests__/auth-init.server.spec.ts` says
   * the same thing about a real render; this says it about the store itself, so
   * that a change here is red here.
   */
  it('keeps the credential out of the state pinia serialises', async () => {
    await store.login(ACTOR_EMAIL, PLAINTEXT);

    const state = (getActivePinia() as Pinia).state.value.auth as Record<string, unknown>;

    expect(store.accessToken).not.toBeNull();
    expect(Object.keys(state).sort()).toEqual(['status', 'user']);
    expect(JSON.stringify(state)).not.toContain(store.accessToken);
  });

  it('takes up the credential the sign-in was issued, the person, and the status', async () => {
    const outcome = await store.login(ACTOR_EMAIL, PLAINTEXT);

    expect(outcome.status).toBe(AuthenticationStatus.AUTHENTICATED);
    // Against what the WORLD minted, not against what the store says it got.
    const issued = backend.issuedCredentials();
    expect(issued).toHaveLength(1);
    expect(store.accessToken).toBe(issued[0]);
    expect(store.currentUser).toBeInstanceOf(User);
    expect(store.currentUser?.email).toBe(ACTOR_EMAIL);
    expect(store.currentUser?.id).toBe(ACTOR_ID);
    expect(store.status).toBe('authenticated');
    expect(store.isAuthenticated).toBe(true);
  });

  // The DEC-3 seam, from the other side. `takeIssuedCredential` clears as it
  // hands over, so a store that read it twice would hold `null` — which the
  // assertion above catches — and the one here says what the server was told:
  // the credential the store holds is the one that opens that session, so a
  // request made with it is answered.
  it('holds a credential the backend actually accepts', async () => {
    await store.login(ACTOR_EMAIL, PLAINTEXT);

    await expect(backend.client({
      method: 'GET',
      path: '/auth/sessions',
      credential: store.accessToken ?? '',
    })).resolves.toHaveLength(1);
  });

  // A refusal is not an error and not a state change: somebody already signed in
  // who mistypes a second password is still signed in.
  it('reports a refusal as undisclosed and changes nothing', async () => {
    const outcome = await store.login(ACTOR_EMAIL, WRONG_PLAINTEXT);

    expect(outcome).toEqual({
      status: AuthenticationStatus.REJECTED,
      reason: AuthenticationRejectionReason.UNDISCLOSED,
    });
    expect(store.accessToken).toBeNull();
    expect(store.currentUser).toBeNull();
    expect(store.status).toBe('unknown');
  });

  /**
   * **A prior regression, re-run against the discriminator that replaced it.**
   *
   * `createAuthFetch` used to rethrow every `401` on a request that presented
   * nothing, which is what stopped a mistyped password renewing, failing, and
   * signing the visitor out. Taking the credential out of the SSR payload put a
   * browser into exactly that shape on purpose — believes in a session, presents
   * nothing — so the rule had to be narrowed, and this is the case that says the
   * narrowing did not give the bug back.
   *
   * It is driven end to end rather than by handing `createAuthFetch` a boolean:
   * the whole question is whether the *store* can ever be in the renewing state
   * while somebody mistypes a password, and only the store can answer that.
   *
   * The hydration is `@pinia/nuxt`'s own restore — `pinia.state.value` assigned
   * before any store is built — with the payload's real keys and no credential.
   */
  it('does not sign out a hydrated visitor whose password was mistyped', async () => {
    // A real session in the world, whose renewal cookie the jar now holds.
    await store.login(ACTOR_EMAIL, PLAINTEXT);

    // A new page load: the server rendered it signed-in, and the browser has not
    // yet earned a credential of its own.
    const hydratedPinia = createPinia();
    (hydratedPinia.state.value as Record<string, unknown>).auth = {
      status: 'authenticated',
      user: ACTOR,
    };
    setActivePinia(hydratedPinia);
    const hydrated = useAuthStore();
    hydrated.adoptTransport(presenting(() => hydrated.accessToken));
    expect(hydrated.status).toBe('authenticated');
    expect(hydrated.accessToken).toBeNull();

    const outcome = await hydrated.login(ACTOR_EMAIL, WRONG_PLAINTEXT);

    expect(outcome.status).toBe(AuthenticationStatus.REJECTED);
    // The bug, said as the person would say it: they are still signed in.
    expect(hydrated.status).toBe('authenticated');
    expect(hydrated.isAuthenticated).toBe(true);
    expect(hydrated.currentUser?.email).toBe(ACTOR_EMAIL);
  });

  it('clears both and answers anonymous when the session is ended', async () => {
    await store.login(ACTOR_EMAIL, PLAINTEXT);

    await store.logout();

    expect(store.accessToken).toBeNull();
    expect(store.currentUser).toBeNull();
    expect(store.status).toBe('anonymous');
    // And it really ended on the server, which is the half a cleared ref cannot
    // show: the renewal cookie the browser still holds now buys nothing.
    await expect(store.renew()).resolves.toBe(false);
  });

  /**
   * **The one that would never be written from the happy path.**
   *
   * Three protected widgets mount together, all find the credential lapsed, all
   * ask. Without the in-flight promise that is three requests: the first rotates
   * the renewal credential, and the second and third then present one the server
   * has already spent. Reuse detection is right to read that as theft and it
   * revokes the whole session family — so the person is signed out, at a moment
   * nothing was doing anything unusual, which is why it reads as "I get logged
   * out at random".
   *
   * Both halves are asserted: the request count, and the symptom. The count
   * alone would go green for a store that renewed once and lost the session for
   * some other reason; the symptom alone would go green for a store that renewed
   * three times against a backend that tolerated it.
   */
  it('renews once however many callers ask at the same moment', async () => {
    await store.login(ACTOR_EMAIL, PLAINTEXT);
    const before = backend.refreshRequests();
    const heldBefore = backend.renewalCookie();

    const answers = await Promise.all([store.renew(), store.renew(), store.renew()]);

    expect(backend.refreshRequests() - before).toBe(1);
    expect(answers).toEqual([true, true, true]);
    // The symptom. The session is intact and the browser holds exactly one
    // rotation's worth of credential, not a spent one.
    expect(store.status).toBe('authenticated');
    expect(backend.renewalCookie()).not.toBe(heldBefore);
    await expect(store.renew()).resolves.toBe(true);
  });

  it('takes up what the renewal answered with', async () => {
    await store.login(ACTOR_EMAIL, PLAINTEXT);

    await expect(store.renew()).resolves.toBe(true);

    const issued = backend.issuedCredentials();
    expect(issued).toHaveLength(2);
    // The one the renewal minted, and not the one the sign-in minted.
    expect(store.accessToken).toBe(issued[1]);
    expect(store.currentUser?.id).toBe(ACTOR_ID);
  });

  // `anonymous` and not `unknown`. A guard waiting for the question to be
  // answered has to be released; left at `unknown` it waits for a renewal that
  // has already happened and will not happen again, and the page never renders.
  it('answers anonymous when there is nothing to renew', async () => {
    await expect(store.renew()).resolves.toBe(false);

    expect(store.status).toBe('anonymous');
    expect(store.accessToken).toBeNull();
    expect(store.currentUser).toBeNull();
  });

  /**
   * **A signed-in store whose renewal cookie no longer buys anything.**
   *
   * The production state DEC-3 produces most often — the person signed out on
   * another device, or reuse detection already fired — and the only one in which
   * `renew()` can be asked to renew in order to renew.
   *
   * It is here because `postRefresh` is issued on the **bare** transport and not
   * on the renewing one, and nothing made that true: `utils/authFetch.ts` called
   * the alternative impossible, and swapping `transport` for `guarded` on the one
   * line that matters left the whole suite green. It is not impossible. With
   * `guarded`, this renewal's own `401` asks `createAuthFetch` to renew; the
   * credential is non-null so it does; `renew()` hands back the in-flight promise,
   * which **is this one** — it awaits itself, never settles, and both route
   * middleware wait on it forever. Not a redirect and not a crash: a page that
   * never renders.
   *
   * Every other failing-renewal test in this file runs on a store that has never
   * signed in, where `presented()` is `null`, `awaitingRenewal()` is `false`
   * because the status is `unknown`, and `createAuthFetch` rethrows before
   * reaching the branch. That is why signing in first is the whole test.
   */
  it('answers, rather than waiting on itself, when a signed-in session has been ended', async () => {
    await store.login(ACTOR_EMAIL, PLAINTEXT);
    expect(store.accessToken).not.toBeNull();

    // Ended somewhere else. Nothing the client could have asked for.
    backend.endSessionsOf(ACTOR_ID);

    await expect(store.renew()).resolves.toBe(false);
    expect(store.status).toBe('anonymous');
    expect(store.accessToken).toBeNull();
    expect(store.currentUser).toBeNull();
  });

  it('asks once and then stops asking', async () => {
    await store.initialize();
    expect(backend.refreshRequests()).toBe(1);
    expect(store.status).toBe('anonymous');

    await store.initialize();
    expect(backend.refreshRequests()).toBe(1);
  });

  it('puts the credential in no storage and no cookie', async () => {
    const watch = watchStorage();
    try {
      await store.login(ACTOR_EMAIL, PLAINTEXT);
      await store.renew();
      await store.logout();
    } finally {
      watch.restore();
    }

    expect(watch.local).toEqual([]);
    expect(watch.session).toEqual([]);
    expect(watch.cookies).toEqual([]);
  });

  // The control for the assertion above. Three `not.toHaveBeenCalled()`s are
  // worth exactly as much as the instrumentation behind them, and instrumentation
  // that watches the wrong object is silent in the same way as code that behaves.
  it('and the watch that says so can see a write when one happens', () => {
    const watch = watchStorage();
    try {
      globalThis.localStorage.setItem('probe', PLAINTEXT);
      globalThis.sessionStorage.setItem('probe', PLAINTEXT);
      document.cookie = 'probe=value';
    } finally {
      watch.restore();
    }

    expect(watch.local).toEqual([['probe', PLAINTEXT]]);
    expect(watch.session).toEqual([['probe', PLAINTEXT]]);
    expect(watch.cookies).toEqual(['probe=value']);
  });
});
