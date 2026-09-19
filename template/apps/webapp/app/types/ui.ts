/**
 * Types describing the component library's own vocabulary — the closed sets a caller has to
 * choose from. They live here rather than inside the components so a page, composable or
 * store can name one (`const icon: IconName = ...`) without importing a `.vue` file.
 */

/**
 * Every glyph `AppIcon` can draw. It is a closed union on purpose: the component holds the
 * path data for exactly these, so a name outside the union has nothing to render and is a
 * compile error rather than an empty `svg`. Add the name here and the definition in
 * `AppIcon.vue` together — `Record<IconName, IconDefinition>` makes adding only one of the
 * two fail to compile.
 */
export type IconName = 'chevron-down' | 'check' | 'card' | 'warning';
