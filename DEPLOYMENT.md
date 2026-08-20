# FASE 7 — Despliegue en Producción

## Topología

```
            ┌────────────────────┐
Internet ──▶│  Cloudflare / ALB  │  (TLS termination, WAF, DDoS)
            └─────────┬──────────┘
                      │ HTTPS
            ┌─────────▼──────────┐
            │  Nginx host edge   │  (reverse-proxy + rate limit)
            │  → /         frontend:8080
            │  → /api      backend:3001
            │  → /ws       backend:3001 (Upgrade)
            └─────────┬──────────┘
                      │ red interna docker
        ┌─────────────┼──────────────┬──────────────┐
        ▼             ▼              ▼              ▼
   frontend       backend       python         postgres
   (nginx)       (Node 20)      (FastAPI)      (Timescale)
                     │              │
                     ▼              ▼
                   redis         ollama
                   minio
```

## Variables de entorno requeridas

Copiar `.env.example` → `.env` y rellenar:

```
# Postgres
POSTGRES_DB=cafevision
POSTGRES_USER=cafevision
POSTGRES_PASSWORD=<min 24 chars>

# Redis
REDIS_PASSWORD=<min 24 chars>

# MinIO
MINIO_ROOT_USER=cafevision_minio
MINIO_ROOT_PASSWORD=<min 32 chars>

# Backend
LOG_LEVEL=info
JWT_PRIVATE_KEY_PATH=/app/keys/private.pem
JWT_PUBLIC_KEY_PATH=/app/keys/public.pem
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# Email
RESEND_API_KEY=<real-key>
EMAIL_FROM=noreply@cafevision.co

# Frontend (build-time)
PUBLIC_API_URL=https://api.cafevision.co
PUBLIC_WS_URL=wss://api.cafevision.co/ws

# CORS — orígenes permitidos en el backend (comma-separated)
CORS_ORIGINS=https://app.cafevision.co,http://localhost

# Versionado
IMAGE_TAG=v1.0.0
```

## Pasos de despliegue

```bash
# 1) Generar las llaves RSA del JWT (una vez por entorno)
cd Cereza/Backend
mkdir -p keys && cd keys
openssl genpkey -algorithm RSA -out private.pem -pkeyopt rsa_keygen_bits:3072
openssl rsa -in private.pem -pubout -out public.pem
chmod 600 private.pem

# 2) Build de las imágenes
cd ../..   # de vuelta a ColorCafe/
docker compose -f docker-compose.yml -f docker-compose.prod.yml build

# 3) Inicializar infra (primera vez)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres redis minio minio-init

# 4) Aplicar migraciones
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm backend pnpm run migrate

# 5) Levantar la app
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 6) Pull del modelo de Ollama (primera vez)
docker exec cafevision-ollama ollama pull mistral:7b-instruct
```

## Backups

### Postgres

```bash
# Backup diario (cron en el host)
docker exec cafevision-postgres pg_dump -U cafevision cafevision \
    | gzip > /backups/cafevision-$(date +%F).sql.gz

# Restore
gunzip -c backup.sql.gz | docker exec -i cafevision-postgres psql -U cafevision cafevision
```

### MinIO

```bash
docker run --rm --network cafevision_private-net \
    -v /backups/minio:/data minio/mc:latest \
    mirror minio/cafe-analyses /data/cafe-analyses
```

## Rolling updates

```bash
# Nuevo tag
IMAGE_TAG=v1.1.0 docker compose -f docker-compose.yml -f docker-compose.prod.yml build backend frontend
IMAGE_TAG=v1.1.0 docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps backend frontend
```

El backend lee migraciones al arrancar; verifica que sean retro-compatibles antes
de mergear (sólo `ADD COLUMN ... NULL`, índices `CONCURRENTLY`, etc.).

## Observabilidad

- `/health` y `/metrics` accesibles desde la red interna sólo.
- Logs JSON de `pino` → recolectarlos con Loki/Promtail o CloudWatch.
- Healthchecks Docker → Compose reinicia el contenedor automáticamente si fallan
  5 veces seguidas.

## Compromisos honestos sobre el deploy

- **Sin auto-scaling horizontal**: el backend mantiene Hub WS en memoria de
  proceso; para escalar a varias réplicas hace falta migrar el Hub a Redis
  pub/sub (pendiente, ver FASE 8).
- **MinIO single-node**: para alta disponibilidad real cambiar a modo
  distribuido (4 nodos) o usar S3 directamente.
- **CI/CD**: el repositorio incluye GitHub Actions (`.github/workflows/ci.yml`
  con tests + audit + Trivy + SBOM, `codeql.yml`, `dependency-review.yml`) y
  Dependabot (`.github/dependabot.yml`). El push de imágenes a un registry con
  provenance/SBOM (`build-push-action` con `provenance: true`) requiere
  credenciales y sigue como paso manual.
- **Imágenes e imágenes base pineadas**: Node 22.23.2, nginx 1.31.4, python
  3.12.14, Timescale 2.29.2-pg15, Redis 7.4.10, MinIO RELEASE.2025-09-07,
  Ollama 0.32.15. Para fijar por digest SHA-256: `docker buildx imagetools
  inspect <imagen>:<tag> --format '{{.Manifest.Digest}}'`.
- **Contenedores de producción**: rootfs `read_only`, `cap_drop: ALL`,
  `no-new-privileges`, usuario no-root y tmpfs acotados. Validar el arranque
  completo con `docker compose -f docker-compose.yml -f docker-compose.prod.yml
  up -d` tras cada cambio.
