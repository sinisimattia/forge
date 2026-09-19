/**
 * The one formatter, fixed to UTC, used everywhere an instant is shown.
 *
 * **UTC and an explicit locale, both deliberately.** A date rendered with the
 * ambient locale and time zone is formatted once on the server and again in the
 * browser, and the two machines rarely agree: Nuxt hydrates, finds different
 * text in the same node, and warns — or silently patches — on every page that
 * shows a timestamp. Pinning both makes the two renders identical by
 * construction rather than by luck.
 *
 * `en` rather than the active locale because `en` is this application's only
 * locale (`docs/standards/i18n.md`). A deployment that adds a second one changes
 * this function, and changes it in one place.
 */
const INSTANT_FORMAT = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/**
 * An instant, as a person reads it.
 *
 * @param instant - the moment to render, or `null` when there is none
 * @param fallback - what to render instead of a null instant
 * @returns the formatted instant, or `fallback`
 */
export function formatInstant(instant: Date | null, fallback: string): string {
  return instant === null ? fallback : INSTANT_FORMAT.format(instant);
}
