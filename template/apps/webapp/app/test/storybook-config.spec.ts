import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBAPP_ROOT = resolve(HERE, '../..');

const STORIES_GLOB = '../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)';

// Read out of STORIES_GLOB itself — asserted below to be the literal text
// `main.ts` runs — rather than written a second, narrower time here. A
// second copy is exactly how the story count below once undercounted: the
// glob matches `@(js|jsx|mjs|ts|tsx)` and this file's own filter once
// matched only `.stories.ts`, so a story added as `.stories.tsx` would build
// correctly and still read as zero new stories to this guard.
const STORIES_EXTENSIONS = STORIES_GLOB.match(/@\(([^)]+)\)$/)?.[1];
if (STORIES_EXTENSIONS === undefined) {
  throw new Error('STORIES_GLOB has no @(...) extension suffix to check against');
}
const STORY_FILE = new RegExp(`\\.stories\\.(${STORIES_EXTENSIONS})$`);

/**
 * Storybook's entry files name paths, and a path that names nothing fails in a
 * way that reads as something else entirely: `.storybook/preview.ts` imported
 * `~/assets/css/main.css`, a file this app has never had, and the build reported
 * `✓ 0 modules transformed` followed by a `moduleType` error from the HTML
 * plugin. Neither line mentioned the stylesheet — the real first fault aborted
 * the build on `iframe.html` before the preview module was ever loaded, so the
 * broken import was merely the next one waiting. This suite asserts the paths
 * exist, in the fast tier, so the next one is a one-line failure with the
 * filename in it.
 *
 * It does NOT replace the `storybook` CI job. It cannot: it reads text and
 * checks the filesystem, where the job builds. It exists because the job takes
 * minutes and this takes milliseconds.
 */
describe('storybook configuration', () => {
  it('every stylesheet preview.ts imports exists', async () => {
    const preview = await readFile(resolve(WEBAPP_ROOT, '.storybook/preview.ts'), 'utf8');
    const imports = [...preview.matchAll(/^import ['"]~\/(.+?)['"];$/gm)]
      .flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

    // A guard against the assertion passing by finding nothing to check — the
    // exact shape of "a check that cannot fail".
    expect(imports.length).toBeGreaterThan(0);

    // Collected into a list rather than asserted one path at a time, because
    // `expect(existsSync(...)).toBe(true)` fails with "expected false to be
    // true" and makes the reader open the file to find out which path was
    // missing — which is the cost this suite exists to remove.
    const missing = imports.filter((path) => !existsSync(resolve(WEBAPP_ROOT, 'app', path)));
    expect(missing).toEqual([]);
  });

  it('the stories glob resolves to a directory that has stories in it', async () => {
    const main = await readFile(resolve(WEBAPP_ROOT, '.storybook/main.ts'), 'utf8');
    expect(main).toContain(`'${STORIES_GLOB}'`);

    const stories = resolve(WEBAPP_ROOT, 'stories');
    expect(existsSync(stories)).toBe(true);

    // The directory merely existing is not worth asserting. `build-storybook`
    // exits 0 over an empty module graph, so a glob that matched nothing would
    // take the CI job green having compiled not one story — which is precisely
    // the failure this file was written after. Assert it has something to match.
    const matched = readdirSync(stories, { recursive: true, encoding: 'utf8' })
      .filter((entry) => STORY_FILE.test(entry));
    expect(matched.length).toBeGreaterThan(0);
  });

  it('counts a story under every extension the glob itself accepts, not only .stories.ts', () => {
    // Every extension @(js|jsx|mjs|ts|tsx) names has to be recognised by the
    // same pattern the directory scan above filters with — a filename ending
    // `.stories.ts` alone (this codebase's only extension in use today) would
    // pass this same assertion even after regressing to that narrower check,
    // which is exactly the "check that cannot fail" shape this guards
    // against: it is watched against a filename none of the repository's real
    // stories happen to use.
    for (const extension of STORIES_EXTENSIONS.split('|')) {
      expect(STORY_FILE.test(`Example.stories.${extension}`)).toBe(true);
    }
    expect(STORY_FILE.test('Example.not-a-story.ts')).toBe(false);
  });
});
