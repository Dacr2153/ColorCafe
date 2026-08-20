# ============================================================================
# CaféVision Backend — Multi-stage Dockerfile
# ============================================================================

# ---------- stage: deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ vips-dev
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# ---------- stage: dev ----------
FROM node:20-alpine AS dev
WORKDIR /app
RUN apk add --no-cache vips
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
EXPOSE 3001
ENV NODE_ENV=development
CMD ["npx", "tsx", "watch", "src/main.ts"]

# ---------- stage: build ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++ vips-dev
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# ---------- stage: prod ----------
FROM node:20-alpine AS prod
WORKDIR /app
RUN apk add --no-cache vips tini && \
    addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER app
EXPOSE 3001
ENV NODE_ENV=production
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
