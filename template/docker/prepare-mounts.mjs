#!/usr/bin/env node
/**
 * Creates, as the user running it, every directory compose.yaml mounts an anonymous volume
 * over (`node_modules`, `.nx`, ...). Run by `npm run dev:up` before `docker compose up`.
 *
 * Those volumes sit inside the `.:/app` bind mount, and when a mount point does not exist yet
 * the Docker daemon creates it in the checkout — as root. On Linux that leaves an empty
 * root-owned `node_modules` behind, and the next `npm ci` on the host fails with `EACCES`.
 * `docker/dev-entrypoint.sh` handles everything the containers write; this handles the one
 * thing Docker itself writes before any container code runs. A directory that already exists
 * is left exactly as it is, so a host install is never touched.
 *
 * The list is read from compose.yaml rather than repeated here, so a volume added there is
 * covered without anyone remembering this file. Node builtins only, so it runs before
 * anything is installed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compose = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');

// A list entry that is a bare container path under `/app` is an anonymous volume; anything
// with a `:` is a bind mount or a named volume and has no mount point to create.
const mountPoints = new Set(
  [...compose.matchAll(/^\s*-\s*\/app\/([^\s:#'"]+)\s*$/gm)].map((match) => match[1]),
);

for (const relative of mountPoints) {
  fs.mkdirSync(path.join(root, relative), { recursive: true });
}
