# syntax=docker/dockerfile:1
# Built from the REPO ROOT context (npm workspaces hoist deps to the root).
#   docker build -f apps/webapp/Dockerfile --target <dev|prod> .

# --- base: install the whole workspace once ---
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=development
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json nx.json .npmrc ./
COPY apps/webapp/package.json apps/webapp/
COPY apps/backend/package.json apps/backend/
RUN npm ci

# --- dev: nuxt dev bound to all interfaces on 3001 (source bind-mounted by compose) ---
FROM base AS dev
COPY . .
EXPOSE 3001
# `npx nx build core` first, in the CMD rather than as a `RUN` step above: `compose.yaml`
# bind-mounts the whole repo over `/app` at container start (`.:/app`), which shadows
# anything an image-build-time `RUN` produced under `libs/core/dist` the moment the
# container actually runs — so the build has to happen after that mount is live, the same
# reason `apps/backend/Dockerfile`'s dev CMD runs migrations before `nest start --watch`
# rather than during its own image build. Without this, `libs/core/package.json`'s
# `exports` map sends every subpath to `./dist/`, which no dev boot ever produced, and the
# server plugin chain (`app/plugins/auth-init.server.ts` -> `useAuthStore` ->
# `__FORGE_SCOPE__/core/*`) 500s on every route. `libs/core/README.md` names the five
# wildcard-to-source resolution points on purpose — `apps/webapp/vitest.config.ts` among
# them — and the running app is deliberately not a sixth: in dev exactly as in production,
# it resolves through `exports` into `dist`. This keeps that promise instead of adding a
# Vite alias that would make dev and prod resolve core differently.
CMD ["sh", "-lc", "npx nx build core && npm run dev -w apps/webapp -- --host 0.0.0.0"]

# --- build: produce the self-contained Nitro output at apps/webapp/.output ---
FROM base AS build
COPY . .
RUN npx nx build webapp

# --- prod: Nitro output is self-contained; no node_modules needed ---
FROM node:22-bookworm-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build /app/apps/webapp/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
