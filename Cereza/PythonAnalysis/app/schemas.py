"""Schemas Pydantic del contrato HTTP entre Backend Node y servicio Python.

El contrato exacto está validado por `Cereza/Backend/src/features/analysis/worker.ts`
en `validateResponse`. Mantenerlos sincronizados.
"""
from __future__ import annotations

from typing import Dict, List, Literal

from pydantic import BaseModel, Field


class BBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


GrainClassification = Literal[
    "verde",          # inmaduro
    "pintón",         # transición
    "maduro",         # óptimo
    "sobremaduro",    # pasado
    "seco",           # post-secado
    "pergamino",      # con cáscara
    "trilla",         # almendra verde
    "desconocido",    # no clasificable con certeza
]


class Grain(BaseModel):
    index: int
    bbox: BBox
    classification: GrainClassification
    defects: List[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    color_lab: Dict[str, float]   # {"L": x, "a": y, "b": z}


class AnalysisResponse(BaseModel):
    grains: List[Grain]
    overall_score: float = Field(ge=0.0, le=100.0)
    quality_distribution: Dict[str, float]   # %
    defect_distribution: Dict[str, float]    # %
    confidence_score: float = Field(ge=0.0, le=1.0)
    algorithm_version: str
    color_profile: Dict[str, float]
    moisture_estimated: float | None = None
    processing_time_ms: int
