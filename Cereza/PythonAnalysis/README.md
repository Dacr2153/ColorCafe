# CaféVision — Servicio Python de Análisis (FASE 2)

Microservicio FastAPI que recibe imágenes de granos de café (cereza, pergamino,
trilla) y devuelve resultados **medidos**, no fabricados.

## Principios éticos

- **Cero invención.** Todos los valores devueltos provienen de mediciones reales
  sobre la imagen (segmentación + estadísticas de color/forma).
- La clasificación es **heurística determinista** basada en umbrales de color
  LAB y morfología — NO se inventan etiquetas ni se generan números aleatorios.
- `algorithm_version` en cada respuesta identifica la versión del pipeline.
- Si la imagen no puede procesarse (sin contraste, sin granos detectados),
  el servicio devuelve `503` con un código de error explícito — nunca
  fabrica resultados.

## Endpoints

- `GET  /health`              → `{ ok, version }`
- `POST /analyze`             → multipart `image` + campos del análisis.
  Devuelve el JSON contractual consumido por el worker Node.

## Variables de entorno

| Var                 | Default                 | Descripción                       |
|---------------------|-------------------------|-----------------------------------|
| `LOG_LEVEL`         | `info`                  | trace/debug/info/warn/error       |
| `MAX_IMAGE_MB`      | `20`                    | tamaño máximo por imagen          |
| `ALGORITHM_VERSION` | `heuristic-v1`          | identifica el pipeline activo     |

## Desarrollo local

```bash
cd Cereza/PythonAnalysis
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Docker

```bash
docker build -t cafevision-python .
docker run -p 8001:8001 cafevision-python
```
