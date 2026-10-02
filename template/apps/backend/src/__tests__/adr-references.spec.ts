import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Every decision record and every document this repository points at has to
 * be a document this repository actually contains.
 *
 * The defect this guards is a citation into something the reader does not
 * have. It is not hypothetical: the source comments here once cited the
 * numbered sections of a design document that belongs to the tool this
 * project was generated from, which no generated project ever receives. Every
 * one of those citations pointed at nothing, in every copy, from the first
 * day. The ADRs under `docs/adrs/` **do** ship with the project, so citing one
 * is safe — as long as the one being cited is really there.
 *
 * Four forms are checked:
 *
 * 1. A repository-relative ADR path, as `CLAUDE.md` and the ESLint rules write
 *    it.
 * 2. A bare `ADR-NNNN`, the form the TypeScript sources use, which has to name
 *    a file in `docs/adrs/`.
 * 3. A relative Markdown link to a `.md` file, which has to resolve from the
 *    directory of the file that writes it. Deleting a document and leaving a
 *    link to it is the same defect arriving from the other side.
 * 4. A repository-relative path to a source file, written to point a reader at
 *    the code that makes a sentence true.
 *
 * It is four forms rather than every form. A file is also named by its bare
 * filename all over this tree, and by a path relative to its app's own root,
 * and neither is checked here — resolving those needs a search strategy, and a
 * guard that guesses wrong is worse than none. What is checked is checked
 * exactly.
 *
 * **What this cannot check is whether the ADR says what the citation claims.**
 * A citation that resolves to a real file which does not support the sentence
 * beside it is worse than a dangling one, because it looks verified. That is a
 * reviewer's judgment and there is no test for it.
 */

/**
 * The repository root.
 *
 * This file lives at `apps/backend/src/__tests__/`, which is four directories
 * down. The first assertion below is what stops that count being wrong in
 * silence: a walk rooted at the wrong directory finds no citations and passes.
 */
const TEMPLATE_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ADR_DIR = join(TEMPLATE_ROOT, 'docs', 'adrs');

/** Directories whose contents are installed or generated, never written here. */
const SKIP = new Set([
  'node_modules', 'dist', 'coverage', '.git', '.nx', '.output', '.nuxt', '.turbo',
]);

/** The file kinds a citation is written in. */
const READABLE = /\.(ts|tsx|vue|md|mjs|cjs|js|json)$/;

/** `docs/adrs/0006-authorization-is-a-pure-function-in-core.md`, anywhere in a line. */
const ADR_PATH = /docs\/adrs\/(\d{4}-[a-z0-9-]+\.md)/g;

/** A bare `ADR-0006`, the form the TypeScript sources cite in. */
const ADR_ID = /\bADR-(\d{4})\b/g;

/**
 * A Markdown link whose target is a `.md` file, with an optional anchor.
 *
 * Absolute URLs and root-relative paths are left alone: the first is not this
 * repository's to keep, and nothing here writes the second.
 */
const MD_LINK = /\]\((?!https?:|mailto:|\/)([^)\s#]+\.md)(?:#[^)]*)?\)/g;

/** A repository-relative path to a source file, as a comment or a doc writes one. */
const SOURCE_PATH = /\b(?:apps|libs)\/[A-Za-z0-9_./-]+\.(?:tsx|ts|vue)\b/g;

/** A file whose own citations are the sources', as opposed to a document's. */
const IS_SOURCE = /\.(?:tsx?|vue)$/;

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    return entry.isFile() && READABLE.test(entry.name) ? [full] : [];
  });

/** Every ADR number `docs/adrs/` actually holds, as the four digits in its filename. */
const adrNumbers = (): Set<string> =>
  new Set(
    readdirSync(ADR_DIR)
      .map((name) => /^(\d{4})-[a-z0-9-]+\.md$/.exec(name)?.[1])
      .filter((digits): digits is string => digits !== undefined),
  );

const here = (file: string): string => relative(TEMPLATE_ROOT, file);

/**
 * Whether a path this file writes is a pointer at code rather than an illustration.
 *
 * Everything except the agent prompts. ADR-0008, ADR-0011, ADR-0012 and
 * `libs/core/README.md` each point a reader at code by repository-relative
 * path, and documents are precisely what the paragraph at the top of this file
 * is about, so they are held to it too. `.claude/` is the one exception: its
 * prompts write paths as illustrations of the shape a path takes, and some
 * deliberately name files that do not exist.
 */
const pointsAtCode = (file: string): boolean => here(file).split(sep)[0] !== '.claude';

describe('ADR references', () => {
  const files = filesUnder(TEMPLATE_ROOT);

  // Without this, every assertion below passes for free the day somebody moves
  // this file: a walk rooted somewhere that holds no citations finds no broken
  // ones either, and the suite stays green while the guard is gone.
  it('is rooted at the repository, not wherever this file happens to sit', () => {
    expect(existsSync(ADR_DIR)).toBe(true);
    expect(files.map(here)).toContain(join('apps', 'backend', 'src', '__tests__', 'adr-references.spec.ts'));
    expect(files.map(here)).toContain('CLAUDE.md');
  });

  it('every ADR path a file points at resolves to a file that exists', () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const [, name] of readFileSync(file, 'utf8').matchAll(ADR_PATH)) {
        if (!existsSync(join(ADR_DIR, name))) missing.push(`${here(file)} -> docs/adrs/${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every bare ADR-NNNN names a record in docs/adrs/', () => {
    const known = adrNumbers();
    const missing: string[] = [];
    for (const file of files) {
      for (const [cited, digits] of readFileSync(file, 'utf8').matchAll(ADR_ID)) {
        if (!known.has(digits)) missing.push(`${here(file)} -> ${cited}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every repository-relative source path a file points at exists', () => {
    const missing: string[] = [];
    for (const file of files.filter(pointsAtCode)) {
      for (const [path] of readFileSync(file, 'utf8').matchAll(SOURCE_PATH)) {
        if (!existsSync(join(TEMPLATE_ROOT, path))) missing.push(`${here(file)} -> ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every relative markdown link to a document resolves', () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const [, target] of readFileSync(file, 'utf8').matchAll(MD_LINK)) {
        if (!existsSync(resolve(dirname(file), target))) missing.push(`${here(file)} -> ${target}`);
      }
    }
    expect(missing).toEqual([]);
  });

  // Every sweep above is satisfied by a tree that cites nothing at all: no
  // citations means no broken ones. This is the other half of the rooting
  // check, and it DERIVES the set rather than listing it. A list of "the ADRs
  // the sources cite" is exactly the enumeration this file exists to stop
  // shipping — it would be wrong the first time somebody cited a new record,
  // and wrong in the silent direction, since a citation missing from the list
  // is a citation nothing complains about.
  //
  // It counts citations in SOURCES, not in every readable file, and that is
  // the difference between the name and a weaker claim: the ADRs cross-cite
  // each other, so a tree whose TypeScript had been stripped of every
  // citation would still satisfy a sweep that counted documents too.
  it('the sources do cite ADRs, so the sweeps above are not vacuous', () => {
    const cited = new Set<string>();
    for (const file of files.filter((name) => IS_SOURCE.test(name))) {
      for (const [, digits] of readFileSync(file, 'utf8').matchAll(ADR_ID)) cited.add(digits);
    }
    expect(cited.size).toBeGreaterThan(0);
  });
});
