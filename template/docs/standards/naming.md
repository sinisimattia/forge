# Naming

Names must be fully readable without prior context. These rules apply to every repo;
framework conventions (Vue `props`/`emit`, NestJS decorators) do not override them.

## Principles

- **Descriptive names over short ones.** Prefer `userCommentSummaryByArticle` over
  `summary`, `articleId` over `id` when context matters. Long, self-documenting names
  are always preferable to short, opaque ones. Long names are fine; ambiguous names
  are not.
- **Semantically meaningful variables.** Every variable name must communicate what it
  holds. Avoid generic names like `tmp`, `x`, `data`, or `obj` without a qualifying
  noun.

## Forbidden abbreviations

Do not use abbreviations of any kind. The following are forbidden, with their required
expansions:

| Forbidden | Use instead |
|-----------|-------------|
| `err` | `error` |
| `evt` | `article` |
| `res` | `response` or `result` |
| `req` | `request` |
| `btn` | `button` |
| `el` | `element` |
| `cb` | `callback` |
| `val` | `value` |
| `msg` | `message` |
| `tmp` / `temp` | name the actual concept |
| `fn` | name the actual function |
| `idx` | `index` |
| `cnt` | `count` |
| `ctx` | `context` |
| `cfg` | `configuration` |
| `opts` | `options` |
| `params` | `parameters` |
| `str` | `string` (name the actual value) |
| `arr` | name the collection (e.g. `articles`) |
| `obj` | name the actual object |
| `num` | name the actual number |
| single-letter loop variables | `index`, `itemIndex`, or use `.map()`/`.forEach()` with descriptive parameter names |

## Acceptable exceptions

These are domain terms or established conventions, not abbreviations:

- `id`
- `url`
- `api`
- `props` (Vue convention)
- `emit` (Vue convention)
