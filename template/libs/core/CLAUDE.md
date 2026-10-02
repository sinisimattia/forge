# __FORGE_TITLE__ Core — Agent Guidance

`libs/core` (`__FORGE_SCOPE__/core`) is the framework-agnostic domain, organized **per domain**
under `src/<domain>/{entities,contracts,enums,errors,types,testing,policies}` (+
`src/shared/{errors,testing,types,policies}`), one file per symbol, consumed via per-domain subpaths
(`__FORGE_SCOPE__/core/<domain>/<folder>`). Unit tests live in `libs/core/tests/`. It is the
**executable source of truth** for the domain (ADR-0003, ADR-0004).

Every folder under `src/` except `shared/` is a domain — a bounded vocabulary named in its own
words, with a contract, the types it moves and a conformance suite — and `ls src/` is the list of
them. A domain has only the subfolders it needs — `organizations/` has no `policies/`,
`authorization/` has neither `entities/` nor `enums/` — so **read the tree rather than any
prose that enumerates it**. `libs/core/README.md` says which departures from "one contract per
domain, one suite per contract" ship and why; the one that matters most when adding an
assertion is the shared-versus-server-only suite split, which that file defines under the
heading "DEC-1 — conformance is split by who can honestly satisfy an assertion", because an
assertion only the implementation that owns the store can honestly satisfy does not belong in
the shared suite.

- Local rules: `libs/core/STANDARDS.md`. Shared rules: `docs/standards/*`. **Docs win on conflict.**
- Entity/enum shapes are authoritative in `docs/rfcs/*.md` once a domain RFC exists — do not
  restate them elsewhere.
- Purity is load-bearing: never import a framework package here, and never reference a consuming
  app/framework in comments or TSDoc either — the rule is one-directional (apps may reference
  `__FORGE_SCOPE__/core`; core must be describable without naming any consumer).
- The `core-implementer` and `core-tester` agents own this package; the `reviewer` runs the core-purity dimension on any `libs/core/**` change.
