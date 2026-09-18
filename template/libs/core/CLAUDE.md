# __FORGE_TITLE__ Core — Agent Guidance

`libs/core` (`__FORGE_SCOPE__/core`) is the framework-agnostic domain, organized **per domain**
under `src/<domain>/{entities,contracts,enums,errors,types,testing,policies}` (+
`src/shared/{errors,testing,types,policies}`), one file per symbol, consumed via per-domain subpaths
(`__FORGE_SCOPE__/core/<domain>/<folder>`). Unit tests live in `libs/core/tests/`. It is the
**executable source of truth** for the domain (ADR-0003, ADR-0004).

- Local rules: `libs/core/STANDARDS.md`. Shared rules: `docs/standards/*`. **Docs win on conflict.**
- Entity/enum shapes are authoritative in `docs/rfcs/*.md` once a domain RFC exists — do not
  restate them elsewhere.
- Purity is load-bearing: never import a framework package here, and never reference a consuming
  app/framework in comments or TSDoc either — the rule is one-directional (apps may reference
  `__FORGE_SCOPE__/core`; core must be describable without naming any consumer).
- The `core-implementer` and `core-tester` agents own this package; the `reviewer` runs the core-purity dimension on any `libs/core/**` change.
