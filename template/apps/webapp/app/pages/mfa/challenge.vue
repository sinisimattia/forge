<script setup lang="ts">
import { localRedirect, SIGN_IN_PATH, SIGNED_IN_HOME } from '~/utils/redirect';

/**
 * The page a person meets when their password was right and is not enough.
 *
 * Two doors lead here, and they hand over the challenge differently:
 *
 * - **A password sign-in** answered `MFA_REQUIRED`. The store is already
 *   holding the challenge, in memory, by the time this page renders;
 *   `LoginForm` emitted and `login.vue` navigated here.
 * - **A federated sign-in** was redirected here by the backend with the token as
 *   `?challengeToken=`, because a browser redirect had no other channel to
 *   carry it in. That was argued and accepted on one condition, and this page is
 *   where the condition is met.
 *
 * ## Containing a single-use credential that arrived in a URL
 *
 * Three things, each asserted in `pages/__tests__/mfa-challenge.spec.ts`:
 *
 * 1. **It is taken into memory and taken out of the address bar in the same
 *    tick** — and out of the history entry's own state, which the router fills
 *    with the full path (see {@link stripChallengeToken}). `history.replaceState`
 *    rewrites the entry this page is on, so the token is not in the history
 *    list, is not in what "back" returns to, is not what a person copies out of
 *    the address bar, and is not readable from `history.state`. Reading it and
 *    leaving it there would have moved the leak, not closed it.
 * 2. **No `Referer` can carry it.** The page loads nothing cross-origin, and
 *    `nuxt.config.ts` serves this route with `Referrer-Policy: no-referrer` **as
 *    a response header**, which applies to the document's own subresources from
 *    the first request. (A `<meta>` tag added by the page would not: it exists
 *    only after the shell and its scripts have been fetched.) By default a
 *    cross-origin request already gets the origin and no path or query; the
 *    header is the second line, not the first.
 * 3. **It is in memory and nowhere else.** Never a cookie, never storage, and
 *    never the server-rendered payload — which is why `nuxt.config.ts` renders
 *    this route on the client only. Nuxt writes the request URL, query string
 *    included, into the payload of every page it renders on the server, whether
 *    or not the page reads it.
 *
 * What this does not contain: the request line. A web server's access log will
 * hold `GET /mfa/challenge?challengeToken=…` for the one request that loaded the
 * page. The token is single-use and lives minutes, which is what makes that
 * acceptable; nothing here can reach a log that is not this page's to write.
 *
 * The adoption happens in `onMounted`, which does not run on the server, for
 * the same reason.
 *
 * ## Arriving with nothing
 *
 * A reload after the strip, a bookmark, and a link somebody forwarded all land
 * here holding no challenge. There is nothing to ask a second factor of, so the
 * page sends the person to sign in rather than showing a form that cannot be
 * used.
 *
 * ## Where the person goes afterwards
 *
 * `redirectTo` is judged by `localRedirect` before anything acts on it, like
 * every destination that arrives in a query string.
 */
definePageMeta({
  layout: 'auth',
  middleware: 'guest',
  authTitleKey: 'auth.mfa.title',
  authSubtitleKey: 'auth.mfa.subtitle',
});

const { t } = useI18n();
const route = useRoute();
const { challenge, adoptChallenge } = useMfa();

useHead({ title: t('auth.mfa.title') });

/** The one query parameter that carries a credential. */
const TOKEN_PARAMETER = 'challengeToken';

/** Whether arrival has been dealt with. The form is not rendered before it, so it is built with the challenge already held. */
const ready = ref(false);

/** `fullPath` without the token parameter, in the form the router wrote it. */
function withoutToken(fullPath: string): string {
  const hashAt = fullPath.indexOf('#');
  const beforeHash = hashAt === -1 ? fullPath : fullPath.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : fullPath.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  if (queryAt === -1) return fullPath;
  const kept = beforeHash
    .slice(queryAt + 1)
    .split('&')
    .filter((pair) => pair !== '' && keyOf(pair) !== TOKEN_PARAMETER);
  return `${beforeHash.slice(0, queryAt)}${kept.length === 0 ? '' : `?${kept.join('&')}`}${hash}`;
}

function keyOf(pair: string): string {
  const raw = pair.split('=')[0] ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Removes the token from everywhere the browser holds this URL: the address bar
 * **and the history entry's own state**.
 *
 * The second is the one that is easy to miss and was missed. The router keeps
 * `current` — the full path, query included — in `history.state`, so rewriting
 * only the URL leaves the token in an entry that is invisible in the address bar
 * and readable by any same-origin script, and that the browser persists through
 * session restore. Observed in a real build before it was fixed: after the
 * rewrite, `location.search` was clean and `history.state.current` still read
 * `…?challengeToken=…`. The rest of the state — `back`, `forward`, `position`,
 * `scroll` — is the router's and is passed back untouched: replacing it with
 * `null` would make the next in-app navigation think it had nowhere to come from.
 */
function stripChallengeToken(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(TOKEN_PARAMETER)) return;
  url.searchParams.delete(TOKEN_PARAMETER);

  const state: unknown = window.history.state;
  const kept = typeof state === 'object' && state !== null && 'current' in state
    && typeof state.current === 'string'
    ? { ...state, current: withoutToken(state.current) }
    : state;
  window.history.replaceState(kept, '', `${url.pathname}${url.search}${url.hash}`);
}

function destination(): string {
  return localRedirect(route.query.redirectTo, SIGNED_IN_HOME);
}

onMounted(async () => {
  const arriving = route.query[TOKEN_PARAMETER];
  // `adoptChallenge` holds the token and then asks which methods it may be
  // finished with — the list a password sign-in receives inline and a redirect
  // cannot carry. The answer is awaited only after the strip below, so a slow
  // backend never leaves the token in the address bar for the length of the wait.
  const adopting = typeof arriving === 'string' && arriving !== ''
    ? adoptChallenge(arriving)
    : Promise.resolve();
  // Whatever the parameter held — a token, nothing, or a repeated key that
  // arrived as an array — it does not stay in the address bar.
  stripChallengeToken();
  await adopting;

  if (challenge.value === null) {
    const back = localRedirect(route.query.redirectTo, '');
    await navigateTo(back === '' ? SIGN_IN_PATH : `${SIGN_IN_PATH}?redirect=${encodeURIComponent(back)}`);
    return;
  }
  ready.value = true;
});

async function onVerified(): Promise<void> {
  await navigateTo(destination());
}
</script>

<template>
  <AppStack gap="lg">
    <MfaChallengeForm v-if="ready" @verified="onVerified" />
    <AppText v-else>{{ t('common.states.loading') }}</AppText>
  </AppStack>
</template>
