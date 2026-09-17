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
CMD ["npm", "run", "dev", "-w", "apps/webapp", "--", "--host", "0.0.0.0"]

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
