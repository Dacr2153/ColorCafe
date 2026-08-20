# ============================================================================
# CaféVision Frontend — Multi-stage Dockerfile
#   dev:  Vite dev server con HMR
#   prod: bundle estático servido por Nginx hardened (versión pineada)
#   Runtime: Node 22 LTS (22.23.2) + pnpm 11.3.0 para las fases de build.
# ============================================================================

# ---------- stage: deps ----------
FROM node:22.23.2-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ---------- stage: dev ----------
FROM node:22.23.2-alpine AS dev
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
ENV NODE_ENV=development
CMD ["pnpm", "dev"]

# ---------- stage: build ----------
FROM node:22.23.2-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG VITE_API_BASE_URL
ARG VITE_WS_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_WS_URL=${VITE_WS_URL}
RUN pnpm exec vite build

# ---------- stage: prod ----------
FROM nginx:1.31.4-alpine AS prod
RUN apk add --no-cache tini && \
    addgroup -S app && adduser -S -G app app && \
    mkdir -p /var/cache/nginx /var/run && \
    touch /var/run/nginx.pid && \
    chown -R app:app /var/cache/nginx /var/run /var/run/nginx.pid
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
USER nginx
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["nginx", "-g", "daemon off;"]