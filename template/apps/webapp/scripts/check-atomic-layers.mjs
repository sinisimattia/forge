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
 * Only the root `<template>` block is scanned. The `<script setup>` block is full of
 * `<`-prefixed PascalCase that is not markup at all — `defineProps<Props>()`,
 * `Record<IconName, IconDefinition>`, `ref<HTMLElement | null>(null)` — and every one of them
 * would be a false positive. Scanning markup for a markup rule also means the check cannot be
 * evaded by moving a render call around inside the script.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const COMPONENTS = path.resolve(import.meta.dirname, '..', 'app', 'components');

/**
 * The layers, lowest first. A component's index in this array is its rank; it may render only
 * components of a STRICTLY lower rank. Adding a layer means adding it here and to
 * `nuxt.config.ts`'s `components` array — the two lists describe the same hierarchy.
 */
const LAYERS = ['atoms', 'molecules', 'organisms', 'templates'];

/**
 * The root `<template>` block, or '' when there is none.
 *
 * Both anchors are at column 0 with the `m` flag, which is what distinguishes the SFC's root
 * block from a nested named slot: `<template #footer>` never matches `^<template>$`, and a
 * nested `</template>` is always indented, so the first column-0 close is the root's.
 */
function rootTemplate(source) {
  const match = source.match(/^<template>$([\s\S]*?)^<\/template>$/m);
  return match ? match[1] : '';
}

/** Every distinct PascalCase tag rendered in `markup`. */
function renderedTags(markup) {
  return [...new Set([...markup.matchAll(/<([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]))];
}

async function main() {
  // Every component in the tree, by name, with the layer that defines it. Built first so a
  // tag can be resolved no matter which layer it came from.
  const definedIn = new Map();
  for (const layer of LAYERS) {
    let entries;
    try {
      entries = await fs.readdir(path.join(COMPONENTS, layer));
    } catch {
      // A layer directory that does not exist yet is not an error — `organisms/` is empty
      // until the first organism is written. It contributes no components and no violations.
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith('.vue')) definedIn.set(entry.slice(0, -4), layer);
    }
  }

  const violations = [];
  let checked = 0;

  for (const [rank, layer] of LAYERS.entries()) {
    let entries;
    try {
      entries = await fs.readdir(path.join(COMPONENTS, layer));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.vue')) continue;
      const name = entry.slice(0, -4);
      const file = path.join(COMPONENTS, layer, entry);
      checked += 1;
      const markup = rootTemplate(await fs.readFile(file, 'utf8'));
      for (const tag of renderedTags(markup)) {
        const tagLayer = definedIn.get(tag);
        // Not a project component — a Nuxt/Vue built-in or a third-party tag. Out of scope.
        if (tagLayer === undefined) continue;
        // A component rendering itself is recursion (a tree, a nested menu), not a layering
        // violation. The hierarchy it would breach is its own.
        if (tag === name) continue;
        if (LAYERS.indexOf(tagLayer) >= rank) {
          const kind = rank === LAYERS.indexOf(tagLayer) ? 'a same-level' : 'an upward';
          const where = `${tagLayer}/`;
          violations.push(`  ${layer}/${entry}  renders <${tag}> from ${where} — ${kind} dependency`);
        }
      }
    }
  }

  // Zero components means the scan found nothing to check — a renamed directory, a bad cwd, a
  // readdir that failed quietly. Reporting that as "clean" would be a vacuous pass
  // indistinguishable from a real one, which is the failure this check exists to end.
  if (checked === 0) {
    console.error(`Atomic layering: FAILED — no components were scanned under ${COMPONENTS}.`);
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error('Atomic layering violations:\n');
    for (const violation of violations) console.error(violation);
    const order = LAYERS.join(' < ');
    console.error(`\n${violations.length} violation(s). A component may render only LOWER layers.`);
    console.error(`Order: ${order}. An atom renders no project component at all.`);
    process.exit(1);
  }

  console.log(`Atomic layering: clean (${checked} component(s) checked)`);
}

await main();
