# Typing

Type everything explicitly. A codebase with many small, well-named types is easier to
refactor than one with few large or implicit ones — when in doubt, define more types.

## Rules

- **No `any`.** `any` is always wrong. Use `unknown` for genuinely unknown shapes and
  narrow it, or define the correct type. Use generics, union types, or named interfaces
  rather than falling back to `any`. Never use `as any` to force a cast.
- **Minimal `never`.** `never` is only legitimate as an exhaustiveness check
  (`const _: never = value` in a switch default) or as the return type of a function
  that always throws. Never use `as never` to force a cast.
- **Explicit return types.** Return typed promises and values from all functions and
  methods (`Promise<Article>`, not `Promise<any>` or an inferred `any`).
- **Prefer named types over inline.** Prefer a named `interface` or `type` alias over
  inline object literals. An object shape such as `{ id: string; name: string }`
  repeated twice is already a candidate for a named type.
- **Document every exported type.** All exported `interface`, `type`, and `enum`
  declarations must carry a JSDoc/TSDoc comment explaining their purpose and domain
  meaning.
- **Types live in dedicated files.** Exported `interface` and `type` definitions belong
  in dedicated type files, not inline inside source, component, or entity files.

> The exact directory layout for type files is repo-specific (e.g. `src/common/types/`
> and `src/<module>/types/` in the backend; `app/types/` in the webapp) and is defined
> in each package's `STANDARDS.md`.
