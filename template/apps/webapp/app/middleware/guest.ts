import { useAuthStore } from '~/stores/auth';
import { localRedirect, SIGNED_IN_HOME } from '~/utils/redirect';

/**
 * Lets an anonymous visitor through, and sends a signed-in one onward.
 *
 * The inverse of `middleware/auth.ts`, for the sign-in and registration pages:
 * somebody who is already signed in has no business on either, and showing them
 * an empty password field is how a person ends up signing in twice and rotating
 * a session they were already holding. Nuxt finds it by this file's name too —
 * see the note there.
 *
 * It waits on `initialize()` for the same reason the other one does: before the
 * renewal resolves, everybody looks anonymous.
 *
 * ## This is where the open redirect would be
 *
 * `to.query.redirect` arrives from the URL, which means from whoever wrote the
 * link. Navigating to it unjudged would make this application forward anybody to
 * anywhere on demand, from its own domain, at the exact moment they are
 * expecting to be asked for a password — which is why a sign-in page is the most
 * valuable place in an application to have one. `localRedirect` is what refuses
 * it, and the forms it refuses are enumerated there.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const store = useAuthStore();
  await store.initialize();
  if (!store.isAuthenticated) return;
  return navigateTo(localRedirect(to.query.redirect, SIGNED_IN_HOME));
});
