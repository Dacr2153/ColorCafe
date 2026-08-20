# ============================================================================
# CaféVision Frontend — Multi-stage Dockerfile
#   dev:  Vite dev server con HMR
#   prod: bundle estático servido por Nginx hardened
# ============================================================================

# ---------- stage: deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# ---------- stage: dev ----------
FROM node:20-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
ENV NODE_ENV=development
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "3000"]

# ---------- stage: build ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG VITE_API_BASE_URL
ARG VITE_WS_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_WS_URL=${VITE_WS_URL}
RUN npx vite build

# ---------- stage: prod ----------
FROM nginx:1.27-alpine AS prod
RUN apk add --no-cache tini && \
    addgroup -S app && adduser -S -G app app
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
USER nginx
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["nginx", "-g", "daemon off;"]
