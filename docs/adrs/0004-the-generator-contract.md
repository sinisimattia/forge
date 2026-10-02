# ADR-0004: The Generator Contract — Tokens, Substitution, Adopt Mode, And The Receipt

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

ADR-0001 settles that `template/` is one tree copied wholesale rather than a layer system.
ADR-0002 settles that the generator depends on nothing but Node. Neither says what the
generator is actually allowed to *do* to that tree on the way out — which strings become
project-specific and which do not, what transforms are permitted, what it writes that was
never in the template at all.

That contract is the thing a maintainer needs before changing `tools/create/` or adding a
file to `template/`, and until this record existed it was written down only in Forge's own
planning material, written before the code and never part of what a maintainer reads. It
also contains one decision that is invisible from the code and reads, to anyone who
greps for it, as dead weight: the `forge.json` receipt that nothing reads.

## Decision

### A token exists where a generated project must differ, and nowhere else

The whole token set is the object `deriveTokens` returns in `tools/create/tokens.mjs` — that
function is the list, and there is no other place a token can be declared. It covers the
things two correct projects generated from Forge cannot share: the project's own name (which
is its npm package name, its directory and its Postgres role), its human-facing title, its
npm scope, its one-line description, and its Postgres database name.

That is the test to apply to a proposed token. *Could two projects generated from Forge both
be correct with the same value here?* If yes, it is not a token — it is content, and it
belongs in `template/` spelled literally. Everything in a generated project that is not one
of those values is identical in every generated project, by construction.

Only `name` is required. Title, scope and database name are derived from it when the caller
does not supply them; description defaults to empty (`tokens.mjs`'s `deriveTokens`). The
prompts fill in nothing else (`tools/create/prompts.mjs` asks for a name and a description,
and only when there is a real terminal to ask on).

The `__FORGE_` prefix is load-bearing, not decoration. The guard that fails the run on a
surviving token matches `/__FORGE_[A-Z0-9_]*__/g` (`TOKEN_PATTERN`, `tokens.mjs`), so a bare
`__NAME__` convention would fire on content the template legitimately ships — Nuxt's
`window.__NUXT__` and `__dirname` are the obvious casualties. `tests/unit/tokens.test.mjs`
and `tests/unit/copy.test.mjs` each pin that distinction with a test.

### Substitution is the only transform

`copyTree` (`tools/create/copy.mjs`) walks the tree, substitutes tokens in each path segment
and in each text file's contents, and writes the result. A file that looks binary — a NUL
byte in its first 8 KiB, `isBinary` in the same file — has its **contents** copied
byte-for-byte. Its path is still substituted: the destination path is computed before the
binary check, so a binary file under a tokenized directory lands where it should.

There is no second transform. No file is parsed, no structure is merged, nothing is
generated from a schema, no section is inserted into a file conditionally. This is ADR-0002's
consequence made concrete: with no dependencies there is no YAML parser and no JSON
deep-merge, so a file that would need assembling from pieces cannot be assembled here and
must instead be shipped complete in `template/`.

The practical form of that rule: **adding a capability to generated projects means adding
complete files to `template/`, never teaching the generator to edit a file.** It is also what
keeps `template/` bootable in place, which is the property ADR-0001 is built on.

The guards all fail rather than emit. `substitute` deliberately leaves an *unknown* token
where it found it, so that `findUnresolved` can abort the run instead of silently writing a
broken file — the comment in `tokens.mjs` says exactly this. `copyTree` applies that check to
the destination path as well as to the contents, and `walk` throws `UnsupportedEntryError`
on anything that is neither a plain file nor a directory, because a symlink that was quietly
skipped would vanish from every generated project with no message.

### Adopt mode is subset selection over the same tree

Adopt mode (`npm run create -- --into <existing-dir>`) is not a second template or a second
code path through the template. It is `copySubset` in `tools/create/subset.mjs`: the same
walk, the same substitution, the same token guards, with a membership filter in front. The
filter is one declared array, `PROCESS_SUBSET`, in which a trailing slash means "this
directory and everything under it" and an entry without one means that exact file. Which form
an entry takes is itself a decision: the agents and the standards are directory prefixes,
because anything added there is more of the same thing; the adoptable ADRs are named one by
one, so that a newly written platform ADR defaults to *out* when nobody thinks about it,
where a range or a glob would have adopted it silently. `subset.mjs`'s own comment carries
the rule that decides which ADRs those are, and `tests/unit/subset.test.mjs` pins it.

**Never-overwrite is adopt mode's safety property, and it is load-bearing in a way create
mode's is not.** Create mode stages into a sibling of the target and renames it into place,
so a failure *during the copy* leaves nothing behind and there is no half-generated
repository to clean up. Adopt mode has no staging directory at all: it writes into a
repository that already exists and that Forge did not create. So it needs two different
properties instead, and has both:

- A destination that already exists is skipped, never written. The existing file stays
  byte-identical and is reported in the closing run report.
- A mid-run failure never rolls back. `copySubset` attaches what it managed to write (and
  what it skipped) to the error and rethrows, and `index.mjs` prints both. Deleting a user's
  files is worse than leaving ours behind for them to review.

### Create mode's one partial success: `initRepo` after the rename

Create mode finishes by initializing a repository in the new project and making a single
initial commit, unless `--no-git` is passed (`tools/create/git.mjs`'s `initRepo`, called from
`index.mjs` after the rename). Adopt mode never does this: it is adding files to a directory
the user already has, and whatever version control that directory is under is theirs. Note
that adopt mode does not *check* for a git history — `adoptInto` requires only that the
target directory exists and that its basename is a valid project name.

That ordering produces the one case where a failed run *does* leave something behind, and it
is deliberate. `initRepo` runs **after** `fs.rename` has already moved the finished tree into
place, so whatever it fails at, a complete and correct project exists at the target. What is
missing depends on which of its three commands failed: `git init` leaves the project with no
repository at all, while a failing `git add` or initial commit leaves a `.git` directory in a
half-initialised state — staged files and no commit. The run still exits non-zero in either
case. The enclosing catch cannot tell any of this from a copy failure — the staging
directory is gone either way — so `index.mjs` rewrites the error message at the throw site
to say the project was created and only git initialization failed, before that information
is lost.

This is the reason the `try`/`catch` around `initRepo` exists, and it is not unreachable
defensive code. A refactor that collapses it into the outer catch does not simplify anything;
it deletes the only place where "your project is fine, run `git init` yourself" can still be
said.

### `forge.json` is a receipt, and nothing reads it

Create mode writes `forge.json` at the root of the new project —
`{ forgeCommit, generatedAt, mode, tokens }`, built by `tools/create/receipt.mjs` and written
in `index.mjs` after the copy completes. Adopt mode writes no receipt: it is adding files to
a project it did not generate, so there is no generation to record.

**Nothing in Forge, and nothing in a generated project, reads this file.** That is not an
oversight and it is not dead code. Deleting it on the grounds that it has no readers is the
specific mistake this section exists to prevent.

The reason it is written is that drift detection — "what has Forge changed since this project
was generated?" — is the one tool that would need it, and it is the one tool that **cannot be
added retroactively**. A project generated without a receipt can never be diffed against its
origin, because the commit it came from is not recoverable from the output: the output is the
template with some names substituted, and a great many commits produce the same output. Every
project generated before a receipt exists is permanently outside the reach of any such tool,
and no later work can bring it back in.

So the receipt costs one small JSON file per generated project and buys the option. Dropping
it forecloses that option for every project generated afterwards, silently, and the cost only
becomes visible years later when somebody wants the tool and finds the data was never
recorded. ADR-0003 states the same point from the other end: the template cannot track
upstream changes automatically, and the receipt is what keeps a deliberate re-sync possible
at all.

One property of the receipt is worth knowing before it reads as a bug: `forge.json` is the
one file in a generated project that legitimately contains `__FORGE_*__` strings. The
`tokens` map uses the token names as its keys — `{"__FORGE_NAME__": "my-app"}` — which is the
whole point of recording them. It is written *after* `copyTree` has finished, so the
unresolved-token guard never sees it, and `tests/integration/create.test.mjs` asserts that
key by name.

### Exit codes are part of the contract

`0` success; `1` a problem with what the caller typed or with the template itself
(`UsageError`, `UnresolvedTokenError`, `UnsupportedEntryError` — each carries its own
`exitCode`); `2` the target directory is the wrong shape for the mode asked for
(`TargetConflictError` — in create mode because it exists and is not empty, in adopt mode
because it does not exist at all); `3` anything else, as the fallback in `index.mjs`'s
`main`.

A CLI whose exit codes are contractual must never exit `0` having done nothing, which is why
a missing name under `--yes`, a non-interactive caller, or a stdin that is not a TTY is a
validation error rather than a prompt nobody can answer (`prompts.mjs`).

## Consequences

### Positive

- Every file in a generated project is a file in `template/` with its tokens replaced.
  `forge.json` is the single exception, and it is purely additive — so "what will a generated
  project contain?" is answered by reading `template/`, with nothing hidden in generator
  logic.
- Create mode's copy has no partial-success mode: a surviving token, an unresolvable
  destination path, an unsupported filesystem entry and a non-empty target each abort before
  anything reaches the target directory. The single exception is `git init` failing after the
  rename, which leaves a complete project and still exits non-zero — described above, and
  reported in the error message rather than inferred.
- Adopt mode and create mode cannot drift apart in how they substitute or guard, because they
  are the same substitution and the same guards over the same tree. The only difference is
  which paths are selected and what happens when a destination already exists.
- The receipt keeps drift tooling buildable later without anyone having to build it now.

### Negative

- **A file that genuinely needs to differ in *shape* between projects has no mechanism.**
  Substitution changes strings; it cannot add, remove or reorder anything. A CI job that
  should exist only for some projects, a module that some projects want and others do not —
  neither is expressible. The only choices are "ship it always" and "ship it never".
- The token set can only grow by hand, in `deriveTokens`, and every token added is a literal
  string that every file in `template/` has to spell exactly right, with no compiler to check
  it. The unresolved-token guard catches a token that nothing defines; it cannot catch a place
  that should have had a token and does not.
- **`forge.json` will keep looking like dead code to anyone who greps for its readers.** This
  ADR is the only thing standing between it and a reasonable-looking cleanup commit.
- Adopt mode's never-overwrite means a repository that already has a `CLAUDE.md` gets none of
  Forge's. The skip is reported, not resolved, and there is no merge — nor could there be, for
  the reason in ADR-0002.
