# syntax=docker/dockerfile:1
# Built from the REPO ROOT context (npm workspaces hoist deps to the root).
#   docker build -f apps/backend/Dockerfile --target <dev|prod> .

# --- base: install the whole workspace once ---
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=development
# Manifests first for layer caching; npm ci installs every workspace from the root lockfile.
COPY package.json package-lock.json nx.json .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY apps/webapp/package.json apps/webapp/
RUN npm ci

# --- dev: hot reload; runs migrations then nest --watch (source bind-mounted by compose) ---
FROM base AS dev
COPY . .
EXPOSE 3000 9229
CMD ["sh", "-lc", "npm run migration:run -w apps/backend && npm run start:dev -w apps/backend"]

# --- build: compile the backend to apps/backend/dist ---
FROM base AS build
COPY . .
RUN npx nx build backend

# --- prod-deps: drop devDependencies from the already-built tree ---
FROM build AS prod-deps
RUN npm prune --omit=dev

# --- prod: slim runtime, no toolchain, production node_modules only ---
FROM node:22-bookworm-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/package.json /app/package-lock.json /app/.npmrc ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=prod-deps /app/apps/backend/package.json ./apps/backend/package.json
# The backend's compiled output still contains bare `require('__FORGE_SCOPE__/core/...')`
# specifiers — `paths` is a compile-time mapping and tsc never rewrites them. Node resolves
# those through `node_modules/__FORGE_SCOPE__/core`, which is a workspace symlink to
# `libs/core`, and then through core's `exports` into `libs/core/dist`. Without these two
# lines that symlink dangles here and the container dies at startup with MODULE_NOT_FOUND.
# Core declares no runtime dependencies, so its `package.json` (for `exports`) and its
# `dist` are all the image needs.
COPY --from=build /app/libs/core/package.json ./libs/core/package.json
COPY --from=build /app/libs/core/dist ./libs/core/dist
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
WORKDIR /app/apps/backend
EXPOSE 3000
# The same path `package.json`'s `start:prod` names, repeated rather than delegated: `node`
# as PID 1 receives `SIGTERM` from `docker stop` directly, where `npm run start:prod` would
# sit between them and not forward it. This is one of FIVE places the `dist/apps/backend/src`
# layout is written down — `apps/backend/CLAUDE.md` enumerates them, and records what went
# wrong the two times one of them was missed.
CMD ["node", "dist/apps/backend/src/main"]
