/**
 * features/analysis/service.ts — Lógica de análisis de granos de café.
 *
 * Pipeline (lado backend):
 *  1. Upload de imagen → magic-bytes validados.
 *  2. Compute SHA256 → dedupe contra `image_analyses.image_hash` del mismo
 *     usuario (mismo hash + mismo user_id = reusa análisis previo).
 *  3. Sube a MinIO bucket `cafe-analyses` con key `analyses/{userId}/{sha256}{ext}`.
 *  4. Genera miniatura WebP 400px (sharp) → key `thumbs/...`.
 *  5. INSERT image_analyses (processing_status='queued'), enqueue analysis_queue.
 *  6. Devuelve {id, capturedAt, processingStatus} inmediatamente.
 *
 * El worker (analysis/worker.ts) hace el resto: llama al servicio Python,
 * persiste resultados, publica al WebSocket, encola email.
 *
 * Política ética: NUNCA fabricamos resultados. Si Python no responde o devuelve
 * error, el análisis queda en 'failed' con error_message — el frontend muestra
 * el error, no datos falsos.
 */
import crypto from 'node:crypto';
import sharp from 'sharp';
import type { Pool } from 'pg';
import type { Database } from '../../core/database.js';
import type { Storage } from '../../core/storage.js';
import type { Cache } from '../../core/cache.js';
import type { JobQueue } from '../../core/queue.js';
import type { Logger } from '../../core/logger.js';
import { errors } from '../../core/errors.js';

export interface UploadedImage {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  size: number;
}

export interface SubmitAnalysisInput {
  image: UploadedImage;
  farmId?: string | null;
  grainType?: 'cereza' | 'pergamino' | 'trilla';
  sampleWeightG?: number | null;
  captureConditions?: {
    luz?: string;
    distanciaCm?: number;
    angulo?: string;
    temperatura?: number;
    humedad?: number;
  } | null;
}

export interface AnalysisSummary {
  id: string;
  capturedAt: string;
  userId: string;
  farmId: string | null;
  grainType: string;
  imageHash: string;
  imageStorageRef: string;
  thumbnailStorageRef: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  fileSizeBytes: number | null;
  processingStatus: 'queued' | 'processing' | 'completed' | 'failed';
  totalGrainsDetected: number | null;
  qualityDistribution: Record<string, number> | null;
  defectDistribution: Record<string, number> | null;
  overallScore: number | null;
  moistureEstimated: number | null;
  confidenceScore: number | null;
  algorithmVersion: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export class AnalysisService {
  constructor(
    private db: Database,
    private storage: Storage,
    private cache: Cache,
    private queue: JobQueue,
    private log: Logger,
  ) {}

  private pool(): Pool { return this.db.pool_(); }

  // ───────────────────────── submit ─────────────────────────

  async submit(userId: string, input: SubmitAnalysisInput): Promise<AnalysisSummary> {
    const { image } = input;
    if (image.size <= 0) throw errors.badRequest('empty_file');

    // Si farmId provisto, verifica que pertenezca al usuario.
    if (input.farmId) {
      const own = await this.pool().query(
        `SELECT 1 FROM farms WHERE id = $1 AND producer_id = $2`,
        [input.farmId, userId],
      );
      if (own.rowCount === 0) throw errors.forbidden('farm_not_owned');
    }

    const sha256 = crypto.createHash('sha256').update(image.buffer).digest('hex');

    // Dedupe: si el mismo user_id ya analizó esta imagen exacta CON LA VERSIÓN
    // ACTUAL del algoritmo, devuelve el previo. Si la versión cambió, se vuelve
    // a procesar para aprovechar mejoras del pipeline. (No deduplicamos cross-user
    // para preservar privacidad y trazabilidad.)
    const activeVersion = process.env.ACTIVE_ALGORITHM_VERSION ?? 'heuristic-v4';
    const dup = await this.pool().query(
      `SELECT id, captured_at FROM image_analyses
        WHERE user_id = $1 AND image_hash = $2 AND deleted_at IS NULL
          AND processing_status = 'completed'
          AND algorithm_version = $3
        ORDER BY captured_at DESC LIMIT 1`,
      [userId, sha256, activeVersion],
    );
    if (dup.rowCount && dup.rowCount > 0) {
      const existing = dup.rows[0]!;
      this.log.info({ userId, sha256, analysisId: existing.id, activeVersion }, 'analysis_deduped');
      return await this.getById(userId, existing.id, existing.captured_at);
    }

    // Metadata visual (sharp leyendo el buffer directamente).
    let width: number | null = null;
    let height: number | null = null;
    try {
      const meta = await sharp(image.buffer).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'sharp_metadata_failed');
    }

    // Sube imagen original.
    const ext = pickExtension(image.mimetype, image.filename);
    const imageKey = `analyses/${userId}/${sha256}${ext}`;
    await this.storage.put(
      this.storage.buckets.analyses,
      imageKey,
      image.buffer,
      image.size,
      {
        'Content-Type': image.mimetype,
        'X-Amz-Meta-Sha256': sha256,
        'X-Amz-Meta-Uploaded-By': userId,
      },
    );

    // Genera miniatura WebP 400px ancho (preservando ratio).
    let thumbKey: string | null = null;
    try {
      const thumbBuf = await sharp(image.buffer)
        .rotate()
        .resize({ width: 400, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      thumbKey = `thumbs/${userId}/${sha256}.webp`;
      await this.storage.put(
        this.storage.buckets.analyses,
        thumbKey,
        thumbBuf,
        thumbBuf.length,
        { 'Content-Type': 'image/webp', 'X-Amz-Meta-Sha256': sha256 },
      );
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'thumbnail_generation_failed');
      thumbKey = null;
    }

    // INSERT analysis + enqueue dentro de transacción.
    const capturedAt = new Date();
    const grainType = input.grainType ?? 'pergamino';
    const result = await this.db.tx(async (client) => {
      const r = await client.query(
        `INSERT INTO image_analyses (
            user_id, farm_id, captured_at, image_hash, image_storage_ref,
            thumbnail_storage_ref, image_width, image_height, file_size_bytes,
            capture_conditions, grain_type, sample_weight_g, processing_status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'queued')
         RETURNING id, captured_at`,
        [
          userId,
          input.farmId ?? null,
          capturedAt,
          sha256,
          imageKey,
          thumbKey,
          width,
          height,
          image.size,
          input.captureConditions ? JSON.stringify(input.captureConditions) : null,
          grainType,
          input.sampleWeightG ?? null,
        ],
      );
      const row = r.rows[0]!;
      // Encola job en analysis_queue con los datos canónicos.
      await client.query(
        `INSERT INTO analysis_queue (
            analysis_id, captured_at, user_id, farm_id, storage_ref, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          row.id,
          row.captured_at,
          userId,
          input.farmId ?? null,
          imageKey,
          JSON.stringify({
            grainType,
            sampleWeightG: input.sampleWeightG ?? null,
            sha256,
            width,
            height,
            mime: image.mimetype,
            sizeBytes: image.size,
          }),
        ],
      );
      return row;
    });
    void this.queue;  // tipado: encolamos por SQL directo dentro de la tx para atomicidad

    // Invalida caché de listados del usuario.
    await this.cache.invalidatePrefix(`analyses:list:${userId}:`).catch(() => { /* ignore */ });

    this.log.info({ userId, analysisId: result.id, sha256 }, 'analysis_submitted');
    return await this.getById(userId, result.id, result.captured_at);
  }

  // ───────────────────────── consultas ─────────────────────────

  async getById(userId: string, id: string, capturedAt?: Date | string): Promise<AnalysisSummary> {
    // Con hypertable, conviene incluir captured_at en el WHERE para chunk-pruning.
    const params: unknown[] = [id, userId];
    let extraWhere = '';
    if (capturedAt) {
      params.push(capturedAt);
      extraWhere = ` AND captured_at = $${params.length}`;
    }
    const r = await this.pool().query(
      `SELECT id, captured_at, user_id, farm_id, grain_type, image_hash,
              image_storage_ref, thumbnail_storage_ref, image_width, image_height,
              file_size_bytes, processing_status, total_grains_detected,
              quality_distribution, defect_distribution, overall_score,
              moisture_estimated, confidence_score, algorithm_version,
              error_message, created_at
         FROM image_analyses
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL${extraWhere}
        ORDER BY captured_at DESC
        LIMIT 1`,
      params,
    );
    if (r.rowCount === 0) throw errors.notFound('analysis_not_found');
    return rowToSummary(r.rows[0]!);
  }

  async getDetail(userId: string, id: string) {
    const head = await this.getById(userId, id);
    const grains = await this.pool().query(
      `SELECT grain_index, bbox_x, bbox_y, bbox_w, bbox_h,
              classification, defects, confidence, color_lab
         FROM grain_detections
        WHERE analysis_id = $1
        ORDER BY grain_index ASC`,
      [id],
    );
    // Presigned URL para mostrar la imagen original e imagen miniatura.
    const [imageUrl, thumbUrl] = await Promise.all([
      this.storage.presignedGet(this.storage.buckets.analyses, head.imageStorageRef, 3600)
        .catch(() => null),
      head.thumbnailStorageRef
        ? this.storage.presignedGet(this.storage.buckets.analyses, head.thumbnailStorageRef, 3600).catch(() => null)
        : Promise.resolve(null),
    ]);
    return { analysis: head, grains: grains.rows, imageUrl, thumbnailUrl: thumbUrl };
  }

  async list(userId: string, opts: { limit?: number; before?: string; farmId?: string | null }) {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const params: unknown[] = [userId];
    let whereExtra = '';
    if (opts.before) {
      params.push(opts.before);
      whereExtra += ` AND captured_at < $${params.length}`;
    }
    if (opts.farmId) {
      params.push(opts.farmId);
      whereExtra += ` AND farm_id = $${params.length}`;
    }
    params.push(limit);
    const r = await this.pool().query(
      `SELECT id, captured_at, user_id, farm_id, grain_type, image_hash,
              image_storage_ref, thumbnail_storage_ref, image_width, image_height,
              file_size_bytes, processing_status, total_grains_detected,
              quality_distribution, defect_distribution, overall_score,
              moisture_estimated, confidence_score, algorithm_version,
              error_message, created_at
         FROM image_analyses
        WHERE user_id = $1 AND deleted_at IS NULL${whereExtra}
        ORDER BY captured_at DESC
        LIMIT $${params.length}`,
      params,
    );
    const items = r.rows.map(rowToSummary);
    const nextBefore = items.length === limit ? items[items.length - 1]!.capturedAt : null;
    return { items, nextBefore };
  }

  /** Soft-delete: marca deleted_at. Hypertable no permite UPDATE de PK. */
  async softDelete(userId: string, id: string) {
    const r = await this.pool().query(
      `UPDATE image_analyses SET deleted_at = NOW()
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        RETURNING id`,
      [id, userId],
    );
    if (r.rowCount === 0) throw errors.notFound('analysis_not_found');
    await this.cache.invalidatePrefix(`analyses:list:${userId}:`).catch(() => { /* ignore */ });
    return { ok: true };
  }

  /** Re-encola un análisis que quedó en failed (solo el propietario). */
  async retry(userId: string, id: string) {
    return this.db.tx(async (client) => {
      const a = await client.query(
        `SELECT id, captured_at, farm_id, image_storage_ref, grain_type,
                sample_weight_g, image_width, image_height, image_hash,
                file_size_bytes
           FROM image_analyses
          WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
          FOR UPDATE`,
        [id, userId],
      );
      if (a.rowCount === 0) throw errors.notFound('analysis_not_found');
      const row = a.rows[0]!;
      await client.query(
        `UPDATE image_analyses
            SET processing_status = 'queued', error_message = NULL
          WHERE id = $1 AND captured_at = $2`,
        [row.id, row.captured_at],
      );
      await client.query(
        `INSERT INTO analysis_queue (
            analysis_id, captured_at, user_id, farm_id, storage_ref, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          row.id,
          row.captured_at,
          userId,
          row.farm_id,
          row.image_storage_ref,
          JSON.stringify({
            grainType: row.grain_type,
            sampleWeightG: row.sample_weight_g,
            sha256: row.image_hash,
            width: row.image_width,
            height: row.image_height,
            sizeBytes: row.file_size_bytes,
            retry: true,
          }),
        ],
      );
      return { ok: true };
    });
  }
}

// ─────────────── helpers ───────────────

interface RawAnalysisRow {
  id: string;
  captured_at: Date;
  user_id: string;
  farm_id: string | null;
  grain_type: string;
  image_hash: string;
  image_storage_ref: string;
  thumbnail_storage_ref: string | null;
  image_width: number | null;
  image_height: number | null;
  file_size_bytes: number | null;
  processing_status: 'queued' | 'processing' | 'completed' | 'failed';
  total_grains_detected: number | null;
  quality_distribution: Record<string, number> | null;
  defect_distribution: Record<string, number> | null;
  overall_score: string | number | null;
  moisture_estimated: string | number | null;
  confidence_score: string | number | null;
  algorithm_version: string | null;
  error_message: string | null;
  created_at: Date;
}

function rowToSummary(r: RawAnalysisRow): AnalysisSummary {
  const num = (v: string | number | null): number | null =>
    v === null ? null : typeof v === 'string' ? Number(v) : v;
  return {
    id: r.id,
    capturedAt: r.captured_at.toISOString(),
    userId: r.user_id,
    farmId: r.farm_id,
    grainType: r.grain_type,
    imageHash: r.image_hash,
    imageStorageRef: r.image_storage_ref,
    thumbnailStorageRef: r.thumbnail_storage_ref,
    imageWidth: r.image_width,
    imageHeight: r.image_height,
    fileSizeBytes: r.file_size_bytes,
    processingStatus: r.processing_status,
    totalGrainsDetected: r.total_grains_detected,
    qualityDistribution: r.quality_distribution,
    defectDistribution: r.defect_distribution,
    overallScore: num(r.overall_score),
    moistureEstimated: num(r.moisture_estimated),
    confidenceScore: num(r.confidence_score),
    algorithmVersion: r.algorithm_version,
    errorMessage: r.error_message,
    createdAt: r.created_at.toISOString(),
  };
}

function pickExtension(mime: string, filename: string): string {
  const fromName = filename.match(/(\.[a-z0-9]{1,8})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  return map[mime] ?? '.bin';
}
