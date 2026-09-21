import { defineStore } from 'pinia';
import { AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import type { AuthenticationOutcome, ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import { assertNever } from '__FORGE_SCOPE__/core/shared/policies';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import type { UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { createApiClient, postLogout, postRefresh } from '~/fetchers';
import { AuthHttpService } from '~/services';
import type { ApiClient } from '~/types';
import { createAuthFetch } from '~/utils/authFetch';

/**
 * The three things the application can know about who is looking at it.
 *
 * **A boolean cannot say the third one**, and the third one is the whole
 * experience of a page load. With `isAuthenticated: boolean`, "nobody is signed
 * in" and "nobody has asked yet" are the same value, so every protected page
 * renders its signed-out state for a frame and then replaces it — a flash of the
 * wrong answer on every navigation, and a redirect to the sign-in page for a
 * person who was signed in the whole time.
 *
 * `UNKNOWN` is therefore the value a fresh store starts at, and the middleware
 * waits on it rather than deciding from it.
 */
export const AUTH_STATUSES = ['unknown', 'authenticated', 'anonymous'] as const;

/** One of the three {@link AUTH_STATUSES}. */
export type AuthStatus = typeof AUTH_STATUSES[number];

/**
 * Nothing is known about the client, which is what a browser really knows.
 *
 * `AuthenticationAttempt` carries a `ClientContext` because the contract's other
 * implementation — the backend's — observes one. This side cannot: the network
 * address is decided by the network and the label by the user agent, and both
 * are facts about the request that only the serving side can read. Sending a
 * value here would be this application asserting something about itself that it
 * has no way to prove, which is exactly what `postLogin` refuses to do.
 */
const NO_CLIENT: ClientContext = { address: null, label: null };

/**
 * Who is signed in, the credential that proves it, and the four things that
 * change either.
 *
 * ## Where the credential lives, and where it does not
 *
 * In memory, in `accessToken`, and nowhere else — not in `localStorage`, not in
 * `sessionStorage`, not in a cookie this code can write (DEC-3). That is a
 * decision rather than an omission, so it has its own test: the store's spec
 * installs a recording `Storage` over both of them and a recording setter over
 * `document.cookie`, and asserts that nothing was written to any of the three.
 * Reading a key back instead would pass for an application that stores nothing,
 * for one that stores under a different key, and for one with no storage at all;
 * a later commit that adds "remember me" will write **through the API**, not to
 * a key anybody guessed in advance.
 *
 * The consequence is the reason this store is more than a box: a full page load
 * begins with nothing, so being signed in has to be re-established from the
 * renewal cookie before anything can be rendered. That is `renew`, and it is
 * driven **twice per page load, once on each side** —
 * `plugins/auth-init.server.ts` and then `plugins/auth-init.client.ts`.
 *
 * Twice, because "nowhere else" now includes the SSR payload: the server's
 * credential stays in the server's memory and the browser earns its own. What
 * crosses is `status` and the person, which is all the no-flash behaviour ever
 * needed — see {@link AUTH_STATUSES}. See {@link heldCredential} for the one
 * line that decides it and the test that pins it.
 *
 * ## Why the transport is owned here and can be replaced
 *
 * The client presents `accessToken` on every request, and `accessToken` is this
 * store's own state — so a transport handed in from outside would need a way to
 * read back into here, and the two would have to be built in a cycle. It is
 * built here instead.
 *
 * {@link adoptTransport} exists because the **server** genuinely needs a
 * different one, not because a test wanted a seam: under SSR the backend is at a
 * different address, the renewal cookie has to be copied out of the incoming
 * request by hand, and the `Set-Cookie` that comes back has to be copied onto
 * the outgoing response. None of that is true in a browser, and all of it has to
 * be true for the whole of one render. Its other callers are the specs — the
 * store's, the two middleware specs' shared harness, and the composables' —
 * which drive **this** store, the shipped actions rather than a re-declaration
 * of them in a fixture, against a model of the backend.
 */
export const useAuthStore = defineStore('auth', () => {
  /**
   * The credential presented on ordinary requests, or `null`.
   *
   * **Not returned from this setup function, and that is the whole of the
   * decision.** Pinia sorts what a setup store returns: a plain `ref` becomes
   * *state* and lands in `pinia.state.value`, a `computed` becomes a *getter* and
   * does not. `@pinia/nuxt` then assigns `pinia.state.value` to
   * `nuxtApp.payload.pinia` on `app:rendered`, and Nuxt serialises the payload
   * into the HTML. So a ref here is a bearer credential in the markup for its
   * whole 15-minute lifetime, and the only thing standing between the two is
   * which kind of reactive object leaves this function.
   *
   * That is invisible to every reader and to the type system — `accessToken`
   * below reads identically either way — so it is pinned by a test that asserts
   * on `pinia.state.value`, the object that actually travels, rather than on the
   * store property: `plugins/__tests__/auth-init.server.spec.ts` → *seeds status
   * and the user but never the credential*.
   *
   * The credential therefore lives in memory on each side separately, and the
   * browser gets its own by renewing once on hydration
   * (`plugins/auth-init.client.ts`). The cost of that is a second rotation per
   * page load, which is why {@link renew} being idempotent and that plugin
   * running after pinia's are both load-bearing rather than tidy.
   */
  const heldCredential = ref<string | null>(null);

  /**
   * The credential, readable and not writable, and **a getter on purpose**.
   *
   * A `computed` rather than the ref itself, because Pinia serialises state and
   * not getters — see {@link heldCredential}. Nothing outside this store may set
   * it, which is also true and much less important than where it does not go.
   */
  const accessToken = computed<string | null>(() => heldCredential.value);

  /**
   * The signed-in person as the wire carries them, or `null`.
   *
   * The wire shape and not the entity, because this is state: it is serialized
   * into the SSR payload, and a `User` is a class with methods and `Date` fields
   * that no payload serializer will reproduce. {@link currentUser} is the
   * entity, rebuilt from this.
   */
  const user = ref<UserJSON | null>(null);

  /** One of {@link AUTH_STATUSES}. Starts at `unknown`, never returns to it. */
  const status = ref<AuthStatus>('unknown');

  /** The signed-in person, or `null`. Core's entity, with its invariants re-run. */
  const currentUser = computed<User | null>(
    () => (user.value === null ? null : User.fromJSON(user.value)),
  );

  /**
   * Whether somebody is signed in.
   *
   * `false` while the answer is still `unknown`, which is why nothing may
   * *decide* from this: a guard that redirects on `!isAuthenticated` redirects
   * every visitor on every full page load. Guards wait for `status` first.
   */
  const isAuthenticated = computed(() => status.value === 'authenticated');

  /** The transport as it comes, with no renewal behaviour. Renewal goes out on this. */
  let transport: ApiClient = defaultTransport();

  /** The transport everything else goes out on: `transport`, plus renew-once-and-retry. */
  let guarded: ApiClient = createAuthFetch({ inner: transport, presented, awaitingRenewal, renew });

  /** The contract implementation, rebuilt whenever the transport underneath it is. */
  let service = new AuthHttpService(guarded);

  /**
   * The one renewal that is currently in flight, or `null`.
   *
   * A closure variable rather than state, which matters twice: it is a promise,
   * so it could not be serialized into the SSR payload, and it is per-store, so
   * on the server one request's renewal is never visible to another's.
   */
  let inFlight: Promise<boolean> | null = null;

  /** The browser's client: the public base, and this store's credential. */
  function defaultTransport(): ApiClient {
    const config = useRuntimeConfig();
    // `apiBaseServer` is the address the backend answers on from *inside* the
    // deployment, which is a different host under compose. It is empty unless a
    // deployment sets it.
    const serverBase = import.meta.server && config.apiBaseServer !== '' ? config.apiBaseServer : '';
    return createApiClient({
      baseUrl: serverBase === '' ? config.public.apiBase : serverBase,
      credential: () => heldCredential.value,
    });
  }

  /**
   * Replaces the transport for the rest of this store's life.
   *
   * @param client - the client every subsequent request goes out on
   */
  function adoptTransport(client: ApiClient): void {
    transport = client;
    guarded = createAuthFetch({ inner: transport, presented, awaitingRenewal, renew });
    service = new AuthHttpService(guarded);
  }

  /** The credential the transport is presenting, for `createAuthFetch` to judge a 401 by. */
  function presented(): string | null {
    return heldCredential.value;
  }

  /**
   * Whether this store believes in a session it has not yet earned a credential
   * for — "I have not renewed yet", as opposed to "my renewal was refused".
   *
   * It is exactly one state, and it exists for exactly one moment: the browser
   * has hydrated `status: 'authenticated'` out of the SSR payload, which only a
   * successful server-side renewal puts there, and {@link heldCredential} is
   * `null`, which is now always true on the client until
   * `plugins/auth-init.client.ts` finishes. A request that lapses into that
   * window presents nothing and is refused with the same bare `401` a mistyped
   * password produces, and `createAuthFetch` needs the two apart — see its own
   * documentation for why "presented nothing" alone stopped being enough.
   *
   * **A refused renewal cannot reach this**, which is what keeps the sign-out bug
   * fixed rather than re-opened: {@link attemptRenewal} calls {@link forget} on
   * every failure, and `forget` sets `anonymous`. So the moment a renewal is
   * refused this answers `false` for the rest of the page's life, and a second
   * refusal — a mistyped password at sign-in, on a store nobody has signed into —
   * is back on the rethrow branch where it belongs. The two remaining statuses
   * say the same thing from the other side: `unknown` is a store nobody has asked
   * about, `anonymous` is one that asked and was told no. Neither is a session.
   */
  function awaitingRenewal(): boolean {
    return status.value === 'authenticated' && heldCredential.value === null;
  }

  /** Takes up what a sign-in or a renewal answered with. */
  function accept(person: UserJSON, credential: string): void {
    heldCredential.value = credential;
    user.value = person;
    status.value = 'authenticated';
  }

  /**
   * Takes up a fresh copy of the signed-in person, and nothing else.
   *
   * It exists for one caller — `useProfile`, after a save — and the narrowness is
   * the point: a save answers with the person's new record, and every screen that
   * shows a name reads this store, so without this the header keeps the old name
   * until the next full page load. It replaces **only** the person: not the
   * credential, not the status, because a profile update is not a session event
   * and nothing about who is signed in has changed.
   *
   * The guard is not defensive noise. `updateProfile` takes an actor and a target
   * on the contract, so an administrator screen can legitimately answer with
   * somebody else's record; adopting that here would silently swap who the
   * application believes is signed in, and every guard downstream would go on
   * agreeing with it.
   *
   * @param person - the record just read back from the server
   */
  function adoptProfile(person: UserJSON): void {
    if (user.value === null || user.value.id !== person.id) return;
    user.value = person;
  }

  /** Forgets everything, and records that the question has now been answered. */
  function forget(): void {
    heldCredential.value = null;
    user.value = null;
    status.value = 'anonymous';
  }

  /**
   * Proves who somebody is and takes up the session it opened.
   *
   * @param email - the address offered
   * @param secret - the secret offered
   * @returns core's outcome, unchanged — the caller renders from it
   * @throws Error when the sign-in succeeded but handed over no credential,
   * which is a broken `AuthHttpService` rather than a refusal; reporting it as a
   * rejection would put a reason in a field the server never spoke
   */
  async function login(email: string, secret: string): Promise<AuthenticationOutcome> {
    const outcome = await service.authenticate({ email, secret, client: NO_CLIENT });
    switch (outcome.status) {
      case AuthenticationStatus.AUTHENTICATED:
        break;
      case AuthenticationStatus.REJECTED:
        // A refusal is not an error and is not a state change: somebody who was
        // already signed in and mistyped a second password is still signed in.
        return outcome;
      default:
        // Reachable only from outside the type system. A status member added
        // without a branch here is a compile error, which is the whole point: a
        // future member such as MFA_REQUIRED, rendered as a plain sign-in
        // refusal, would be silent and wrong.
        return assertNever(outcome);
    }
    // **Once.** `takeIssuedCredential` clears as it hands over, which is the
    // property `auth.service.seam.spec.ts` pins; reading it twice here would get
    // `null` the second time and look like a bug in the service.
    const issued = service.takeIssuedCredential();
    if (issued === null) {
      forget();
      throw new Error('Sign-in succeeded but no access credential was issued.');
    }
    accept(outcome.user.toJSON(), issued.accessToken);
    return outcome;
  }

  /**
   * The transport everything but renewal goes out on.
   *
   * A function and not a value, because {@link adoptTransport} replaces it: a
   * caller that captured `guarded` at setup time on the server would go on
   * issuing through the browser's client for the whole of that render, with no
   * incoming cookie and nothing relaying the outgoing one.
   *
   * It exists because the other two services — `UserHttpService`,
   * `IdentityHttpService` — have to be built on the **same** transport this
   * store's own service is built on, or they present no credential and never
   * renew. They are not built here: this store is about who is signed in, and
   * owning every service in the application would make it the application. The
   * composables build them, and this is what they build them on.
   *
   * @returns the client that presents the current credential and renews once on a 401
   */
  function authenticatedClient(): ApiClient {
    return guarded;
  }

  /**
   * Replaces the actor's own secret, and takes up the session that opens.
   *
   * **It lives here and not in a composable because of the credential.** The
   * backend ends every session the user holds — the caller's included — and
   * opens a fresh one for the request it is serving, so the answer carries a new
   * access credential exactly as a sign-in does. Whoever calls `changePassword`
   * must take it, and this store is the only thing that can put it anywhere. A
   * composable that called the service and forgot would leave the application
   * presenting a credential the server had just killed, and the symptom would be
   * "changing my password signs me out", arriving one request later.
   *
   * @param currentSecret - the secret held now, as proof it is the same person
   * @param newSecret - the replacement
   * @throws Error when there is nobody signed in to change a secret for
   * @throws Error when the change succeeded but handed over no credential — the
   * session this browser was using is gone either way, so the state is cleared
   * before the throw rather than left claiming a session that no longer exists
   */
  async function changePassword(currentSecret: string, newSecret: string): Promise<void> {
    const actor = user.value?.id;
    if (actor === undefined) throw new Error('Nobody is signed in.');
    await service.changePassword(actor, currentSecret, newSecret);
    // **Once**, for the reason `login` gives: `takeIssuedCredential` clears as it
    // hands over.
    const issued = service.takeIssuedCredential();
    if (issued === null) {
      forget();
      throw new Error('The password was changed but no access credential was issued.');
    }
    heldCredential.value = issued.accessToken;
  }

  /**
   * Ends the session on the server, and forgets it here either way.
   *
   * The local state is cleared in a `finally`, because a browser that cannot
   * reach the backend must still be able to sign out of itself — leaving a name
   * and a credential on screen because a request failed is the worst available
   * answer. The failure is **not** swallowed: the session is still alive on the
   * server, and whoever asked to end it is owed that.
   */
  async function logout(): Promise<void> {
    const actor = user.value?.id;
    try {
      if (actor !== undefined) await postLogout(guarded, actor);
    } finally {
      forget();
    }
  }

  /**
   * Exchanges the renewal cookie for a fresh credential.
   *
   * **Idempotent under concurrency, and that is the whole reason this is a
   * function rather than two lines at each call site.** Several components
   * mounting at once all find the credential lapsed and all ask; without the
   * in-flight promise that is three renewals, of which the second and third
   * present a credential the first has already rotated away. The backend's reuse
   * detection is right to read that as a stolen credential, and it revokes the
   * entire session family — so the user is signed out, at a moment nothing in
   * the code was doing anything unusual. It reads as "I get logged out at
   * random", it is invisible from the happy path, and it is the single most
   * likely way DEC-3 goes wrong in practice.
   *
   * Renewal goes out on `transport` and not on `guarded`: a `401` from the
   * renewal itself must not ask for a renewal, or this promise ends up awaiting
   * itself.
   *
   * @returns whether there is a session afterwards
   */
  function renew(): Promise<boolean> {
    if (inFlight !== null) return inFlight;
    const attempt = attemptRenewal();
    inFlight = attempt;
    // Cleared when it settles, and only if it is still the one in flight, so a
    // renewal that started after this one is not cancelled by this one finishing.
    // `attemptRenewal` never rejects, so there is nothing here to leave unhandled.
    void attempt.finally(() => {
      if (inFlight === attempt) inFlight = null;
    });
    return attempt;
  }

  /** One renewal, which answers rather than throws. */
  async function attemptRenewal(): Promise<boolean> {
    try {
      // `transport` and **not** `guarded`. See `createAuthFetch`'s own comment for
      // what the other one does, and `auth.spec.ts`'s "answers, rather than
      // waiting on itself" for what stops it coming back.
      const body = await postRefresh(transport);
      accept(body.user, body.accessToken);
      return true;
    } catch {
      // Every failure means the same thing to this application: there is no
      // session. `anonymous` rather than `unknown`, because a guard waiting for
      // the question to be answered has to be released — left at `unknown` it
      // waits for a renewal that has already happened and will not happen again.
      forget();
      return false;
    }
  }

  /**
   * Answers the question "is anybody signed in", once.
   *
   * Every guard calls it and it costs one request per page load, because `renew`
   * de-duplicates and because a store that has already answered returns
   * immediately.
   */
  async function initialize(): Promise<void> {
    if (status.value !== 'unknown') return;
    await renew();
  }

  return {
    accessToken,
    user,
    status,
    currentUser,
    isAuthenticated,
    adoptProfile,
    adoptTransport,
    authenticatedClient,
    changePassword,
    login,
    logout,
    renew,
    initialize,
  };
});
