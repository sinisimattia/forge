# Phase 1 — Decision Log

The rulings made while building Forge's Phase 1, preserved from the execution ledger so they
survive it. Each records what was decided, why, and what it costs if the decision was wrong.

Read this before reversing anything here: several of these look like arbitrary style choices and
are not — they were made after a specific failure was observed and reproduced.

**The five worth knowing before you touch the code:**

1. **The base `tsconfig.json` deliberately does not set `module`/`moduleResolution`.** It once set
   `moduleResolution: "Bundler"`, which makes any CommonJS package extending it fail with `TS5095`
   — verified against tsc 5.9.3. NestJS emits CommonJS. Each package owns both options.
2. **Generation stages in a sibling of the target, never `os.tmpdir()`.** `fs.rename` across
   filesystems fails with `EXDEV`, and the temp directory is frequently a different filesystem.
   Staging as a sibling is what makes the final move atomic.
3. **`createProject` has no `fs.rm(target)` before the rename.** `isEmptyDir` already guarantees the
   target is absent or empty, and `rename` replaces an empty directory atomically. Deleting first
   opened a delete-then-fail window on the only line in the codebase that removes anything.
4. **Adopt mode never deletes and never overwrites.** It writes into a user's real repository, so a
   failure reports what landed rather than rolling back. Deleting someone's files on error is worse
   than leaving them named.
5. **Domain greps must be substring, not word-boundary.** `\bevent\b` cannot match `events`,
   `eventId` or `userPaymentSummaryByEvent`. That blind spot shipped three domain names into the
   standards docs before a reviewer caught it.

---

## Ruling: workspace layout
Ruling: work in-place on a branch in /Users/sinisimattia/Progetti/forge rather than a git
worktree — the plan hardcodes that absolute path in nearly every command, and a worktree path
would invalidate them. Cost if wrong: none material; the branch still isolates from main.

## Pre-flight conflict scan

### Cross-task interface rows (producer -> consumer)
| From | To | Produced vs consumed | Finding |
|---|---|---|---|
| T1 | T3 | `substitute`, `findUnresolved` | agree |
| T1 | T4 | `substitute`, `findUnresolved` | agree |
| T1 | T6 | `deriveTokens`, `toTitle` | agree |
| T2 | T6 | `parseArgs`, `UsageError` | agree |
| T3 | T4 | `walk`, `isBinary`, `UnresolvedTokenError` | agree (Interfaces block corrected pre-flight in plan self-review) |
| T3 | T6 | `copyTree` | agree |
| T4 | T6 | `copySubset` | agree |
| T5 | T6 | `buildReceipt`, `forgeCommit(root)`, `initRepo(dir,title)` | agree |
| T1 | T13 | `package.json` created then modified (adds `sanitize`) | agree; T13 declares it under Modify |
| T6 | T13,T14 | `generate({argv,templateRoot,forgeRoot,interactive})` | agree; both call sites identical |
| T7 | T8 | ADR filenames 0001-0004, `agent-playbook.md` | agree; T8 Step 5 repoints links |
| T7 | T10,T11,T12 | Article/Comment/Tag vocabulary | agree |
| T8 | T10,T11,T12 | reviewer requires `## Review dimensions` per package | agree; T10 S5, T11 S6, T12 S5 each supply one |
| T9 | T11,T12,T14 | compose service names postgres/backend/webapp | agree |
| T9 | T13 | root scripts lint/typecheck/test/build | agree |
| T9 | T14 | `.env.example` -> `.env`, stack must boot | **DEFECT D-A** (see rulings) |
| T9 | T10 | nx.json `purity` target default | agree; T10 adds the target to libs/core |
| T10 | T11,T12 | `__FORGE_SCOPE__/core` dependency | agree |
| T10 | T13 | `npm run purity -w libs/core` | agree |
| T11 | T14 | `GET /health` -> `{"status":"ok"}` | agree |
| T13 | T15 | `sanitize` script | agree; CI runs it |

### Per-task self-consistency rows
| Task | Tests vs code it specifies | Finding |
|---|---|---|
| T1 | 7 tests vs tokens.mjs | consistent |
| T2 | 8 tests vs args.mjs; `out` default matches `?? process.cwd()` | consistent |
| T3 | 8 tests vs copy.mjs; walk(root,prefix) compatible with declared walk(root) | consistent |
| T4 | 3 tests vs subset.mjs | consistent |
| T5 | 2 tests vs receipt.mjs | consistent |
| T6 | 6 tests vs index.mjs; empty-target check precedes staging, so the "no leftovers" assertion holds | consistent |
| T7 | extraction + acceptance grep | consistent |
| T8 | extraction + acceptance grep | **DEFECT D-B** (see rulings) |
| T9 | config authoring | consistent apart from D-A |
| T10 | 4 DomainError tests + D2/D14 injection steps; `import.meta.dirname` needs Node >=20.11, satisfied | consistent |
| T11 | 1 health test; AppModule not instantiated by the unit test, so no DATABASE_URL needed at test time | consistent |
| T12 | 3 AppButton tests; Vue 3.5 reactive props destructure available in Nuxt 4 | consistent |
| T13 | gate test vs scripts defined in T9/T10 | consistent |
| T14 | e2e vs T9 service names and T11 endpoint | consistent |
| T15 | CI vs scripts defined in T13 | consistent |

## Ruling: D-A — the generated stack could not boot
Finding: T9 Step 4 wrote `POSTGRES_PASSWORD=` (empty) in `.env.example`, and T14 copies that file
to `.env` and expects the stack to come up. The official postgres image refuses to initialize
without a password or an explicit auth method, so T14 would always fail.
Ruling: follow Voku's actual approach — `compose.yaml` carries fixed, obviously-local dev
credentials inline; `.env.example` drops `POSTGRES_PASSWORD` entirely and its `DATABASE_URL`
embeds the same local credential. `compose.prod.yaml` reads every credential from the
environment with no default. This boots, keeps `.env.example` free of populated secrets, and
leaves the sanitize gate meaningful.
Cost if wrong: a dev-only credential is visible in compose.yaml — the same exposure Voku already
accepts, and production reads from the environment.

## Ruling: D-B — BSD sed silently ignores \b
Finding: T8 Step 2 used `sed -i '' -e 's|\bVoku\b|...|g'`. Verified on this machine: BSD sed
does not support `\b`, exits 0, and changes nothing — a silent no-op the implementer would then
fight. (`grep -E '\b...'` does work here and is unaffected.)
Ruling: replace the sed pass with `perl -pi -e` using ASCII-only patterns. Verified that
`perl -pi -e` performs the substitution correctly and passes UTF-8 bytes (em dash, U+2016)
through untouched when pattern and replacement are ASCII.
Cost if wrong: none; both tools are present and the acceptance grep still gates the step.

## Ruling: D-C — missing .npmrc would break npm install
Finding: host Node is v26.5.0 while the template pins `engines: >=22 <23`. `engine-strict` resolves
to false, so that pin is advisory and does not block installs — no action needed. However, Voku's
`.npmrc` carries `legacy-peer-deps=true`, and Task 9's copy list omitted `.npmrc` entirely. The
Nuxt/Storybook dependency graph is why Voku needs it, so a generated project would very likely fail
`npm install` with ERESOLVE at the Task 13 gate.
Ruling: add `.npmrc` to Task 9's copy list and to its Create list, with a note on why it matters.
Cost if wrong: a redundant one-line config file in generated projects.

Note: host verification steps run on Node 26 rather than 22. The Dockerfiles pin 22, so Task 14 is
unaffected. If a host-side gate fails in a way that smells version-specific, re-run it in the
container before treating it as a code defect.
## Ruling: controller error — git add -A swept the implementer's work
Finding: I ran `git add -A` for the .npmrc plan fix while the Task 1 implementer was concurrently
writing files, so its four files landed in my commit 343cd9c under the wrong message. My error,
not the implementer's; it correctly reported the mismatch as a concern.
Ruling: tagged `sdd-recovery-343cd9c` as a safety anchor, then `git reset --soft` and re-committed
as two logical commits (c118a83 plan fix, 51c7d2c Task 1). Verified `git diff sdd-recovery..HEAD`
is empty, so content is byte-identical. Branch is local and unpushed, so the rewrite is safe.
Going forward: stage explicit paths, never `git add -A`, while a subagent is live.
Cost if wrong: none; the anchor tag still points at the pre-repair state.

## Ruling: D-D — the plan's `node --test <dir>` command does not work
Finding: the Task 1 brief specified `"test": "node --test tests/unit"`. Verified on this machine
(Node v26.5.0): a directory argument is treated as a test FILE and reports `✖ tests/unit
'test failed'` with 0 tests run. The implementer deviated to a glob and flagged it.
Ruling: accept the implementer's glob form (`node --test 'tests/unit/**/*.test.mjs'`) — verified
7/7 passing with pristine output — and correct the plan for both `test` and `test:integration` so
Task 15's CI does not inherit a command that silently runs nothing.
Cost if wrong: none; the glob is the documented Node form and was verified working.

Task 1: implementer DONE_WITH_CONCERNS, both concerns valid and upheld.
Task 1: minor (deferred): deriveTokens uses `||` fallbacks, so an explicit empty-string override
  (e.g. title: '') is discarded in favour of the derived value. Plan-mandated — copied from the
  brief's own reference implementation. No current call site passes an explicit blank; would need
  `??` or per-field Object.hasOwn to distinguish "explicitly blank" from "not given".
Task 1: complete (commits c118a83..51c7d2c, review clean)
## Ruling: Task 2 Important finding (plan-mandated) — UPHELD
Finding: `parseArgs` used truthiness (`if (parsed.into)`, `if (parsed.name)`, `if (parsed.out)`)
for presence, while using `!== undefined` ten lines below for the same kind of check. Two real
bugs follow: `--into '' --name y` skips adopt mode and returns a create-mode result carrying a
bogus empty `into`; `--into /tmp/x --name ''` silently permits the combination the spec forbids.
Ruling: UPHELD, not parked. The finding is inherited verbatim from my own brief, but the plan
authoring its own bug is not a defence — the spec's exclusivity rule is the binding authority and
the code violates it. Fixed at the source (plan corrected: `!== undefined` throughout, plus an
explicit empty-`--into` rejection) and sent to the implementer as fix round 1 with three boundary
tests that must fail before the fix.
Cost if wrong: none identified; the change makes two checks agree with a style already in the file.

## Ruling: Task 2 ⚠️ item — --into with flags other than --name/--out
Finding: reviewer could not tell whether `--into --title` etc. is intended.
Ruling: intentional for `--title` — Task 6's `adoptInto` consumes `args.title ?? toTitle(name)`.
`--scope`, `--description` and `--db-name` are accepted but unused in adopt mode. Leaving them as
silent no-ops rather than hard errors; a generated token map still needs scope/description values,
and rejecting them buys nothing. Recorded rather than actioned.
Cost if wrong: a user passing --scope with --into sees it ignored instead of an error.

Task 2: minor (deferred): `value.startsWith('--')` rejects legitimate free-text values beginning
  with `--` (e.g. --description "--fast and modern"). Plan-mandated; fail-loud is defensible.
Task 2: minor (deferred): repeated flags silently last-wins, undocumented and untested.
Task 2: fix round 1/5 (1 addressed, 0 open; commits 7b5af9a..cc77f69)
Task 2: Ruling: re-reviewer called the "three discriminating tests" mandate two-thirds met, because
  `rejects an empty --name` already passed pre-fix (NAME_RE rejects ''). Not a shortfall — my fix
  message explicitly anticipated this ("may already pass ... that is fine and expected"). It stands
  as a regression test. The two tests that matter were independently traced as genuinely failing
  against the old code. Cost if wrong: one test documents rather than discriminates.
Task 2: complete (commits 7443200..cc77f69, review clean after 1 fix round)
Task 3: minor (deferred): symlinks are silently dropped by `walk` — a Dirent for a symlink reports
  neither isFile() nor isDirectory(), so a symlinked file under template/ vanishes with no error.
  Inert today (no symlink exists in the template) but inconsistent with the fail-loudly philosophy.
Task 3: minor (deferred): `copyTree` uses fs.writeFile, which does not preserve mode, so an
  executable bit would be lost. Inert today — template/libs/core/scripts/check-purity.mjs carries a
  shebang but is invoked as `node ./scripts/check-purity.mjs`, so it never needs +x. Would bite the
  first time someone adds a real shell script to the template.
Task 3: minor (deferred): asymmetric UnresolvedTokenError messages (`in path "x"` vs `in x`).
Task 3: complete (commits cc77f69..98d1e55, review clean)
## Ruling: Task 4 Important #1 — partial-result reporting UPHELD, rollback REJECTED
Finding: adopt mode writes directly into the user's real repository with no staging directory. If
the unresolved-token guard throws mid-walk, files already written stay on disk and the caller gets
no list of them; a corrected re-run then reports those tool-written files as "skipped", making them
indistinguishable from genuine pre-existing user files.
Ruling: UPHELD as to reporting, REJECTED as to rollback. The error now carries `written` and
`skipped` so the CLI can say exactly what landed. I deliberately did NOT add rollback: deleting
files out of a user's real repository on error is a worse failure than leaving them, and adopt mode
must never delete. Note this cannot fire for a well-formed template (deriveTokens always supplies
all five tokens), so it is robustness against a template-authoring bug, not a live defect.
Cost if wrong: a failed adopt still leaves files behind — but now they are named, not silent.

## Ruling: Task 4 Important #2 — asymmetric token guard UPHELD
Finding: `copySubset` ran findUnresolved on contents only, while its sibling `copyTree` guards both
the destination path and the contents. Inert today (none of the nine subset entries contain a token
in its path) but an incomplete implementation of the global constraint, which is not qualified to
contents.
Ruling: UPHELD. Added the same path guard copyTree uses. Cheap, removes a latent inconsistency
between sibling modules, and is testable via a `docs/standards/__FORGE_*__.md` fixture.
Cost if wrong: none identified.

Task 4: minor (deferred): per-file copy body is near-duplicated between copyTree and copySubset;
  worth a shared helper if a third copy variant appears.
Task 4: minor (deferred): only 2 of 9 PROCESS_SUBSET entries are asserted as positive cases.
Task 4: minor (deferred): no test mixes a write and a skip in one copySubset invocation.
Task 4: ⚠️ carried forward — reviewer could not confirm the four convention ADRs exist at the exact
  subset paths; if a filename differs, walk() silently never yields it and no test catches it.
  MUST be checked when Task 7 creates them (it names the same four filenames) and again at Task 13's
  inventory assertion.
Task 4: fix round 1/5 (2 addressed, 0 open; commits 79b8187..2a9d322)
Task 4: PROCESS SIGNAL — the implementer's RED evidence for the partial-write test quoted an error
  message belonging to the OTHER test (assert.rejects validator text against a plain try/catch test).
  The re-reviewer caught it by tracing the pre-fix code independently and confirmed the test does
  discriminate. Code correct, evidence inaccurate. This is exactly the failure mode
  [[sdd-verify-tests-discriminate]] warns about: pasted evidence is not evidence. Keep requiring
  independent traces rather than accepting RED logs at face value.
Task 4: minor (deferred): the catch block's `error.written = ...` would TypeError if a non-Error
  primitive were ever thrown; no such throw site exists today.
Task 4: complete (commits 98d1e55..2a9d322, review clean after 1 fix round)
Task 5: complete (commits 2a9d322..316fe6d, review clean, zero findings)
Task 5: carried into Task 6 — reviewer verified that a git identity failure (user.name/user.email
  unset, e.g. a CI container) surfaces as exit code 3 via main()'s catch-all, and that the generated
  project is left on disk rather than deleted. This is contingent on Task 6 landing as briefed;
  confirm it when Task 6 is reviewed.
Task 5: controller-verified directly (git.mjs has no unit tests by brief design): forgeCommit
  returns a short SHA in a repo and 'unknown' outside one; initRepo produces a clean initial commit;
  the forge repo itself was untouched by the exercise.
## Ruling: Task 6 — brief self-contradiction, implementer's resolution ACCEPTED
Finding (raised by the implementer, not the reviewer): the brief's `adoptInto` rejected any target
where `isEmptyDir(target)` is true, but the brief's own test 6 creates an EMPTY directory with
fs.mkdir and expects adopt mode to succeed. The literal brief code fails its own test.
Ruling: the implementer's fix is correct and better than the brief. It added a narrow `dirExists`
(existence-only) used solely by adoptInto, leaving `isEmptyDir` for createProject. Adopting into an
existing-but-empty directory is a legitimate flow (`git init my-repo && forge --into my-repo`);
only a MISSING target should redirect to create mode. Plan corrected to match, error message
narrowed from "does not exist or is empty" to "does not exist".
Cost if wrong: adopt would populate a directory the user created but had not yet put anything in —
which is exactly what they asked for.

## Honest note on my own pre-flight scan
My pre-flight table marked Task 6 "consistent" on the row asking whether its tests agree with the
code it specifies. That was wrong — this contradiction was sitting in the brief and the scan missed
it. The implementer caught it by running the literal brief code first. Lesson: the scan reads for
contradictions but does not execute; an implementer running the code is a stronger check than my
reading of it, and DONE_WITH_CONCERNS asking me to confirm intent is exactly the right escalation.

Task 6: controller-verified end to end against the fixture — create mode substitutes tokens in
  contents and paths, writes a 4-key receipt, git-inits with the right message; adopt mode into an
  existing empty dir derives "Billover" from the basename and leaks no non-subset file; zero
  .forge-staging-* leftovers in any case.
Task 6: fix round 1/5 (4 addressed, 0 open; commits 80f2ab3..cffd2f1)
Task 6: Ruling: PARKED — main()'s catch reports error.written but not error.skipped, though the
  finding named both. Parked rather than looped: skipped files are untouched by definition so no
  data is at risk, and the loop cost exceeds the value. FOR THE FINAL REVIEW'S FIX WAVE.
Task 6: Ruling: PARKED — no automated test exercises main()'s reporting block; Finding 4's fix
  rests on manual verification only. main() is a deliberately thin wrapper around generate(), and a
  child_process-based subprocess test is better added once, alongside Task 15's CI work, than
  bolted on mid-loop. FOR THE FINAL REVIEW'S FIX WAVE.
Task 6: PROCESS NOTE — the implementer volunteered that 3 of its 5 new tests do not discriminate
  the bugs they guard, rather than claiming five clean red-greens. The re-reviewer independently
  traced all three claims and confirmed them. This is the behaviour to keep reinforcing.
Task 6: minor (deferred): fs.rename replacing an empty directory is POSIX behaviour; on Windows it
  typically fails. Pre-existing assumption, flagged for whoever owns cross-platform support.
Task 6: minor (deferred): a stray non-directory file at the target path makes isEmptyDir throw
  ENOTDIR, surfacing as a raw exit 3 rather than a friendly conflict message.
Task 6: minor (deferred): git-init failure after a successful rename exits 3 though most of the run
  succeeded and the project is intact on disk.
Task 6: complete (commits 316fe6d..cffd2f1, review clean after 1 fix round, 2 parked)
## Ruling: Task 7 — ADR README copied vs authored, implementer's call ACCEPTED
Finding (raised by the implementer): the brief's Step 5 said to `cp` Voku's docs/adrs/README.md,
but that file's index lists all 18 of Voku's real ADRs (Stripe, refunds, guest auth) — itself a
major Voku trace, directly contradicting the zero-traces global constraint. It authored a fresh
index over the five template ADRs instead.
Ruling: ACCEPTED. The global constraint outranks a literal brief step; copying it verbatim would
have failed the very grep the same brief mandates. Plan corrected to say "author, do not copy".
Cost if wrong: none — a later task wanting to own that file would simply rewrite it.

Task 7: ⚠️ CLOSED (carried from Task 4) — all four convention ADRs exist at exactly the paths
  subset.mjs hardcodes; inSubset() returns true for each. Verified by the controller directly, not
  only by the implementer. Adopt mode will really copy them.
Task 7: controller-verified: zero Voku traces, zero domain vocabulary, zero secrets, only
  __FORGE_SCOPE__/__FORGE_TITLE__ tokens present, 22 files created, Voku clean at fdfdbde.
## Ruling: Task 7 Important — rfcs/README.md wording
Finding: the file says shapes "belong in `__FORGE_SCOPE__/core`" where the brief's literal text said
`libs/core`. The only one of five mandated READMEs altered from "use these exactly".
Ruling: the brief was right; revert to `libs/core`. That sentence is about where code physically
belongs, so the directory is the accurate referent — `__FORGE_SCOPE__/core` is the import specifier,
and using a package name for a "belongs in" statement is a small category error. PARKED for the
final review's fix wave rather than spending a resume+re-review cycle on one word.
Cost if wrong: one sentence names the package instead of the directory; nothing dangles either way.

## Ruling: Task 7 minors — both ACCEPTED as-is, no change
- data-conventions.md dropped an RFC link and an ADR-0007 footnote instead of renaming them.
  ACCEPTED: renaming would have produced a link to a nonexistent template file or invented an ADR
  that does not exist in the template's set. Correct judgment, and it was disclosed rather than hidden.
- ADR-0003 dropped its source's "Scope" carve-out section rather than generalizing it. ACCEPTED:
  the five directory READMEs cover the same ground independently.

Task 7: reviewer verified fidelity directly — all 9 standards files diffed line-by-line against
  their Voku originals, all 4 source ADRs read in full, every internal cross-reference resolved.
  No rule's substance changed; only nouns and two link targets. Zero dangling links in 22 files.
Task 7: complete (commits cffd2f1..c7d8cea, review clean, 1 parked)
## Ruling: CONTROLLER DEFECT — my domain greps were structurally blind
Finding (raised by the Task 8 implementer): every verification grep I wrote used word boundaries
(`\bevent\b`), which cannot match `events`, `eventId` or `userPaymentSummaryByEvent`. Task 7 passed
that grep, passed its fidelity review, and I signed it off while three Voku domain names sat in
docs/standards/naming.md. The D5 sanitize gate I designed as the backstop would not have caught
them either — its rules were /voku/i and /\b(rsvp|stripe)\b/i.
Ruling: my defect, upheld in full. Fixed at three levels: (1) every extraction grep in the plan is
now substring-based with hand triage; (2) sanitize.mjs gains identifier-shaped rules
(`\b(event|payment|ticket)(?=[A-Z])`, `[a-z](Event|Payment|Ticket)`, and a module-filename rule)
while deliberately NOT flagging bare words, since "emitted events" (Vue) and "issue tickets" are
legitimate; (3) Task 7's three traces corrected in db28aec.
Cost if wrong: the identifier rules could false-positive on a legitimate camelCase identifier
containing these words; triage is by hand, so a human sees it.

Task 7: fix (post-completion) — 3 domain nouns replaced in naming.md (db28aec). Widened sweep across
  all of template/ now yields only genuine false positives (`prevent`, `eventually`) and legitimate
  generic usage ("issue tickets", Vue "emitted events"). Controller-verified.

## Ruling: Task 8 — `e.g. docs/rfcs/0001-article-data-model.md` references are FINE
Finding: two files reference an RFC that does not exist in the template.
Ruling: not an instance of the dangling-pointer class. Both are prefixed `e.g.` and illustrate a
NAMING CONVENTION rather than asserting a file exists — materially different from an agent claiming
a file holds endpoint contracts. No change.
Cost if wrong: a reader follows an example filename and finds nothing; the "e.g." signals otherwise.

Task 8: fix round 1/5 (2 addressed, 0 open; commits f2f068c..d987b83)
Task 8: the sweep I required turned 1 finding into 2 — the second (4 pointers to nonexistent
  docs/architecture/{system-overview,backend,frontend}.md, with planner.md additionally
  CONTRADICTING ADR-0003 on where module conventions live) was rated Minor by the reviewer but was
  the more serious of the two. Re-reviewer confirmed all three agents now agree with ADR-0003 and
  with each other, not merely differently.
Task 8: minor (deferred): docs/adrs/ ships 0000-template.md but docs/rfcs/ has no equivalent —
  asymmetric, and it leaves the "e.g." RFC references with nothing concrete behind them. PLAN GAP,
  not an implementation defect. FOR THE FINAL REVIEW'S FIX WAVE.
Task 8: minor (deferred): reviewer.md's synthetic `missing-table` finding hardcodes
  severity "blocking" while the surrounding rule is "read severity from the row".
Task 8: complete (commits 9194f7b..d987b83, review clean after 1 fix round)
## Ruling: Task 9 Important #1 — base tsconfig landmine, UPHELD (highest-value catch so far)
Finding: tsconfig.base.json set `module: ESNext` + `moduleResolution: Bundler`. A package extending
it and overriding only `module` — exactly what a NestJS app must do, since Nest emits CommonJS —
fails with TS5095. I verified this empirically with tsc 5.9.3 rather than reasoning about it, and
verified that a base omitting both compiles cleanly in that scenario.
Ruling: UPHELD. Fixed as a design correction, not a patch: a shared base has no business choosing a
module system when NestJS needs commonjs and Nuxt/core need bundler resolution. Both keys removed;
each package owns its own. Post-fix I compiled a NestJS-style and a core/Nuxt-style fixture against
the real base — both clean.
Why this mattered: the failure would have surfaced two tasks later inside Task 13's typecheck gate,
as a cryptic error about a file nobody had just touched. Note the file was PRE-APPROVED by me as an
accepted deviation; it only got caught because I asked the reviewer to check whether the invented
config would fight Tasks 10-12, and it went and found that it would.
Cost if wrong: none identified; both package shapes verified compiling.

## Ruling: Task 9 Important #2, #3 and Minor #4 — all UPHELD and fixed
- compose.yaml's header pointed at .env.example for four port-override variables that were not
  there. Added as a commented block; re-reviewer confirmed all four names and defaults match what
  compose actually reads.
- .env.example used `postgres://` while compose used `postgresql://`. Now character-identical.
- webapp's depends_on had no health condition while compose.prod.yaml's did. Now waits on
  service_healthy; re-reviewer confirmed the postgres->backend->webapp chain is acyclic and bounded.

## Ruling: Task 9 — three implementer deviations ACCEPTED
- tsconfig.base.json invented (brief listed it, no step defined it, source project has no root
  tsconfig). Accepted; then immediately became Important #1 above.
- ci.yml kept nx-set-shas + $NX_BASE/$NX_HEAD over my literal `--base=origin/main`, because a
  hardcoded base breaks `nx affected` on push events. Correctness over literal compliance.
- JWT secrets dropped from both compose files — no auth exists in this phase; inventing the
  interface would pre-empt Plan 2.

Task 9: fix round 1/5 (4 addressed, 0 open; commits dffb30a..3ec8b44)
Task 9: minor (deferred): the brief's "Files: Create" header omits .dockerignore though Step 3
  requires it — brief-authoring gap, file was created correctly.
Task 9: complete (commits d987b83..3ec8b44, review clean after 1 fix round)
## Ruling: Task 10 — two more brief defects, implementer's fixes ACCEPTED
1. My Step 2 bundled `ConformanceExpect` and `ConformanceRunner` into one file, contradicting the
   "one file per symbol" rule that the SAME task writes into libs/core/STANDARDS.md. Split into
   ConformanceRunner.ts with index.ts and jest coverage exclusions updated. ACCEPTED — a brief that
   violates the standard it is authoring is self-evidently the thing to fix.
2. My Step 3 eslint.config.mjs, written verbatim, failed `nx lint core` with 6 `no-undef` errors:
   the js/mjs override set sourceType but declared no Node globals, so `module`/`console`/`process`
   in jest.config.js and check-purity.mjs were undefined. Implementer added a `globals` map and
   re-verified D2 still discriminates afterwards. ACCEPTED.
Cost if wrong: none identified; all four gates pass in a generated project.

Task 10: D2 and D14 CONTROLLER-VERIFIED, not taken on report. I injected the faults myself in the
  generated project:
  - D2: `import type { Repository } from 'typeorm'` -> @typescript-eslint/no-restricted-imports
    rejected it. This proves the typescript-eslint variant was necessary: the base ESLint rule does
    not see `import type` specifiers, so a framework TYPE import would have slipped through.
  - D14: a TSDoc line "Returns the JWT issued for the session cookie" with no import at all ->
    purity script flagged both `jwt` and `cookie` with file:line.
  Both removed afterwards; lint and purity confirmed clean again.
Task 10: controller-verified structure — 20 files, subpath-only exports (shared/errors, shared/
  testing, shared/types), core sets its own module:preserve + moduleResolution:bundler now that the
  base no longer does, `## Review dimensions` table present for the reviewer contract, and the
  purity target registered in project.json so nx run-many picks it up.
## Ruling: Task 10 Important x4 — purity guard holes, ALL UPHELD
The guard passed D2 and D14 and still leaked. Three concrete holes, none exotic:
1. `if (line.includes('://')) return;` exempted the WHOLE LINE, so any TSDoc carrying a @see link
   silently disabled the prose check for that line. Fixed: strip only the URL span, keep the rest
   of the line under scrutiny.
2. `\bword\b` patterns missed camelCase/PascalCase/snake_case compounds — `SessionCookie`,
   `useCookie`, `HttpClient`, `jwtToken` all evaded every rule. THIS IS THE SAME CLASS OF DEFECT as
   my own grep blind spot in Task 8 (`\bevent\b` cannot match `eventId`). Second occurrence in this
   run. Fixed: unambiguous terms now match as substrings.
3. `['express', /\bexpress\b/i]` false-positived on ordinary English ("must express the invariant").
   Fixed: only the framework spelling (`express.js`, `@express`) is forbidden in prose; a real
   import is lint's job, where there is no ambiguity.
4. `no-restricted-imports` sees only STATIC declarations, so `await import('typeorm')` and
   `require('typeorm')` walked past it — while the config's own comment claimed those packages were
   "structurally unreachable". Fixed with `no-restricted-syntax` selectors for ImportExpression and
   require() calls, scoped to **/*.ts so jest.config.js keeps working. Globs widened from `pkg/*` to
   `pkg/**` so deep subpaths (@nestjs/common/decorators) cannot slip through.
Ruling: all four upheld. Finding 4 matters most against [[simplest-most-secure-default]] — a guard
that ADVERTISES a structural guarantee while only covering static imports is the worst of both: it
stops people looking without stopping the thing.
Cost if wrong: substring matching may false-positive on a legitimate identifier containing these
terms; the messages name file:line so a human adjudicates.

Task 10: CONTROLLER-VERIFIED all 7 injections myself in a generated project, not taken on report:
  cookie+URL -> FAIL (was passing); SessionCookie/HttpClient compound -> FAIL (was passing);
  "must express the invariant" -> PASS (false positive gone); await import('typeorm') -> lint FAIL;
  require('typeorm') -> lint FAIL; D2 static type-import -> lint FAIL (no regression);
  D14 plain JWT prose -> purity FAIL (no regression). Clean baseline restored afterwards.
Task 10: report-accuracy note — the implementer's first report claimed the K5 grep recipe "matches
  Voku's original recipe exactly"; the reviewer grepped Voku and found no such table or recipe
  anywhere. It is new content for this template (correctly so — Task 8 created that contract). The
  implementer corrected its own report. Third evidence-accuracy issue caught by review this run.
Task 10: minor (deferred): ConformanceRunner's three members lack per-member TSDoc while its
  sibling ConformanceExpect documents each — inconsistent with the K5 rule the package ships.
Task 10: fix round 1/5 (4 addressed, 0 open; commits 75f1079..61f8176)
## Ruling: Task 10 fix round 2 — round 1's own fix had introduced a new bypass
Finding: round 1 replaced the whole-line URL exemption with URL-span stripping, but URL_PATTERN
matched ANY `scheme://token` unvalidated. A forbidden word could pose as a scheme and be stripped
with the fake URL: "Uses jwt://placeholder for authentication semantics." -> zero violations. Same
hole as Important 1, relocated from "the whole line is exempt" to "the word, disguised as a scheme".
Ruling: UPHELD, fixed by stripping only `https?://`. Also fixed in the same round: `nest_js_adapter`
(separator class widened to `[._-]`), and bare "Express" — round 1 had traded a false positive for a
false NEGATIVE, so the capitalised proper noun is now matched case-sensitively while the lowercase
English verb stays allowed (dropping /i is deliberate and load-bearing).
CONTROLLER-VERIFIED all 9 cases myself, including one nobody asked for: the template's own neutral
vocabulary ("An Article aggregates Comment and Tag values") does NOT trip any broadened rule — that
was the real risk in widening them.

## Ruling: Task 10 CLOSED at fix round 2 — two Minor residuals PARKED
1. A forbidden word inside a GENUINE https:// URL path is still stripped as collateral
   (`https://docs.example.com/why-jwt-matters`). Distinct from the round-1 defect (the scheme is
   real), and covered in spirit by the new K2 disclaimer but not named by it.
2. Case-sensitive `\bExpress\b` will trip on Title-Case headings ("## Express Field Requirements")
   with no framework intent. More likely in practice than the sentence-initial verb case.
Ruling: PARK both, stop at two rounds. Both are Minor, the guard now catches everything ACCIDENTAL
(its stated job), and K2 explicitly disclaims defending against deliberate evasion. Further rounds
are diminishing returns against an adversary the doc says it does not defend against.
FOR THE FINAL REVIEW'S FIX WAVE: add the URL-path case to K2's named examples (doc-only).
Cost if wrong: someone deliberately hides a term in a URL slug, or reworders one heading.

Task 10: minor (deferred): dropping /i also made `express.js`/`@express` case-sensitive, so
  `EXPRESSJS` no longer matches. Negligible — nobody writes framework names in all-caps.
Task 10: fix round 2/5 (4 addressed, 0 open; commits 61f8176..9cc5346)
Task 10: complete (commits 3ec8b44..9cc5346, review clean after 2 fix rounds, 2 parked)
## Ruling: Task 11 — setGlobalPrefix('api') omission ACCEPTED (brief defect)
Finding (raised by the implementer): the source project's main.ts sets `app.setGlobalPrefix('api')`.
Copying it verbatim would have made the endpoint `/api/health` while the already-committed
compose.yaml healthcheck fetches `/health` — Task 14 would have timed out with no obvious cause.
Ruling: ACCEPTED. Constraint wins over literal copy; documented in the package's CLAUDE.md with an
explicit warning against silently reintroducing it. CI's `curl .../health` independently validates it.

## Ruling: Task 11 Important — cross-task dangling scaffold references, UPHELD
Two clusters, both caused by the INTERACTION of Task 8 (wrote the prompts) and Task 11 (correctly
deleted domain-coupled scaffold). Neither task is wrong alone.
- `src/common/types/enums.ts` x4 across backend-implementer.md, backend-tester.md, planner.md.
  Fixed: now point at `__FORGE_SCOPE__/core/<domain>/enums`, the real per-domain convention.
- backend-tester.md's ENTIRE e2e mode (3 sites) cited `test/*.e2e-spec.ts`, `jest-e2e.json` and
  `npm run test:e2e` — none of which ship. An agent in e2e mode failed on its first command.
  Fixed by making the mode SELF-PROVISIONING rather than deleting it: the prompt now states no
  harness exists and instructs creating it as part of the first e2e request. Deleting the mode would
  have made the prompt honest by removing a real capability; this keeps both.
Design note: this class is invisible to the vocabulary greps used everywhere else — it is about
SCAFFOLD EXISTENCE, not wording. A scaffold-existence sweep is now part of the verification.
Sweep result: 10 dangling references found in total, 9 fixed.

## Ruling: Task 11 — planner.md's flat libs/core paths PARKED (top of the final fix wave)
Finding: planner.md:120,122,125 describe `libs/core/entities/`, `libs/core/contracts/`,
`libs/core/testing/` (flat), but libs/core/STANDARDS.md ships a PER-DOMAIN convention
(`libs/core/src/<domain>/entities/` etc.). Predates Task 11 and is outside its scope; the
implementer correctly refused to expand silently.
Ruling: PARK, but flag as the HIGHEST-PRIORITY item in the final fix wave. `planner` is the agent
that proposes structure, so a wrong layout here propagates into every feature of every generated
project — more impactful than its "minor" framing suggests. Three lines in one file.
Cost if wrong: a generated project's planner proposes a flat core layout that contradicts the
package's own standards, and an implementer either follows it or has to reconcile it.

Task 11: minor (deferred): apps/backend/Dockerfile COPYs apps/webapp/package.json, so a literal
  `docker compose build` fails today on the backend image too. Expected mid-sequence; Task 12 fixes
  it by existing. Task 14 is the real gate.
Task 11: fix round 1/5 (2 clusters addressed, 1 parked; commits 79d09d6..0e9b92a)
Task 11: minor (deferred): backend-tester.md's self-provisioning e2e paragraph names jest-e2e.json,
  the test:e2e script and the .e2e-spec.ts files, but not `supertest`/`@types/supertest`. An agent
  would scaffold correctly and then fail on the first conventional Nest e2e spec with "cannot find
  module 'supertest'". One sentence. FOR THE FINAL FIX WAVE.
Task 11: re-reviewer confirmed `/<domain>/enums` is a genuine importable subpath, not just a
  directory — the mechanism is proven by the existing ./shared/* exports using the identical pattern;
  no ./<domain>/* entry exists yet only because no domain exists yet.
Task 11: complete (commits 9cc5346..0e9b92a, review clean after 1 fix round, 1 parked)
## Ruling: Task 12 Important x4 — ALL UPHELD
1. FOUR of eight review-dimension signals had CONFIRMED false negatives. The reviewer executed each
   grep against a synthetic violation: W2 missed `$fetch(` (no literal "fetcher" substring), W3
   missed `text-[#ff0000]` (the very example the prose two lines above forbids), W4 missed
   `(foo as any).bar` (a cast, not an annotation), W6 missed `<span>Submit</span>`. A row whose
   signal cannot fire is worse than no row — it buys false confidence. All four replaced; I verified
   the new ones fire on my own synthetic violations.
   Beyond fixing the four, I required a constructed violation + demonstrated fire for ALL EIGHT,
   with explicit permission to report "this row cannot be grepped, the LLM must read the page".
   An honest unfireable row beats one that looks executable and silently isn't.
2. The AppButton suite could not catch an implementation that IGNORES the disabled prop and
   hardcodes `:disabled="true"` — no test asserted absence. Same for a variant computed returning
   both class sets. Two tests added and red/green flipped for real this time.
3. index.vue used raw h1/p, contradicting the atoms-only rule the same package ships — and index.vue
   is the first file anyone copies. Rejected both easy fixes: weakening the rule leaves a standard
   nobody follows, adding atoms blows the deliberate one-atom scope. Instead the placeholder is
   HONESTLY EXEMPT and explicitly disposable, in both STANDARDS.md and a comment in the file itself.
4. Strictness hole verified against the source project's real generated .nuxt tsconfigs: all four set
   strict:true but NONE sets noUnusedLocals/noUnusedParameters/noImplicitReturns, which the other two
   packages inherit from tsconfig.base.json — and eslint.config.base.mjs carries only @stylistic
   rules, so there was no backstop. Fixed via nuxt.config's `typescript.tsConfig.compilerOptions`.

## Note: a grep-wrapper warning I could NOT reproduce
The implementer reported that this session's `grep` wrapper forces -G ahead of user flags and
silently no-ops `{n,}` interval patterns in -E mode. I tested it directly: `grep`, `command grep`
and `/usr/bin/grep` all return identical results for an interval pattern here. The wrapper exists
(grep is a shell function) but I could not reproduce the failure. My own sweeps used no `{n,}`
intervals in any case, so the verification in this ledger stands. Recording the claim unadopted
rather than either ignoring it or treating it as established.

Task 12: CONTROLLER-VERIFIED: all four repaired signals fire on synthetic violations; 5 tests
  present; placeholder exemption in both STANDARDS.md and index.vue; strictness config shipped with
  a comment explaining why it is restated rather than inherited; stub forward-guidance names useHead.
Task 12: NOT independently verified by me: the empirical strictness flip (the generated project had
  been cleaned up). The implementer captured verbatim TS6133 output; Task 13's gate run exercises it.
Task 12: fix round 1/5 (4 addressed, 0 open; commits 6d8df1c..6e67e68)
## Ruling: Task 12 CLOSED at fix round 1 — two Minors PARKED
1. W1's signal catches only cross-level ("leapfrog") imports; the Atomic Design table it enforces
   ALSO forbids same-level imports (atom->atom, molecule->molecule), which no grep covers. AND the
   fix report claimed an atom->atom fixture fired, which is impossible under the shipped pattern —
   the atoms grep only matches `(molecules|organisms|templates)`. The row is not dead (the
   molecule->organism half genuinely fires) but the claim was wrong.
2. W6's signal still contains `{2,}`. The reviewer's argument is strong and I accept it: the
   interval is NOT load-bearing — `[A-Za-z][A-Za-z]+` is identical in meaning — and the risk is
   asymmetric, because a silently no-op'd signal reads exactly like a clean codebase. Rewriting it
   removes a portability trap regardless of whose shell is right about the -G wrapper.
Ruling: PARK both for the final fix wave. Neither rises to Important; both are single-line edits in
one file; the wave is one dispatch. Cost if wrong: W1 misses sibling-layer imports, and W6 could
silently never fire in some future environment.

## PATTERN: evidence accuracy — FOUR occurrences now
1. Task 4: RED log pasted from a different test.
2. Task 10: K5 recipe described as copied from the source project; it exists nowhere there.
3. Task 12 (first pass): red/green flip claimed, then candidly retracted as inspection-only —
   and the inspection had missed two real failure modes.
4. Task 12 (fix round): a fixture claimed to fire that could not have under the shipped pattern.
In every case a reviewer caught it by tracing the code rather than reading the report. This is
[[sdd-verify-tests-discriminate]] generalised: a claim about evidence is not evidence. Keep
requiring independent traces, and keep treating candid self-retraction (occurrence 3) as the
behaviour to reward — it was the only one the implementer caught itself.

Task 12: fix round 1/5 (4 addressed, 0 open, 2 parked; commits 6d8df1c..6e67e68)
Task 12: complete (commits 0e9b92a..6e67e68, review clean after 1 fix round, 2 parked)

=== ALL THREE PACKAGES COMPLETE. 12/15 tasks done. Remaining: the gates. ===
## Ruling: Task 13 — sanitize.mjs matched its own source, implementer's fix ACCEPTED
Finding: the brief's literal sanitize.mjs, once placed in tools/, matches its own rule literals and
comments — 7 lines of its own source contain terms it forbids. It would have failed on EVERY clean
checkout, so the gate could never pass and would have been disabled or deleted by the first person
to hit it. Fixed by excluding the script's own resolved path, the same way a linter excludes its
own config. Plan corrected at source (8cfb502).

## Task 13 RESULT — the headline claim is now automated
16/16 integration tests, ~144s. The gate test itself (124.8s) runs, inside a freshly generated
project: lint 3.4s, typecheck 3.8s, test 2.1s, build 5.5s, core purity 0.2s. Plus a file-inventory
assertion (18.9s) and D5 (0.08s).
CONTROLLER-VERIFIED independently: sanitize clean on the real template; a `voku` line injected into
template/README.md -> caught; `const x = getEventId();` -> caught (identifier-shaped leak); clean
again after each revert.

## Handling note: a forced handback, handled well
The implementer was cut off mid-run and reported exactly what was verified vs not, refused to commit
before the gate was green, flagged its own double-backgrounding mistake, and left instructions to
check `ps` and the log before re-running. That last instruction is what let me recover the completed
result instead of burning another 144s run. A fabricated "it passed" would have been far worse than
the honest partial — this is the behaviour to keep rewarding.

## Ruling: Task 13's two self-identified blind spots — ROUTED, not dismissed
(a) STORYBOOK IS ENTIRELY UNEXERCISED. Verified myself: `build-storybook` is a separate nx target in
    template/apps/webapp/project.json, so `nx run-many -t build` never invokes it and a broken story
    passes every check. ROUTE TO TASK 15: add it to the PR-tier CI rather than the default gate,
    since a Storybook build is slow and the default gate should stay usable.
(b) The generated project's own .github/workflows/ci.yml is never parsed — a YAML error or bad job
    name ships silently. PARK with rationale: validating it needs a YAML parser, and forge's
    zero-dependency constraint is a deliberate architectural choice I am not trading away for this.
    Document as a known limitation in forge's README/ADRs at Task 15.
(c) File inventory asserts existence, not contents — accepted for Phase 1; it mainly affects prose
    files nothing compiles against.
Cost if wrong: a template ships with broken stories or an invalid workflow, caught on first use
rather than at generation.
## Ruling: Task 13 Important x2 — demonstrated sanitize leak shapes, UPHELD
The reviewer ran the actual RULES array against test lines rather than reasoning about it:
1. PascalCase domain classes/interfaces evaded EVERY rule — `export class EventsModule {}`,
   `export class PaymentService {}`, `export interface Event {}` all produced NO MATCH. Rule 3 needs
   a lowercase prefix; rule 4 needs a preceding lowercase letter, which a space is not. This is the
   single most likely shape a real domain leak takes in a NestJS/TS codebase. I verified a
   capital-letter rule is safe: zero capitalised domain words exist anywhere in template/.
2. Colon-style populated secrets evaded the rule — it matched only `KEY=value`, while the scanned
   files (compose.yaml, compose.prod.yaml, ci.yml) all use YAML's `KEY: value`.

## CONTROLLER DEFECT: my own prescribed regex was wrong, and the implementer caught it FIRST
My FIX 2 regex used a negative lookahead anchored at the match site. But
`POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}` contains "PASSWORD" TWICE — once as the exempt
YAML key, once nested inside the interpolation's own `:?required` operator — and a match-site
lookahead cannot see that the second occurrence is inside `${...}`. It would have matched
`?required}` as a populated value, false-positiving on compose.prod.yaml and contradicting my own
required verification #4.
The implementer tested my regex against the real file BEFORE applying it, found the flaw, and
replaced the lookahead with `stripInterpolations()` — strip `${...}` spans, then run the rule. That
is the correct shape: the constraint is about position in the line, which a lookahead cannot express.
Testing a prescription before adopting it is exactly the behaviour to reward.

## Design note: deliberate exemptions are VISIBLE, not silent
ci.yml legitimately holds a throwaway CI password. Rather than loosen the rule (which would miss
real secrets) or special-case the filename (invisible, and it rots), deliberate literals carry an
inline `# sanitize:allow` marker with a reason, and the gate PRINTS every exemption it honoured:
  Sanitization: clean (1 deliberate exemption(s))
    template/.github/workflows/ci.yml:40  ... # sanitize:allow — throwaway CI container
An exemption nobody can see is how a gate stops gating.

## Ruling: two reviewer findings NOT actioned — recorded with reasons
- "The generated project's own tests may be vacuous." Real and deep — it is
  [[sdd-verify-tests-discriminate]] applied one level down, to the TEMPLATE's tests rather than
  forge's. Detecting it needs mutation-style testing. PARKED as the natural home for a future
  D-series test; out of Phase 1 scope.
- "Leftover __FORGE_*__ tokens could ship in prose." I tested it: a generated project contains
  leftover tokens in exactly ONE file, forge.json, because the receipt's `tokens` map uses the token
  names as KEYS — intentional. Any other unresolved token hard-fails generation via findUnresolved.
  NOT a real gap. Reviewers earn trust by being right often, not always; adopting this would have
  added a test asserting something the generator already guarantees.

Task 13: CONTROLLER-VERIFIED all 8 injections independently, including the interpolation case my own
  regex would have broken. Exemption reporting confirmed working. Integration: 16/16, ~96s.
Task 13: fix round 1/5 (2 addressed + 1 controller-defect fixed, 0 open; commits 460d228..d1c7275)
## Ruling: Task 13 fix round 2 — three bypasses + one latent false positive, ALL UPHELD
- UPPER_SNAKE domain constants (`EVENT_CREATED`, `PAYMENT_STATUS`) evaded every rule — all the
  identifier rules are case-sensitive against lowercase stems. Added a dedicated uppercase rule.
- The populated-secret rule had no /i, so `{ password: 'x' }` and `"password": "x"` — the
  conventional casing in a Nest/Nuxt codebase — evaded entirely. Verified /i is safe first.
- `PRIVATE_KEY`/`ACCESS_KEY`/`DB_PASS` were not in the key list.
- LATENT FALSE POSITIVE, the most important of the four: `\b(Event|Payment|Ticket)` has no trailing
  boundary and matches "Eventually". Not present in the template today, so nothing failed yet — but
  the first doc that opens a sentence with it fails the gate on ordinary English. That is the
  cries-wolf failure that gets a gate switched off, which costs more than the leaks it catches.
  Fixed with `\bEvent(?!ual)`, verified both directions: rejects Eventually/Eventual, still matches
  EventsModule/Event/PaymentService/Payments/TicketingModule.

## CONTROLLER DEFECT x2 (again) — both caught by the implementer testing before applying
1. My Fix D added `CREDENTIALS?` to the secret-key list. It false-positives on
   `template/apps/backend/src/main.ts:27` — `app.enableCors({ origin, credentials: true })`, a
   boolean CORS flag. My own finding never named CREDENTIALS; dropping it costs nothing.
2. My Fix E said to test the file path against `RULES` verbatim. That does NOT catch the fixture my
   own verification #6 demanded (`docs/events-overview.md`), because those rules are deliberately
   identifier-shaped TO AVOID PROSE FALSE POSITIVES — and a path is never prose, so the restriction
   has no reason to apply there. The implementer added a separate `PATH_ONLY_RULES` matching bare
   domain words for paths only, and verified zero false positives against every real path first.
   That reasoning is better than mine was.
This is the second and third time this run that a prescription of mine was wrong and the implementer
caught it by testing first. Pattern worth keeping: a controller instruction is a hypothesis.

Task 13: CONTROLLER-VERIFIED all 9 cases independently, including "Eventually" now passing and a
  path-only leak (`docs/events-overview.md` containing only the word "placeholder") being caught.
  PATH_ONLY_RULES confirmed to match zero real paths in template/ and tools/.
Task 13: fix round 2/5 (4 addressed + 2 controller defects fixed, 0 open; commits d1c7275..678d4c2)
Task 13: minor (deferred): `sanitize:allow` is whole-line rather than per-rule, so a marked line
  skips every rule. Fine at one exemption, printed on every run. TRIGGER TO REVISIT: if exemptions
  ever exceed one, tighten to `# sanitize:allow:<rule>`.
Task 13: complete (commits 6e67e68..678d4c2, review clean after 2 fix rounds, 1 parked)

=== 13/15. Integration: 16/16. Remaining: Docker boot (T14), forge's own CI (T15). ===
## Task 14 RESULT — the stack actually boots
17/17 integration tests. The generated stack came up under Docker and returned a real HTTP 200 with
body {"status":"ok"}. ~93s. Skip path verified (16 pass / 1 skipped without FORGE_E2E=1). Cleanup
verified clean after BOTH a failing and a successful run — zero leftover containers or volumes.

## Ruling: Task 14 — port 5432 conflict handled by avoidance, NOT by touching the user's work
Port 5432 on this machine is bound by `contents-backend-db-1`, a Postgres from one of Mattia's
OTHER projects, up 13 hours. I did not stop, pause or reconfigure it and neither did the implementer.
The test asks the OS for three free ports via `net.createServer().listen(0)` and publishes through
the POSTGRES_PORT/BACKEND_PORT/WEBAPP_PORT overrides rather than hardcoding. Structural fix, and the
unrelated container was never at risk.

## Ruling: TEMPLATE DEFECT found via Task 14 — the containerisation promise is FALSE
Finding: the brief's e2e snippet omitted `npm install` before `docker compose up`, and the first run
failed with "package-lock.json: not found". Chasing it revealed the real problem is in the template,
not the test:
  - template/CLAUDE.md:28-29 promises "The host Node version is irrelevant — everything runs in
    containers."
  - BOTH Dockerfiles do `COPY package.json package-lock.json ...` and `RUN npm ci`.
  - The template ships NO package-lock.json (it is generated by the user's first `npm install`).
  => `npm run dev:up` cannot work until the user runs `npm install` ON THE HOST, using exactly the
     host Node the root CLAUDE.md says is irrelevant. The README's quick start does list
     `npm install` first, so the documented path works — but the CLAUDE.md claim is untrue, and it
     is in the first file anyone reads.
Ruling: FIX IT PROPERLY IN THE FINAL WAVE rather than weakening the promise. Make both Dockerfiles
tolerate a missing lockfile:
    COPY package.json nx.json .npmrc ./
    COPY package-lock.json* ./
    RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
That keeps reproducible installs when a lockfile exists AND makes the advertised one-command flow
true. Second-choice fallback if that proves unworkable: correct CLAUDE.md to say the host needs Node
once to generate the lockfile. Prefer making the promise true over making it smaller.
Cost if wrong: a Docker layer does a non-reproducible install on first boot; the lockfile path is
unchanged for everyone who has run npm install.

Task 14: self-identified gaps (accepted, documented): the webapp is never asserted on (compose
  defines no healthcheck for it, only depends_on); `restart: unless-stopped` means a crash-looping
  backend is caught at the 300s --wait-timeout rather than instantly, though diagnostics are
  attached; /health does not independently re-prove DB connectivity beyond what migration-run needed.

## ==== TRIAGE FOR THE FINAL FIX WAVE (one dispatch) ====
21 deferred items accumulated. Most are documented observations, not defects worth a change. These
are the ones that affect a real user of a generated project, in priority order:

A. FIX IN THE WAVE
 A1. [Task 14, HIGHEST] The containerisation promise is FALSE. template/CLAUDE.md:28 says "The host
     Node version is irrelevant — everything runs in containers", but both Dockerfiles `COPY
     package-lock.json` + `npm ci` and the template ships no lockfile, so `npm run dev:up` cannot
     work until the user runs `npm install` on the host. Fix the Dockerfiles to tolerate a missing
     lockfile (`COPY package-lock.json*` + `npm ci` falling back to `npm install`) so the promise
     becomes true. Do NOT just weaken the sentence.
 A2. [Task 11, HIGH] planner.md:120,122,125 describe a FLAT libs/core layout (`libs/core/entities/`)
     while the shipped convention is per-domain (`libs/core/src/<domain>/entities/`). planner is the
     agent that proposes structure, so this propagates into every feature of every generated project.
 A3. [Task 12] W1's signal misses same-level imports (atom->atom), which the Atomic Design table also
     forbids. And W6's signal still contains `{2,}` — rewrite as `[A-Za-z][A-Za-z]+` to remove a
     portability trap, since a silently no-op'd signal reads exactly like a clean codebase.
 A4. [Task 6] main()'s catch reports error.written but not error.skipped, though both are attached.
 A5. [Task 7] rfcs/README.md says shapes "belong in `__FORGE_SCOPE__/core`" where it should say
     `libs/core` — that sentence is about physical location, so the directory is the right referent.
 A6. [Task 11] backend-tester.md's self-provisioning e2e paragraph should name `supertest`/
     `@types/supertest` as devDependencies to add, or the first conventional Nest e2e spec fails on
     a missing module.
 A7. [Task 8] docs/rfcs/ has no 0000-template.md while docs/adrs/ does — asymmetric, and it leaves
     the "e.g. docs/rfcs/0001-..." references with nothing concrete behind them.
 A8. [Task 10] K2's disclaimer names line-splitting and homoglyphs but not the URL-path case
     (a forbidden word inside a genuine https:// path is stripped as collateral). Doc-only.

B. LEAVE DOCUMENTED — real but not worth a change now
 deriveTokens `||` vs `??`; `--`-prefixed free-text values rejected; repeated flags last-wins;
 symlinks dropped by walk; file mode not preserved; asymmetric UnresolvedTokenError messages;
 copyTree/copySubset body duplication; 2-of-9 PROCESS_SUBSET positive cases; no mixed write+skip
 test; non-Error throwable in the catch; POSIX-only rename; ENOTDIR at target surfaces as exit 3;
 git-init failure exits 3 though the project is intact; missing-table hardcoded severity;
 .dockerignore brief-header gap (file exists, header omitted it); ConformanceRunner per-member
 TSDoc; EXPRESSJS all-caps no longer matched; sanitize:allow whole-line granularity (has a stated
 trigger: revisit if exemptions ever exceed one).

C. OUT OF PHASE 1 — named so they are not lost
 The generated project's own tests are never checked for discrimination (mutation-style testing);
 the generated ci.yml is never parsed (needs a YAML parser, which the zero-dep constraint forbids);
 Storybook is unexercised (ROUTED TO TASK 15's PR-tier CI); /health has no DB code path so it can
 never fail from a database fault; "migrations ran" is vacuous while src/db/migrations holds only
 .gitkeep.
## Ruling: Task 14 Important x2 — UPHELD and fixed
1. A fixed Compose project name defeated the temp-dir isolation. `generate()` resolves `<out>/<name>`
   and the test hardcoded `--name dockerapp`, so the basename Compose keys off was ALWAYS
   `dockerapp` — same container names, same `dockerapp_pgdata` volume, every run. On the one exit
   path a `finally` cannot cover (process killed), the next run would silently attach to the stale
   project and REUSE the leftover volume rather than create a fresh one. The temp directory gave the
   appearance of isolation while the fixed name threw it away.
   Fixed with a per-run `-p forge-e2e-<mkdtemp-suffix>` threaded through up/ps/logs/down via one
   `compose()` helper so they cannot drift — a `down` that disagrees with `up` tears down nothing,
   silently. Re-reviewer confirmed the derivation keys off `out` (which always contains the fixed
   `forge-docker-` literal) rather than `target`'s basename, so it inherits mkdtemp's collision
   guarantee and can never strip to empty.
2. BACKEND_DEBUG_PORT (9229, the Node inspector default) was never overridden while compose
   publishes it. Same flake class the dynamic-port work existed to eliminate. Fixed; re-reviewer
   confirmed all four published ports are now overridden and none is left to chance.

## Verification note: the decoy-volume proof
I required proof of isolation rather than another passing run, because the happy path looks
identical either way. The implementer created `dockerapp_pgdata` by hand, ran the e2e, and showed
the decoy's CreatedAt was unchanged AND that it stayed empty (no PG_VERSION) — never attached —
then removed it. That is the right shape of evidence: watch the guard NOT do the wrong thing.

## Ruling: the orphaned-volume trade is CORRECT but must be documented
A per-run project name means a killed run's volume is never reused — but nothing deletes it either,
so each killed run leaves one inert `forge-e2e-*_pgdata` behind. This is the right trade: a visible,
discoverable leftover beats a silent reuse that breaks the fresh-database invariant. Undocumented
though — the code comment explains the old bug, not the new consequence. ONE LINE, into the wave.

Task 14: fix round 1/5 (2 addressed, 0 open; commits 3e8bdc4..4193716)
Task 14: CONTROLLER-VERIFIED: -p threaded through all four compose calls via one helper; four ports
  allocated; zero forge-e2e/dockerapp leftovers; the user's unrelated contents-backend-* containers
  untouched at the same uptimes; Voku clean at fdfdbde.
Task 14: complete (commits 678d4c2..4193716, review clean after 1 fix round)

## Added to the final fix wave
 A9. [Task 14] One-line comment in docker.test.mjs noting that killed runs now leave a permanently
     orphaned forge-e2e-*_pgdata volume rather than a reused one, so the trade is discoverable.
## CONTROLLER DEFECT: my "npm ci has nothing to install" claim was false
`npm ci` with no lockfile ERRORS with EUSAGE; it is not a no-op. The implementer checked rather than
assuming, and the workflow never invokes it, so nothing broke — but the reasoning I gave was wrong.
Fourth time this run a prescription of mine was incorrect and was caught by testing first.

## MAJOR FINDING: the template ships no lockfile, and it is not just a Docker problem
Adding the Storybook CI job immediately surfaced a real breakage: `build-storybook` FAILS on a
vanilla generated project with `[vite:build-html] Missing field 'moduleType'` — unrelated to story
content. I traced the root cause:
  - template/apps/webapp/package.json pins the SAME version ranges as the source project.
  - The source project HAS a built storybook-static, so this combination worked there.
  - The difference: the source has a package-lock.json pinning exact transitive versions
    (@storybook/builder-vite 9.1.2, @storybook/vue3-vite 9.1.2, @rolldown/pluginutils 1.0.1, ...).
    The template ships none, so every generated project resolves fresh and drifts.

  **>>> CORRECTION (2026-09-18): THIS HYPOTHESIS WAS WRONG. <<<**
  The lockfile was subsequently shipped (template/package-lock.json, 985 KiB / 28,581 lines) and
  `npm ci` in a generated project now works — which DID fix the containerisation promise. But the
  Storybook build **still fails identically**, reproduced twice from two independent lockfile
  refreshes, including an install pinned to the exact versions named above
  (@storybook/builder-vite 9.1.2, @storybook/vue3-vite 9.1.2, @rolldown/pluginutils 1.0.1) that
  this entry believed were the known-good combination. `[vite:build-html] Missing field
  'moduleType'` building iframe.html. **Dependency drift is NOT the cause. The root cause is
  unknown and unfixed.** Forge's storybook CI job remains `continue-on-error: true`. One factor not
  ruled out: all testing ran on host Node 26, not the pinned Node 22.
  Do not re-adopt the drift explanation without new evidence — it has been tested and falsified.
This is the SAME root cause as A1 (Dockerfiles need a lockfile the template lacks). It is broader
than either symptom: GENERATED PROJECTS ARE NOT REPRODUCIBLE. Two builds a week apart can differ.
This is a decision about the template's character (pinned vs floating dependencies) with real
trade-offs both ways, so I am NOT deciding it unilaterally — it goes to Mattia at the end.
Interim: the Storybook job must not ship known-red. Mark it non-blocking with an accurate comment
naming the error and this root cause, so it surfaces the issue without training people to ignore CI.
Task 15: complete (commits 4193716..c1a4633, review APPROVED)
Task 15: reviewer independently re-verified EVERY README claim — commands, flags, file tree, what
  the tests actually run — against the live repo. No drift. Confirmed ADR-0002 connects its decision
  to its real price (no YAML merging => the generated ci.yml cannot be validated), which is exactly
  the "records a consequence, not just a decision" test.

## Added to the final fix wave
 A10. [Task 15] ci.yml:90 and the README's CI section cite ADR-0002 to explain why the storybook job
      is non-blocking, but ADR-0002 is about the GENERATOR's dependency-freedom; the real cause is
      the TEMPLATE's missing lockfile. Repoint the citation to the README's own "Generated projects
      are not reproducible" bullet, which already self-contains the explanation. Do NOT write a
      fourth ADR for it — the reproducibility decision is escalated to Mattia and not yet made, so
      recording it as decided would be wrong.
 A11. [Task 15] forge's own ci.yml has no top-level `permissions: contents: read`, while the
      template's workflow sets it. Cheap hardening, and an inconsistency with the posture the
      template itself models.

=== ALL 15 TASKS COMPLETE. Proceeding to the final whole-branch review. ===
