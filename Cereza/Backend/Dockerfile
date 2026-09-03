# ============================================================================
# CaféVision Backend — Multi-stage Dockerfile
#   Runtime: Node 22 LTS pinateña (22.23.2) + pnpm 11.3.0 (corepack/packageManager)
#   Supply-chain: installs siempre con `--frozen-lockfile` y scripts de build
#   restringidos a onlyBuiltDependencies (pnpm-workspace.yaml).
# ============================================================================

# ---------- stage: deps (install completo para dev/build) ----------
FROM node:26.8.1-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ vips-dev && \
    corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ---------- stage: dev ----------
FROM node:26.8.1-alpine AS dev
WORKDIR /app
RUN apk add --no-cache vips && \
    corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
EXPOSE 3001
ENV NODE_ENV=development
CMD ["pnpm", "dev"]

# ---------- stage: build ----------
FROM node:26.8.1-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++ vips-dev && \
    corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN pnpm exec tsc -p tsconfig.json

# ---------- stage: prod-deps (instala prod con toolchain para nativos) ----------
FROM node:26.8.1-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ vips-dev && \
    corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile

# ---------- stage: prod ----------
FROM node:26.8.1-alpine AS prod
WORKDIR /app
RUN apk add --no-cache vips tini && \
    addgroup -S app && adduser -S app -G app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER app
EXPOSE 3001
ENV NODE_ENV=production
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]