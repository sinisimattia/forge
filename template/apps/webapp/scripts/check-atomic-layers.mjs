#!/usr/bin/env node
/**
 * Atomic Design layering, enforced.
 *
 * The rule (STANDARDS.md — Atomic design): a component may render components from layers
 * BELOW its own, never from its own layer and never from above. An atom renders no project
 * component at all.
 *
 * This replaces a grep that could not work in this stack. That signal searched the component
 * directories for the literal strings `~/components/atoms`, `~/components/molecules`, and so
 * on — i.e. for explicit import paths. Under Nuxt auto-imports there are none: a molecule
 * writes `<AppStack>` with no import statement anywhere in the file. Across the whole shipped
 * library there are two import statements in total and neither is a component, so the grep
 * returned nothing on every run and read as a pass. It was not clean, it was inert — which is
 * strictly worse than broken, because nobody investigates a green check.
 *
 * What is checked instead is what the stack actually writes: the PascalCase tags a component
 * renders, each resolved to the layer that defines it. A tag that resolves to no component
 * file is not a project component (`NuxtLink`, `Teleport`, `Transition`) and is ignored.
 *
 * Only the root `<template>` block is scanned, with its HTML comments stripped. The
 * `<script setup>` block is full of `<`-prefixed PascalCase that is not markup at all —
 * `defineProps<Props>()`, `Record<IconName, IconDefinition>`, `ref<HTMLElement | null>(null)` —
 * and every one of them would be a false positive. Scanning markup for a markup rule also
 * means the check cannot be evaded by moving a render call around inside the script. Comments
 * are stripped because they are not markup either: an atom whose comment explained which atoms
 * it deliberately does *not* render failed this check for saying so.
 *
 * ## Pages and layouts
 *
 * `app/pages/**` and `app/layouts/**` are scanned too, and they were not always. The checker
 * read `app/components` alone, so twelve files — every page and both layouts — were never
 * opened: a page rendering another page, or a layout rendering a page, passed silently.
 *
 * They share one rank, above `templates`, because neither is below the other. A page is
 * rendered *into* a layout by Nuxt and declares which one by name in `definePageMeta`; nothing
 * renders either as a tag in the ordinary course of events. So both may render any component,
 * and neither may render the other or another of its own kind.
 *
 * Nuxt does not auto-register these as components, so the illegal shape needs an explicit
 * `import … from '~/pages/…'`. That is checked directly, by path, as well — see
 * CROSS_LAYER_IMPORT. The tag-name convention below (`login.vue` → `LoginPage`,
 * `account/profile.vue` → `AccountProfilePage`, `layouts/auth.vue` → `AuthLayout`) catches the
 * case where such an import is bound to the name it would naturally be given; the import rule
 * catches it whatever it was bound to. Neither alone is enough, and the second is the one that
 * cannot be evaded by renaming.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const APP = path.resolve(import.meta.dirname, '..', 'app');

/**
 * The layers, lowest first. A file may render only files of a STRICTLY lower rank.
 *
 * `rank` is explicit rather than the array index because two layers share one: see the note
 * above on pages and layouts. Adding a component layer means adding it here and to
 * `nuxt.config.ts`'s `components` array — those two lists describe the same hierarchy.
 */
const LAYERS = [
  { name: 'atoms', dir: path.join(APP, 'components', 'atoms'), rank: 0, suffix: '' },
  { name: 'molecules', dir: path.join(APP, 'components', 'molecules'), rank: 1, suffix: '' },
  { name: 'organisms', dir: path.join(APP, 'components', 'organisms'), rank: 2, suffix: '' },
  { name: 'templates', dir: path.join(APP, 'components', 'templates'), rank: 3, suffix: '' },
  { name: 'layouts', dir: path.join(APP, 'layouts'), rank: 4, suffix: 'Layout' },
  { name: 'pages', dir: path.join(APP, 'pages'), rank: 4, suffix: 'Page' },
];

/** An import of a page or a layout from anywhere. There is no legitimate one. */
const CROSS_LAYER_IMPORT = /from\s+['"]~\/(pages|layouts)\//;

/**
 * The root `<template>` block with its HTML comments removed, or '' when there is none.
 *
 * Both anchors are at column 0 with the `m` flag, which is what distinguishes the SFC's root
 * block from a nested named slot: `<template #footer>` never matches `^<template>$`, and a
 * nested `</template>` is always indented, so the first column-0 close is the root's.
 */
function rootTemplate(source) {
  const match = source.match(/^<template>$([\s\S]*?)^<\/template>$/m);
  return match ? match[1].replace(/<!--[\s\S]*?-->/g, '') : '';
}

/** Every distinct PascalCase tag rendered in `markup`. */
function renderedTags(markup) {
  return [...new Set([...markup.matchAll(/<([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]))];
}

/**
 * The tag a file would be rendered as.
 *
 * A component is its own basename, because that is what Nuxt registers. A page or a layout has
 * no registered name at all, so the convention below is the checker's own: the path, in
 * PascalCase, plus `Page` or `Layout`. It is the name such an import would naturally be bound
 * to, and it is not the only thing checked — CROSS_LAYER_IMPORT catches the rest.
 */
function tagNameOf(relative, suffix) {
  const words = relative.replace(/\.vue$/, '').split(/[/\-_]/).filter(Boolean);
  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join('') + suffix;
}

/** Every `.vue` file under `dir`, relative to it, recursively. */
async function vueFilesIn(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // A layer directory that does not exist yet is not an error — `organisms/` was empty
    // until the first organism was written. It contributes no components and no violations.
    return [];
  }
  const found = [];
  for (const entry of entries) {
    // A spec beside a page legitimately imports it; it renders nothing and is not a layer.
    if (entry.name === '__tests__') continue;
    if (entry.isDirectory()) {
      const nested = await vueFilesIn(path.join(dir, entry.name));
      found.push(...nested.map((one) => path.join(entry.name, one)));
    } else if (entry.name.endsWith('.vue')) {
      found.push(entry.name);
    }
  }
  return found;
}

async function main() {
  // Every file in the tree, by the tag it would be rendered as, with the layer that defines
  // it. Built first so a tag can be resolved no matter which layer it came from.
  const definedIn = new Map();
  const files = [];
  for (const layer of LAYERS) {
    for (const relative of await vueFilesIn(layer.dir)) {
      const name = tagNameOf(relative, layer.suffix);
      definedIn.set(name, layer);
      files.push({ layer, relative, name, file: path.join(layer.dir, relative) });
    }
  }

  const violations = [];

  for (const { layer, relative, name, file } of files) {
    const source = await fs.readFile(file, 'utf8');
    if (CROSS_LAYER_IMPORT.test(source)) {
      violations.push(`  ${layer.name}/${relative}  imports from ~/pages or ~/layouts — nothing may`);
    }
    for (const tag of renderedTags(rootTemplate(source))) {
      const tagLayer = definedIn.get(tag);
      // Not a project component — a Nuxt/Vue built-in or a third-party tag. Out of scope.
      if (tagLayer === undefined) continue;
      // A component rendering itself is recursion (a tree, a nested menu), not a layering
      // violation. The hierarchy it would breach is its own.
      if (tag === name) continue;
      if (tagLayer.rank >= layer.rank) {
        const kind = tagLayer.rank === layer.rank ? 'a same-level' : 'an upward';
        violations.push(
          `  ${layer.name}/${relative}  renders <${tag}> from ${tagLayer.name}/ — ${kind} dependency`,
        );
      }
    }
  }

  const components = files.filter((one) => one.layer.rank < 4).length;

  // Zero means the scan found nothing to check — a renamed directory, a bad cwd, a readdir
  // that failed quietly. Reporting that as "clean" would be a vacuous pass indistinguishable
  // from a real one, which is the failure this check exists to end. Components are counted
  // separately from the total, because pages and layouts existing would otherwise mask a
  // component tree that had gone missing entirely.
  if (files.length === 0 || components === 0) {
    console.error(`Atomic layering: FAILED — nothing was scanned under ${APP}.`);
    console.error(`  ${components} component(s), ${files.length} file(s) in total.`);
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error('Atomic layering violations:\n');
    for (const violation of violations) console.error(violation);
    const order = LAYERS.map((one) => one.name).join(' < ').replace('layouts < pages', 'layouts = pages');
    console.error(`\n${violations.length} violation(s). A file may render only LOWER layers.`);
    console.error(`Order: ${order}. An atom renders no project component at all.`);
    process.exit(1);
  }

  console.log(
    `Atomic layering: clean (${components} component(s) and ${files.length - components} page(s)/layout(s) checked)`,
  );
}

await main();
