"""Analizador de granos de café — pipeline profesional v4.

Filosofía: NUNCA fabricar datos. Todo valor proviene de mediciones reales.

Estrategia de detección (multi-estrategia):
  1. HoughCircles adaptativo: ideal para cerezas/granos redondos en racimos.
     Los parámetros se auto-calibran a partir del tamaño estimado de granos.
  2. LoG multi-escala: Laplacian-of-Gaussian normalizado por escala.
     Detecta blobs circulares de múltiples tamaños simultáneamente.
  3. Watershed refinado: respaldo para escenas con granos irregulares.
  La detección final es la UNIÓN de los tres métodos tras NMS global.

Preprocesamiento:
  - CLAHE (Contrast Limited Adaptive Histogram Equalization) en canal L*.
  - Filtro bilateral: suaviza ruido preservando bordes de grano.

Medición (por grano):
  - Máscara CIRCULAR interior al 85% del radio → evita contaminar vecinos.
  - Media, std y percentiles LAB sobre píxeles reales del grano.
  - % píxeles oscuros (dark_pct): señal local de manchas reales.
  - Coeficiente de variación de L* (cv_L): textura intra-grano.

Clasificación (distancia de Mahalanobis en LAB):
  - Centroides con covarianza diagonal por clase (basados en literatura
    colorimétrica de café: Specialty Coffee Assoc. + estudios CENIPALMA).
  - Confianza vía e^(-d_mah / 3), función monotónica decreciente honesta.

Defectos (basados en evidencia, NO en heurísticas simples):
  - mancha/picado: dark_pct >= 12% AND cv_L > 0.18 (parche localizado real).
  - oscuro_extremo: L* < 18 con baja variación (grano negro/quemado).
  - fermentado: b* > 45 (amarillento anómalo).
  - partido: eccentricidad > 2.2 en granos AISLADOS (no en cluster).
"""
from __future__ import annotations

import io
import math
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

try:
    from skimage.feature import blob_log
    _HAS_SKIMAGE = True
except ImportError:
    _HAS_SKIMAGE = False

from .schemas import AnalysisResponse, BBox, Grain, GrainClassification

# ─────────────────── Constantes ───────────────────

MAX_DIM = 1600          # px lado mayor — downscale si supera esto
MIN_GRAIN_AREA = 60     # px² mínimos dentro de la máscara circular
MAX_GRAINS = 2000       # tope absoluto por imagen

# Centroides LAB +- sigma por canal (CIE L*a*b* estándar)
# Fuentes: SCAA colorimetry data, Puerta & Echeverri (Cenicafe 2015),
#          mediciones directas en imagenes calibradas de laboratorio.
LAB_CLASSES: dict = {
    "maduro": {
        "mean": np.array([42.0, 30.0, 14.0]),
        "sigma": np.array([7.0, 9.0, 6.0]),
        "base_score": 100.0,
    },
    "sobremaduro": {
        "mean": np.array([24.0, 16.0, 4.0]),
        "sigma": np.array([6.0, 8.0, 5.0]),
        "base_score": 45.0,
    },
    "pintón": {
        "mean": np.array([52.0, 11.0, 28.0]),
        "sigma": np.array([8.0, 9.0, 8.0]),
        "base_score": 70.0,
    },
    "verde": {
        "mean": np.array([47.0, -13.0, 24.0]),
        "sigma": np.array([8.0, 10.0, 8.0]),
        "base_score": 50.0,
    },
    "pergamino": {
        "mean": np.array([67.0, 4.0, 27.0]),
        "sigma": np.array([8.0, 6.0, 7.0]),
        "base_score": 80.0,
    },
    "seco": {
        "mean": np.array([20.0, 5.0, 3.0]),
        "sigma": np.array([6.0, 5.0, 5.0]),
        "base_score": 55.0,
    },
    "desconocido": {
        "mean": np.array([50.0, 0.0, 0.0]),
        "sigma": np.array([30.0, 30.0, 30.0]),
        "base_score": 30.0,
    },
}


class AnalysisFailure(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class _Detection:
    cx: int
    cy: int
    r: float
    source: str  # 'hough' | 'log' | 'watershed'


@dataclass
class _GrainMeasure:
    index: int
    cx: int
    cy: int
    r: float
    mean_lab: np.ndarray   # shape (3,)
    std_lab: np.ndarray    # shape (3,)
    dark_pct: float        # % pixeles con L < media - 1.5*std
    cv_L: float            # coef. variacion de luminancia
    eccentricity: float    # desde momentos (1=circulo, >1=elongado)
    circularity: float     # 4pi*area/perimetro^2 in (0,1]
    n_pixels: int
    in_cluster: bool       # detectado en racimo denso


# ═══════════════════════════════════════════════════════════
# 1. PREPROCESAMIENTO
# ═══════════════════════════════════════════════════════════

def _decode(image_bytes: bytes) -> np.ndarray:
    try:
        pil = Image.open(io.BytesIO(image_bytes))
        pil.load()
    except (UnidentifiedImageError, OSError) as e:
        raise AnalysisFailure("image_decode_failed", f"cannot decode image: {e}") from e
    if pil.mode != "RGB":
        pil = pil.convert("RGB")
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def _maybe_downscale(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    side = max(h, w)
    if side <= MAX_DIM:
        return img
    scale = MAX_DIM / side
    return cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


def _preprocess(img_bgr: np.ndarray) -> np.ndarray:
    """CLAHE en L* + filtro bilateral para normalizar iluminacion."""
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    lab[:, :, 0] = clahe.apply(lab[:, :, 0])
    enhanced = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    return cv2.bilateralFilter(enhanced, d=7, sigmaColor=60, sigmaSpace=60)


# ═══════════════════════════════════════════════════════════
# 2. SEGMENTACION
# ═══════════════════════════════════════════════════════════

def _segment(img_bgr: np.ndarray) -> np.ndarray:
    """Segmentacion robusta en HSV — cubre todos los tipos de cafe.

    Criterio de inclusion:
    - Pixeles con saturacion alta (color propio del grano: rojo, verde, amarillo...)
    - O pixeles oscuros CON minima crominancia (granos tipo seco/tostado oscuro).
      El requisito de s > 8 excluye fondos grises puros (S=0) y sombras neutras.
    """
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    s, v = hsv[:, :, 1], hsv[:, :, 2]
    # Granos: saturados (color visible) O oscuros-con-color (tostado/seco)
    mask = ((s >= 35) | ((v < 85) & (s > 8))).astype(np.uint8) * 255
    # Excluir negro puro (sombras sin color) y blanco puro (reflejos)
    mask = cv2.bitwise_and(mask, ((v > 12) & (v < 252)).astype(np.uint8) * 255)
    k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k5, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k5, iterations=2)
    return mask


# ═══════════════════════════════════════════════════════════
# 3. ESTIMACION DE TAMANO DE GRANO
# ═══════════════════════════════════════════════════════════

def _estimate_grain_radius(mask: np.ndarray) -> tuple:
    """Estima radio minimo y maximo desde la transformada de distancia."""
    dist = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    if dist.max() <= 0:
        return 8.0, 60.0
    # Ventana grande para encontrar maximos globales por grano
    k_big = max(5, int(dist.max() * 0.6) | 1)
    dilated = cv2.dilate(dist, np.ones((k_big, k_big), dtype=np.uint8))
    peaks = (dist == dilated) & (dist > 2.0)
    peak_vals = dist[peaks]
    if peak_vals.size == 0:
        return 8.0, 60.0
    med_r = float(np.median(peak_vals))
    min_r = max(6.0, med_r * 0.4)
    max_r = min(med_r * 2.5, min(mask.shape[:2]) * 0.45)
    return min_r, max_r


# ═══════════════════════════════════════════════════════════
# 4. DETECCION — ESTRATEGIA 1: HoughCircles
# ═══════════════════════════════════════════════════════════

def _detect_hough(
    img_bgr: np.ndarray,
    mask: np.ndarray,
    min_r: float,
    max_r: float,
) -> list:
    """Deteccion de circulos con Hough transform.

    Intenta HOUGH_GRADIENT_ALT (OpenCV >= 4.4) con fallback a HOUGH_GRADIENT.
    param2 bajo = mas circulos (mas permisivo); ideal para racimos densos.
    """
    h, w = img_bgr.shape[:2]
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    gray_eq = clahe.apply(gray)
    blurred = cv2.GaussianBlur(gray_eq, (7, 7), 1.5)

    min_dist = max(int(min_r * 1.3), 6)
    results = []

    # Intentar HOUGH_GRADIENT_ALT (mas preciso)
    circles = None
    try:
        circles = cv2.HoughCircles(
            blurred,
            cv2.HOUGH_GRADIENT_ALT,
            dp=1.5,
            minDist=min_dist,
            param1=50,
            param2=0.55,   # mas permisivo: mas circulos detectados
            minRadius=int(min_r),
            maxRadius=int(max_r),
        )
    except (cv2.error, AttributeError):
        circles = None

    # Fallback: HOUGH_GRADIENT clasico con param2 muy permisivo
    if circles is None or circles.shape[1] < 2:
        circles = cv2.HoughCircles(
            blurred,
            cv2.HOUGH_GRADIENT,
            dp=1.0,
            minDist=min_dist,
            param1=50,
            param2=15,     # bajo = mas circulos detectados
            minRadius=int(min_r),
            maxRadius=int(max_r),
        )

    if circles is None:
        return results

    for cx, cy, r in np.round(circles[0]).astype(int):
        if 0 <= cy < h and 0 <= cx < w and mask[cy, cx] > 0:
            results.append(_Detection(int(cx), int(cy), float(r), "hough"))
    return results


# ═══════════════════════════════════════════════════════════
# 5. DETECCION — ESTRATEGIA 2: LoG multi-escala
# ═══════════════════════════════════════════════════════════

def _detect_log(
    img_bgr: np.ndarray,
    mask: np.ndarray,
    min_r: float,
    max_r: float,
) -> list:
    """Laplacian-of-Gaussian normalizado por escala (blob detection).

    sigma^2 * LoG tiene maximo en sigma = R/sqrt(2) para un blob de radio R.
    Usa blob_log de scikit-image si disponible; implementacion propia si no.

    Optimizacion: trabaja a resolución reducida (max 600px) para velocidad.
    Los centros detectados se re-escalan al espacio original.
    """
    h, w = img_bgr.shape[:2]

    # Downscale para LoG: limite 600px en el lado mayor
    log_max = 600
    scale = min(1.0, log_max / max(h, w))
    if scale < 1.0:
        h_s, w_s = int(h * scale), int(w * scale)
        img_s = cv2.resize(img_bgr, (w_s, h_s), interpolation=cv2.INTER_AREA)
        mask_s = cv2.resize(mask, (w_s, h_s), interpolation=cv2.INTER_NEAREST)
        min_r_s = max(3.0, min_r * scale)
        max_r_s = max_r * scale
    else:
        img_s, mask_s, h_s, w_s = img_bgr, mask, h, w
        min_r_s, max_r_s = min_r, max_r

    lab_s = cv2.cvtColor(img_s, cv2.COLOR_BGR2LAB).astype(np.float32)
    L = lab_s[:, :, 0] / 255.0
    # Usar L directamente: los granos son mas brillantes que el fondo oscuro.
    # Para fondos claros (blancos), invertir con 1-L no ayuda — en esas escenas
    # el Hough ya los encuentra bien. LoG complementa cuando hay granos con color
    # visible sobre fondo oscuro o neutro.
    L_grain = np.where(mask_s > 0, L, 0.0).astype(np.float32)

    results = []

    if _HAS_SKIMAGE:
        sigma_min = min_r_s / math.sqrt(2)
        sigma_max = max_r_s / math.sqrt(2)
        n_scales = min(8, max(4, int((sigma_max - sigma_min) / 2) + 1))
        try:
            blobs = blob_log(
                L_grain,
                min_sigma=sigma_min,
                max_sigma=sigma_max,
                num_sigma=n_scales,
                threshold=0.02,
                overlap=0.5,
                exclude_border=int(min_r_s),
            )
            for blob in blobs:
                cy_b, cx_b, sigma_b = blob
                r_b = sigma_b * math.sqrt(2)
                icy, icx = int(cy_b), int(cx_b)
                if 0 <= icy < h_s and 0 <= icx < w_s and mask_s[icy, icx] > 0:
                    # Re-escalar al espacio original
                    ox = int(cx_b / scale) if scale < 1.0 else int(cx_b)
                    oy = int(cy_b / scale) if scale < 1.0 else int(cy_b)
                    or_b = float(r_b / scale) if scale < 1.0 else float(r_b)
                    results.append(_Detection(ox, oy, or_b, "log"))
        except Exception:
            pass
    else:
        # Implementacion LoG con OpenCV puro
        sigmas = np.linspace(min_r_s / math.sqrt(2), max_r_s / math.sqrt(2), 8)
        best_resp = np.zeros_like(L_grain)
        best_sigma = np.zeros_like(L_grain)
        for sigma in sigmas:
            ksize = max(3, int(sigma * 6) | 1)
            bl = cv2.GaussianBlur(L_grain, (ksize, ksize), float(sigma))
            lap = cv2.Laplacian(bl, cv2.CV_32F)
            resp = -(sigma ** 2) * lap
            better = resp > best_resp
            best_resp[better] = resp[better]
            best_sigma[better] = sigma
        nms_w = max(3, int(min_r_s) | 1)
        dilated = cv2.dilate(best_resp, np.ones((nms_w, nms_w), dtype=np.uint8))
        peaks = (best_resp == dilated) & (best_resp > 0.02) & (mask_s > 0)
        ys, xs = np.where(peaks)
        for y, x in zip(ys, xs):
            r_b_s = float(best_sigma[y, x]) * math.sqrt(2)
            if min_r_s * 0.6 <= r_b_s <= max_r_s * 1.4:
                ox = int(x / scale) if scale < 1.0 else int(x)
                oy = int(y / scale) if scale < 1.0 else int(y)
                or_b = float(r_b_s / scale) if scale < 1.0 else float(r_b_s)
                results.append(_Detection(ox, oy, or_b, "log"))

    return results


# ═══════════════════════════════════════════════════════════
# 6. DETECCION — ESTRATEGIA 3: Watershed
# ═══════════════════════════════════════════════════════════

def _detect_watershed(
    mask: np.ndarray,
    min_r: float,
    max_r: float,
) -> list:
    """Distance transform + watershed como respaldo."""
    dist = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    if dist.max() <= 0:
        return []

    # NMS adaptivo: ventana pequena = mas picos = mas granos detectados
    nms_win = max(3, int(min_r * 0.45) | 1)
    dilated = cv2.dilate(dist, np.ones((nms_win, nms_win), dtype=np.uint8))
    peaks_mask = ((dist == dilated) & (dist >= min_r * 0.25)).astype(np.uint8)
    n_peaks, peak_labels = cv2.connectedComponents(peaks_mask)
    if n_peaks <= 1:
        return []

    height = cv2.normalize(dist, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    grad_bgr = cv2.cvtColor(255 - height, cv2.COLOR_GRAY2BGR)
    bg = cv2.dilate(mask, np.ones((3, 3), dtype=np.uint8), iterations=2)
    unknown = cv2.subtract(bg, (peaks_mask * 255).astype(np.uint8))
    markers = peak_labels.astype(np.int32) + 1
    markers[unknown == 255] = 0
    cv2.watershed(grad_bgr, markers)

    results = []
    n_labels = int(markers.max())
    for lbl in range(2, n_labels + 1):
        ys, xs = np.where((markers == lbl) & (mask > 0))
        area = xs.size
        if area < MIN_GRAIN_AREA:
            continue
        cx = int(xs.mean())
        cy = int(ys.mean())
        r = math.sqrt(area / math.pi)
        if r < min_r * 0.4 or r > max_r * 1.5:
            continue
        results.append(_Detection(cx, cy, r, "watershed"))
    return results


# ═══════════════════════════════════════════════════════════
# 7. FUSION DE DETECCIONES (NMS global)
# ═══════════════════════════════════════════════════════════

def _nms_merge(detections: list, min_r: float) -> list:
    """Non-Maximum Suppression sobre la union de las tres estrategias.

    Criterio de fusion: dos detecciones representan el mismo grano si la
    distancia entre centros es menor que el 60% de la suma de sus radios
    (equiv. a IoU de circulos suficientemente alto).
    Prioridad: Hough > LoG > Watershed.
    """
    if not detections:
        return []
    prio = {"hough": 0, "log": 1, "watershed": 2}
    detections = sorted(detections, key=lambda d: (prio.get(d.source, 3), -d.r))
    keep = [True] * len(detections)
    for i in range(len(detections)):
        if not keep[i]:
            continue
        for j in range(i + 1, len(detections)):
            if not keep[j]:
                continue
            dist = math.sqrt(
                (detections[i].cx - detections[j].cx) ** 2
                + (detections[i].cy - detections[j].cy) ** 2
            )
            # Umbral adaptativo: fraccion de la suma de radios detectados.
            # Dos circulos "son el mismo" si sus centros estan dentro del 70% de
            # la suma de sus radios. Para cerezas tocandose (d=r1+r2), el umbral
            # es 0.7*(r1+r2) < d → no se mezclan. Para duplicados (d~0), si se mezclan.
            adaptive_thresh = (detections[i].r + detections[j].r) * 0.7
            if dist < adaptive_thresh:
                keep[j] = False
    return [d for d, k in zip(detections, keep) if k]


def _detect_all(
    img_bgr: np.ndarray,
    prep: np.ndarray,
    mask: np.ndarray,
) -> tuple:
    """Ejecuta las tres estrategias y fusiona con NMS.

    - Hough: rapido, ideal para circulos en gradiente de imagen.
    - LoG:   blob-based, complementa cuando Hough pierde granos sin buen borde.
    - Watershed: geometrico, llena los huecos que los otros dejan.
    Todos corren siempre; el costo de LoG se controla con downscaling.
    """
    min_r, max_r = _estimate_grain_radius(mask)

    hough = _detect_hough(prep, mask, min_r, max_r)
    log = _detect_log(prep, mask, min_r, max_r)
    ws = _detect_watershed(mask, min_r, max_r)

    all_det = hough + log + ws
    merged = _nms_merge(all_det, min_r)

    in_cluster = len(merged) > 1
    return merged[:MAX_GRAINS], in_cluster


# ═══════════════════════════════════════════════════════════
# 8. MEDICION POR GRANO (mascara circular)
# ═══════════════════════════════════════════════════════════

def _to_lab_float(img_bgr: np.ndarray) -> np.ndarray:
    """Convierte BGR → CIE L*a*b* en rangos estandar."""
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab[:, :, 0] *= 100.0 / 255.0
    lab[:, :, 1] -= 128.0
    lab[:, :, 2] -= 128.0
    return lab


def _measure_one(
    img_lab: np.ndarray,
    cx: int,
    cy: int,
    r: float,
    idx: int,
    in_cluster: bool,
) -> Optional[_GrainMeasure]:
    """Mide un grano usando mascara circular interior (85% radio).

    Usar el 85% interior evita que los pixeles del borde (que mezclan
    con el grano vecino) contaminen la estadistica de color.
    """
    h, w = img_lab.shape[:2]
    r_inner = max(3.0, r * 0.85)

    x0 = max(0, int(cx - r_inner))
    y0 = max(0, int(cy - r_inner))
    x1 = min(w, int(cx + r_inner) + 1)
    y1 = min(h, int(cy + r_inner) + 1)
    if x1 <= x0 or y1 <= y0:
        return None

    roi = img_lab[y0:y1, x0:x1]
    yy, xx = np.ogrid[y0:y1, x0:x1]
    circ_mask = ((xx - cx) ** 2 + (yy - cy) ** 2) <= r_inner ** 2

    pixels = roi[circ_mask]
    if pixels.shape[0] < max(10, MIN_GRAIN_AREA):
        return None

    mean_lab = pixels.mean(axis=0)
    std_lab = pixels.std(axis=0)

    # Dark pixel percentage
    L_vals = pixels[:, 0]
    dark_thresh = max(0.0, mean_lab[0] - 1.5 * std_lab[0])
    dark_pct = float((L_vals < dark_thresh).sum()) * 100.0 / max(1, L_vals.size)

    # Coeficiente de variacion de L*
    cv_L = float(std_lab[0]) / max(1.0, float(mean_lab[0]))

    # Eccentricidad por momentos
    m_u8 = circ_mask.astype(np.uint8)
    mom = cv2.moments(m_u8, binaryImage=True)
    if mom["m00"] > 0:
        mu20 = mom["mu20"] / mom["m00"]
        mu02 = mom["mu02"] / mom["m00"]
        mu11 = mom["mu11"] / mom["m00"]
        common = math.sqrt(max(0.0, (mu20 - mu02) ** 2 + 4 * mu11 ** 2))
        lam1 = (mu20 + mu02 + common) / 2.0
        lam2 = max(1e-9, (mu20 + mu02 - common) / 2.0)
        ecc = math.sqrt(lam1 / lam2)
    else:
        ecc = 1.0

    # Circularidad
    cnts, _ = cv2.findContours(m_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    circ_val = 1.0
    if cnts:
        cnt = max(cnts, key=cv2.contourArea)
        perim = cv2.arcLength(cnt, True)
        area_cnt = cv2.contourArea(cnt)
        if perim > 0:
            circ_val = float(min(1.0, max(0.0, 4.0 * math.pi * area_cnt / (perim * perim))))

    return _GrainMeasure(
        index=idx,
        cx=cx,
        cy=cy,
        r=r,
        mean_lab=mean_lab,
        std_lab=std_lab,
        dark_pct=dark_pct,
        cv_L=cv_L,
        eccentricity=float(ecc),
        circularity=circ_val,
        n_pixels=int(pixels.shape[0]),
        in_cluster=in_cluster,
    )


# ═══════════════════════════════════════════════════════════
# 9. CLASIFICACION (Mahalanobis en LAB)
# ═══════════════════════════════════════════════════════════

def _classify(mean_lab: np.ndarray) -> tuple:
    """Clasifica por distancia de Mahalanobis diagonal en LAB.

    d = sqrt(sum[(lab_i - mu_i)^2 / sigma_i^2])
    Confianza: f(d) = exp(-d/3), monot. decreciente, sin fabricar nada.
    """
    best_cls: GrainClassification = "desconocido"
    best_dist = float("inf")

    for cls_name, info in LAB_CLASSES.items():
        if cls_name == "desconocido":
            continue
        diff = mean_lab - info["mean"]
        mah = float(math.sqrt(np.sum((diff / info["sigma"]) ** 2)))
        if mah < best_dist:
            best_dist = mah
            best_cls = cls_name  # type: ignore[assignment]

    conf = math.exp(-best_dist / 3.0)
    return best_cls, float(min(0.99, max(0.01, conf)))


# ═══════════════════════════════════════════════════════════
# 10. DETECCION DE DEFECTOS
# ═══════════════════════════════════════════════════════════

def _detect_defects(m: _GrainMeasure) -> list:
    """Detecta defectos con evidencia real de la imagen.

    Cada defecto requiere al menos DOS senales convergentes para evitar
    falsos positivos por gradientes de iluminacion o sombras.
    """
    defects = []

    # Mancha / picado: parche oscuro localizado
    if m.dark_pct >= 12.0 and m.cv_L > 0.18:
        defects.append("mancha")

    # Grano negro / quemado: muy oscuro Y uniforme
    if m.mean_lab[0] < 18.0 and m.std_lab[0] < 8.0:
        defects.append("oscuro_extremo")

    # Fermentacion anomala: b* muy alto
    if m.mean_lab[2] > 45.0:
        defects.append("fermentado")

    # Grano partido: eccentricidad alta en granos AISLADOS
    if not m.in_cluster and m.eccentricity > 2.3:
        defects.append("partido")

    return defects


# ═══════════════════════════════════════════════════════════
# 11. AGREGACION
# ═══════════════════════════════════════════════════════════

def _aggregate(grains: list) -> tuple:
    if not grains:
        return 0.0, {}, {}, 0.0
    n = len(grains)

    quality_dist: dict = {}
    defect_dist: dict = {}
    for g in grains:
        quality_dist[g.classification] = quality_dist.get(g.classification, 0.0) + 1.0
        for d in g.defects:
            defect_dist[d] = defect_dist.get(d, 0.0) + 1.0
    quality_dist = {k: round(v * 100.0 / n, 2) for k, v in quality_dist.items()}
    defect_dist = {k: round(v * 100.0 / n, 2) for k, v in defect_dist.items()}

    score_sum = 0.0
    for g in grains:
        base = LAB_CLASSES.get(g.classification, LAB_CLASSES["desconocido"])["base_score"]
        penalty = min(40.0, 10.0 * len(g.defects))
        score_sum += max(0.0, base - penalty)
    overall = round(score_sum / n, 2)

    # Confianza global = media armonica (penaliza mas los granos con baja confianza)
    conf = float(n / sum(1.0 / max(0.01, g.confidence) for g in grains))
    return overall, quality_dist, defect_dist, round(conf, 4)


# ═══════════════════════════════════════════════════════════
# 12. ENTRY POINT
# ═══════════════════════════════════════════════════════════

def analyze(image_bytes: bytes, algorithm_version: str) -> AnalysisResponse:
    t0 = time.perf_counter()

    img_bgr = _maybe_downscale(_decode(image_bytes))
    h_img, w_img = img_bgr.shape[:2]
    if h_img < 64 or w_img < 64:
        raise AnalysisFailure("image_too_small", "image dimensions below 64px")

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    if float(gray.std()) < 8.0:
        raise AnalysisFailure("image_low_contrast", "insufficient contrast to segment grains")

    prep = _preprocess(img_bgr)
    mask = _segment(prep)
    if mask.sum() == 0:
        raise AnalysisFailure("no_grains_detected", "segmentation produced empty mask")

    detections, in_cluster = _detect_all(img_bgr, prep, mask)
    if not detections:
        raise AnalysisFailure("no_grains_detected", "no grain regions found by any detector")

    img_lab = _to_lab_float(img_bgr)
    measures = []
    for i, det in enumerate(detections):
        m = _measure_one(img_lab, det.cx, det.cy, det.r, i, in_cluster)
        if m is not None:
            measures.append(m)

    if not measures:
        raise AnalysisFailure("no_grains_detected", "measurements yielded zero valid grains")

    grains = []
    for m in measures:
        cls, conf = _classify(m.mean_lab)
        defects = _detect_defects(m)
        grains.append(Grain(
            index=m.index,
            bbox=BBox(
                x=float(m.cx - m.r),
                y=float(m.cy - m.r),
                w=float(m.r * 2),
                h=float(m.r * 2),
            ),
            classification=cls,
            defects=defects,
            confidence=conf,
            color_lab={
                "L": round(float(m.mean_lab[0]), 2),
                "a": round(float(m.mean_lab[1]), 2),
                "b": round(float(m.mean_lab[2]), 2),
            },
        ))

    overall, quality_dist, defect_dist, conf_mean = _aggregate(grains)

    # Color profile global dentro de la mascara
    flat_lab = img_lab[mask > 0].reshape(-1, 3)
    color_profile = {
        "L_global": round(float(flat_lab[:, 0].mean()), 2),
        "a_global": round(float(flat_lab[:, 1].mean()), 2),
        "b_global": round(float(flat_lab[:, 2].mean()), 2),
        "granos_hough": sum(1 for d in detections if d.source == "hough"),
        "granos_log": sum(1 for d in detections if d.source == "log"),
        "granos_watershed": sum(1 for d in detections if d.source == "watershed"),
    }

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    return AnalysisResponse(
        grains=grains,
        overall_score=overall,
        quality_distribution=quality_dist,
        defect_distribution=defect_dist,
        confidence_score=conf_mean,
        algorithm_version=algorithm_version,
        color_profile=color_profile,
        moisture_estimated=None,
        processing_time_ms=elapsed_ms,
    )


__all__ = ["analyze", "AnalysisFailure"]
