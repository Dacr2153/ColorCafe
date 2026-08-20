"""FastAPI entry point del servicio de análisis CaféVision."""
from __future__ import annotations

import logging
import os
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .analyzer import AnalysisFailure, analyze
from .schemas import AnalysisResponse

LOG_LEVEL = os.environ.get("LOG_LEVEL", "info").upper()
MAX_IMAGE_MB = int(os.environ.get("MAX_IMAGE_MB", "20"))
ALGORITHM_VERSION = os.environ.get("ALGORITHM_VERSION", "heuristic-v4")

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("cafevision.python")

app = FastAPI(
    title="CaféVision Python Analysis",
    version=ALGORITHM_VERSION,
    description=(
        "Análisis determinista y honesto de granos de café. "
        "NUNCA fabrica resultados: ante imagen no procesable devuelve 503."
    ),
    docs_url="/docs",
    redoc_url=None,
)


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "version": ALGORITHM_VERSION, "max_image_mb": MAX_IMAGE_MB}


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_endpoint(
    image: Annotated[UploadFile, File(description="Imagen del grano")],
    analysis_id: Annotated[str | None, Form()] = None,
    user_id: Annotated[str | None, Form()] = None,
    farm_id: Annotated[str | None, Form()] = None,
    grain_type: Annotated[str | None, Form()] = None,
    sample_weight_g: Annotated[float | None, Form()] = None,
):
    """Recibe la imagen del backend Node y devuelve el JSON contractual.

    El backend Node valida la respuesta estrictamente; este endpoint NO
    rellena campos con valores por defecto inventados.
    """
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail={
            "code": "unsupported_media_type",
            "content_type": image.content_type,
        })

    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail={"code": "empty_image"})
    if len(raw) > MAX_IMAGE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail={"code": "image_too_large",
                                                      "max_mb": MAX_IMAGE_MB})
    log.info(
        "analyze_received analysis_id=%s user_id=%s farm_id=%s grain_type=%s bytes=%d",
        analysis_id, user_id, farm_id, grain_type, len(raw),
    )

    try:
        result = analyze(raw, ALGORITHM_VERSION)
    except AnalysisFailure as e:
        log.warning("analysis_failure code=%s msg=%s", e.code, e.message)
        # 503 Service Unavailable: la imagen no es procesable con confianza.
        # NO fabricamos datos para esconder el problema.
        return JSONResponse(
            status_code=503,
            content={"error": e.code, "message": e.message},
        )
    except Exception:   # pragma: no cover
        log.exception("analyzer_unexpected_error")
        raise HTTPException(status_code=500, detail={"code": "internal_error"})

    log.info(
        "analyze_completed grains=%d overall=%.2f conf=%.3f elapsed_ms=%d",
        len(result.grains), result.overall_score,
        result.confidence_score, result.processing_time_ms,
    )
    return result
