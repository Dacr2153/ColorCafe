# CaféVision (ColorCafe)

Plataforma web **PWA** para el análisis de grano de café y la gestión de datos de
fincas cafeteras. Permite a los productores tomar una foto del café (cereza,
pergamino, trilla), obtener un análisis automático de madurez y calidad, y llevar
el registro histórico de sus métricas (diario, semanal, mensual y anual).

## Características

- **Análisis fotográfico** con asistencia en vivo: el visor de cámara indica en
  tiempo real (rojo → naranja → amarillo → verde) si las condiciones son adecuadas
  para tomar la foto.
- **Resultados medidos, no inventados**: el análisis se realiza sobre la imagen
  (segmentación + estadísticas de color/forma) con un pipeline heurístico
  determinista. Todas las respuestas identifican su `algorithm_version`.
- **Métricas e historial**: almanaque interactivo con análisis previos y métricas
  agregadas diarias, semanales, mensuales y anuales.
- **Noticias del campo colombiano**: banner carrusel con noticias y página de
  detalle con comentarios.
- **Mercado**: publicaciones, listados, órdenes y perfil del productor.
- **Orientado a redes de bajo ancho de banda**: optimización de imágenes, carga
  progresiva, PWA (service worker), almacenamiento offline y colas de sincronización.
- **Arquitectura de microservicios** desplegable en contenedores Docker.

## Arquitectura

```
                        ┌────────────────────┐
Internet ──► TLS ─────► │  Nginx host edge    │
                        │  /   → frontend:8080│
                        │  /api → backend:3001│
                        │  /ws  → backend:3001│
                        └─────────┬───────────┘
                        ┌─────────▼───────────┐
     Frontend (React)   │        ...          │
     Backend (Node/TS)  │  Docker services    │
     Python (FastAPI)   │                     │
                        └─────────┬───────────┘
        postgres (Timescale)    redis    minio    ollama
```

| Capa        | Tecnología                                          |
|-------------|-----------------------------------------------------|
| Frontend    | React 18 · TypeScript · Vite · Tailwind CSS · PWA   |
| Backend     | Node.js 20 · TypeScript · Express · vertical slices |
| Análisis    | Python · FastAPI · procesamiento de imagen          |
| Datos       | PostgreSQL/Timescale · Redis · MinIO                |
| IA generativa| Ollama (mistral:7b-instruct) para contenido        |

Más detalles de infraestructura en [DEPLOYMENT.md](./DEPLOYMENT.md).

## Estructura del repositorio

```
ColorCafe/
├── Cereza/
│   ├── Backend/          # API Node.js + TypeScript (Express, vertical slices)
│   ├── FrontEnd/         # App React PWA + Capacitor
│   └── PythonAnalysis/   # Microservicio FastAPI de análisis de imagen
├── scripts/              # utilidades (init-minio, generate-keys)
├── docs/                 # documentación y diagramas
├── docker-compose.yml    # desarrollo local
├── docker-compose.prod.yml  # producción
├── Makefile              # comandos de operación
└── DEPLOYMENT.md         # guía de despliegue
```

## Requisitos

- Docker + Docker Compose (v2)
- Node.js >= 20 (solo para desarrollo fuera de contenedores)
- Make (opcional, para usar los atajos del `Makefile`)

## Inicio rápido (desarrollo local)

```bash
# 1) Configura variables de entorno
cp .env.example .env

# 2) Genera las llaves RSA para JWT
make keys               # o: ./scripts/generate-keys.sh

# 3) Levanta toda la infraestructura + aplicación
make dev                # docker compose up -d

# 4) (Primera vez) descarga el modelo de Ollama
make pull-mistral
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- MinIO console: http://localhost:9001

Otros comandos útiles: `make logs`, `make migrate`, `make ps`, `make down`.

## Despliegue en producción

Consulta la guía completa en [DEPLOYMENT.md](./DEPLOYMENT.md). En resumen:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Pruebas

```bash
# Backend
cd Cereza/Backend && npm test && npm run typecheck && npm run lint

# Frontend
cd Cereza/FrontEnd && npm run lint && npm run build
```

## Notas

- Las llaves RSA de JWT y los `.env` **no** se versionan; genera las tuyas con
  `make keys`. Consulta `Cereza/Backend/SECURITY.md` para más detalles de seguridad.
- El modelo de análisis actual es heurístico (`heuristic-v1`) y no sustituye un
  análisis de laboratorio.