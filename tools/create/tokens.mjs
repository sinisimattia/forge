/** Matches forge tokens only, so `window.__NUXT__` and `__dirname` never trip the guard. */
export const TOKEN_PATTERN = /__FORGE_[A-Z0-9_]*__/g;

/** `my-app` -> `My App` */
export function toTitle(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/** Builds the full token map, deriving anything the caller did not supply. */
export function deriveTokens({ name, title, scope, description, dbName } = {}) {
  if (!name) throw new Error('name is required');
  return {
    __FORGE_NAME__: name,
    __FORGE_TITLE__: title || toTitle(name),
    __FORGE_SCOPE__: scope || `@${name}`,
    __FORGE_DESCRIPTION__: description || '',
    __FORGE_DB_NAME__: dbName || name.replaceAll('-', '_'),
  };
}

/**
 * Replaces known tokens. Unknown tokens are deliberately left in place so
 * `findUnresolved` can fail the run rather than silently emitting a broken file.
 */
export function substitute(text, tokens) {
  return text.replace(TOKEN_PATTERN, (match) =>
    Object.hasOwn(tokens, match) ? tokens[match] : match,
  );
}

/** Distinct forge tokens still present in `text`. */
export function findUnresolved(text) {
  return [...new Set(text.match(TOKEN_PATTERN) ?? [])];
}
