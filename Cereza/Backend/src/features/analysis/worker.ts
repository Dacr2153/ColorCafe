/**
 * features/analysis/worker.ts — Worker que procesa analysis_queue.
 *
 * Por cada job:
 *  1. UPDATE image_analyses SET processing_status='processing'.
 *  2. Publica WebSocket → user:{userId} {type:'analysis.progress', status:'processing'}.
 *  3. Llama POST {PYTHON_ANALYSIS_URL}/analyze con la referencia de imagen y
 *     bytes (vía presigned URL — el servicio Python descarga). En este MVP
 *     enviamos los bytes vía multipart/form-data.
 *  4. Recibe {grains[], overall_score, quality_distribution, defect_distribution,
 *     confidence_score, algorithm_version, color_profile, moisture_estimated,
 *     processing_time_ms}.
 *  5. Inserta grain_detections (bulk) y UPDATE image_analyses con resultados.
 *  6. Publica analysis.completed por WebSocket y encola email analysisCompleted.
 *
 * ÉTICA: NUNCA generamos resultados sintéticos. Si Python falla o devuelve
 * estructura inválida, lanzamos error → el worker hace UPDATE status='failed'
 * (vía el manejador de reintentos en queue.ts) con error_message real.
 */
import { Buffer } from 'node:buffer';
import { request } from 'undici';
import type { PoolClient } from 'pg';
import type { Database } from '../../core/database.js';
import type { Storage } from '../../core/storage.js';
import type { JobQueue } from '../../core/queue.js';
import { ANALYSIS_QUEUE_SCHEMA } from '../../core/queue.js';
import type { WebSocketHub } from '../../core/websocket.js';
import type { Logger } from '../../core/logger.js';
import type { NotifyService } from '../notify/index.js';

export interface AnalysisWorkerDeps {
  db: Database;
  storage: Storage;
  queue: JobQueue;
  hub: WebSocketHub;
  log: Logger;
  notify: NotifyService;
  pythonAnalysisUrl: string;
  publicBaseUrl: string;
  /** Timeout para llamada al servicio Python (ms). */
  requestTimeoutMs?: number;
  concurrency?: number;
}

interface JobPayload {
  analysis_id: string;
  captured_at: Date;
  user_id: string;
  farm_id: string | null;
  storage_ref: string;
  metadata: {
    grainType?: string;
    sampleWeightG?: number | null;
    sha256?: string;
    width?: number | null;
    height?: number | null;
    sizeBytes?: number | null;
    mime?: string;
    retry?: boolean;
  } | null;
}

interface PythonGrain {
  index?: number;
  bbox: { x: number; y: number; w: number; h: number };
  classification: string;
  defects?: string[];
  confidence: number;
  color_lab?: { L: number; a: number; b: number };
}

interface PythonResponse {
  grains: PythonGrain[];
  overall_score: number;
  quality_distribution: Record<string, number>;
  defect_distribution: Record<string, number>;
  confidence_score: number;
  algorithm_version: string;
  color_profile?: Record<string, unknown> | null;
  moisture_estimated?: number | null;
  ai_interpretation?: string | null;
  ai_recommendations?: unknown | null;
  processing_time_ms: number;
}

export function startAnalysisWorker(deps: AnalysisWorkerDeps): () => Promise<void> {
  const {
    db, storage, queue, hub, log, notify,
    pythonAnalysisUrl, publicBaseUrl,
    requestTimeoutMs = 120_000,
    concurrency = 2,
  } = deps;

  return queue.startWorker<JobPayload>({
    schema: ANALYSIS_QUEUE_SCHEMA,
    concurrency,
    pollIntervalMs: 1500,
    maxAttempts: 3,
    handler: async (job, client) => {
      const p = job.payload;
      const analysisId = p.analysis_id;
      const userId = p.user_id;
      const capturedAt = p.captured_at;

      try {
        // 1) Mark processing
        await client.query(
          `UPDATE image_analyses
              SET processing_status = 'processing'
            WHERE id = $1 AND captured_at = $2`,
          [analysisId, capturedAt],
        );
        hub.publish(`user:${userId}`, 'analysis.progress', {
          analysisId, status: 'processing', startedAt: new Date().toISOString(),
        });
        hub.publish(`analysis:${analysisId}`, 'analysis.progress', {
          analysisId, status: 'processing',
        });

        // 2) Descarga el objeto de MinIO (a buffer) para enviarlo al servicio Python.
        const imgBuffer = await streamToBuffer(await storage.getStream(storage.buckets.analyses, p.storage_ref));

        // 3) Llamada al servicio Python.
        const result = await callPythonAnalysis(
          pythonAnalysisUrl,
          {
            analysisId,
            userId,
            farmId: p.farm_id,
            grainType: p.metadata?.grainType ?? 'pergamino',
            sampleWeightG: p.metadata?.sampleWeightG ?? null,
            mime: p.metadata?.mime ?? 'image/jpeg',
            width: p.metadata?.width ?? null,
            height: p.metadata?.height ?? null,
          },
          imgBuffer,
          requestTimeoutMs,
          log,
        );

        // 4) Validación estructural (NO se aceptan campos faltantes — failure honesto).
        validateResponse(result);

        // 5) Persiste resultados usando el cliente de la tx del worker.
        await persistResults(client, analysisId, capturedAt, result, log);

        // 6) Lee user info para email.
        const u = await client.query(
          `SELECT email,
                  COALESCE(p.nombre, '') AS nombre
             FROM users u
             LEFT JOIN producer_profiles p ON p.user_id = u.id
            WHERE u.id = $1`,
          [userId],
        );
        const email: string | undefined = u.rows[0]?.email;
        const nombre: string = u.rows[0]?.nombre ?? '';

        // 7) Publica WS + encola email DESPUÉS del COMMIT (postCommit hook).
        // Esto evita una carrera donde el frontend recibe `analysis.completed`
        // antes de que el COMMIT sea visible para un SELECT posterior.
        job.postCommit.push(() => {
          hub.publish(`user:${userId}`, 'analysis.completed', {
            analysisId,
            overallScore: result.overall_score,
            totalGrains: result.grains.length,
            qualityDistribution: result.quality_distribution,
          });
          hub.publish(`analysis:${analysisId}`, 'analysis.completed', {
            analysisId,
            overallScore: result.overall_score,
          });
        });
        if (email) {
          const link = `${publicBaseUrl}/analyses/${analysisId}`;
          job.postCommit.push(() => {
            void notify.queueEmail(email, 'analysisCompleted', [nombre || email, analysisId, result.overall_score, link])
              .catch((e) => log.warn({ err: (e as Error).message, analysisId }, 'queue_email_failed'));
          });
        }

        log.info({ analysisId, userId, overallScore: result.overall_score, grains: result.grains.length },
          'analysis_completed');
      } catch (err) {
        // Sincroniza estado en image_analyses con el fallo real. Si hay reintentos
        // exitosos, persistResults limpiará error_message y volverá a 'completed'.
        const message = (err as Error).message.slice(0, 1000);
        await db.pool_().query(
          `UPDATE image_analyses
              SET processing_status = 'failed', error_message = $3
            WHERE id = $1 AND captured_at = $2`,
          [analysisId, capturedAt, message],
        ).catch(() => { /* ignore */ });
        hub.publish(`user:${userId}`, 'analysis.failed', { analysisId, error: message });
        hub.publish(`analysis:${analysisId}`, 'analysis.failed', { analysisId, error: message });
        throw err;  // queue.ts contabiliza el intento y aplica backoff
      }
    },
  });
}

// ─────────────────────── helpers ───────────────────────

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function callPythonAnalysis(
  baseUrl: string,
  meta: {
    analysisId: string;
    userId: string;
    farmId: string | null;
    grainType: string;
    sampleWeightG: number | null;
    mime: string;
    width: number | null;
    height: number | null;
  },
  imageBuf: Buffer,
  timeoutMs: number,
  log: Logger,
): Promise<PythonResponse> {
  const url = baseUrl.replace(/\/$/, '') + '/analyze';
  // multipart/form-data sencillo (boundary fijo).
  const boundary = '----CafeVision' + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];
  const append = (name: string, value: string) => {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ));
  };
  append('analysis_id', meta.analysisId);
  append('user_id', meta.userId);
  if (meta.farmId) append('farm_id', meta.farmId);
  append('grain_type', meta.grainType);
  if (meta.sampleWeightG !== null) append('sample_weight_g', String(meta.sampleWeightG));
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="img"\r\n` +
    `Content-Type: ${meta.mime}\r\n\r\n`,
  ));
  parts.push(imageBuf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const t0 = Date.now();
  const res = await request(url, {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    body,
    bodyTimeout: timeoutMs,
    headersTimeout: timeoutMs,
  });
  const text = await res.body.text();
  log.debug({ analysisId: meta.analysisId, status: res.statusCode, ms: Date.now() - t0 }, 'python_analysis_response');
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`python_analysis_error status=${res.statusCode} body=${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text) as PythonResponse;
  } catch {
    throw new Error('python_analysis_invalid_json');
  }
}

function validateResponse(r: PythonResponse): void {
  if (!Array.isArray(r.grains)) throw new Error('invalid_response: grains_missing');
  if (typeof r.overall_score !== 'number' || !Number.isFinite(r.overall_score)) {
    throw new Error('invalid_response: overall_score_invalid');
  }
  if (r.overall_score < 0 || r.overall_score > 100) {
    throw new Error('invalid_response: overall_score_out_of_range');
  }
  if (typeof r.confidence_score !== 'number' || r.confidence_score < 0 || r.confidence_score > 1) {
    throw new Error('invalid_response: confidence_score_invalid');
  }
  if (!r.quality_distribution || typeof r.quality_distribution !== 'object') {
    throw new Error('invalid_response: quality_distribution_missing');
  }
  if (!r.defect_distribution || typeof r.defect_distribution !== 'object') {
    throw new Error('invalid_response: defect_distribution_missing');
  }
  if (typeof r.algorithm_version !== 'string' || !r.algorithm_version) {
    throw new Error('invalid_response: algorithm_version_missing');
  }
  for (const g of r.grains) {
    if (!g.bbox || typeof g.bbox.x !== 'number') throw new Error('invalid_response: grain_bbox_invalid');
    if (typeof g.classification !== 'string' || !g.classification) {
      throw new Error('invalid_response: grain_classification_missing');
    }
    if (typeof g.confidence !== 'number' || g.confidence < 0 || g.confidence > 1) {
      throw new Error('invalid_response: grain_confidence_invalid');
    }
  }
}

async function persistResults(
  client: PoolClient,
  analysisId: string,
  capturedAt: Date,
  r: PythonResponse,
  log: Logger,
): Promise<void> {
  await client.query(
    `UPDATE image_analyses SET
        processing_status = 'completed',
        processing_time_ms = $3,
        algorithm_version = $4,
        total_grains_detected = $5,
        quality_distribution = $6,
        defect_distribution = $7,
        overall_score = $8,
        moisture_estimated = $9,
        color_profile = $10,
        ai_interpretation = $11,
        ai_recommendations = $12,
        confidence_score = $13,
        error_message = NULL
      WHERE id = $1 AND captured_at = $2`,
    [
      analysisId,
      capturedAt,
      Math.round(r.processing_time_ms ?? 0),
      r.algorithm_version,
      r.grains.length,
      JSON.stringify(r.quality_distribution),
      JSON.stringify(r.defect_distribution),
      r.overall_score,
      r.moisture_estimated ?? null,
      r.color_profile ? JSON.stringify(r.color_profile) : null,
      r.ai_interpretation ?? null,
      r.ai_recommendations ? JSON.stringify(r.ai_recommendations) : null,
      r.confidence_score,
    ],
  );

  if (r.grains.length === 0) return;

  // Bulk insert grain_detections vía JSONB → expandido con jsonb_array_elements.
  // Esto evita el problema de UNNEST con columnas TEXT[] anidadas (defects).
  const payload = r.grains.map((g, i) => ({
    idx: g.index ?? i,
    x: g.bbox.x,
    y: g.bbox.y,
    w: g.bbox.w,
    h: g.bbox.h,
    cls: g.classification,
    df: g.defects ?? [],
    cf: g.confidence,
    cl: g.color_lab ?? null,
  }));

  await client.query(
    `INSERT INTO grain_detections (
        analysis_id, captured_at, grain_index, bbox_x, bbox_y, bbox_w, bbox_h,
        classification, defects, confidence, color_lab
     )
     SELECT $1::uuid,
            $2::timestamptz,
            (e->>'idx')::smallint,
            (e->>'x')::smallint,
            (e->>'y')::smallint,
            (e->>'w')::smallint,
            (e->>'h')::smallint,
            e->>'cls',
            ARRAY(SELECT jsonb_array_elements_text(e->'df'))::text[],
            (e->>'cf')::numeric,
            CASE WHEN e->'cl' = 'null'::jsonb OR e->'cl' IS NULL THEN NULL ELSE e->'cl' END
       FROM jsonb_array_elements($3::jsonb) AS e`,
    [analysisId, capturedAt, JSON.stringify(payload)],
  );

  log.debug({ analysisId, grains: r.grains.length }, 'grain_detections_persisted');
}
