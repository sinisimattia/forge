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
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
WORKDIR /app/apps/backend
EXPOSE 3000
CMD ["node", "dist/apps/backend/src/main"]
