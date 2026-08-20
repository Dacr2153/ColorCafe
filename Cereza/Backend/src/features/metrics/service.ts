/**
 * features/metrics/service.ts — Métricas y dashboards (lectura de cont-aggregates).
 *
 * Lee de daily/weekly/monthly_quality_stats (TimescaleDB continuous aggregates).
 * Cachea respuestas 5 minutos en L1+L2.
 *
 * Política: NUNCA inventamos series. Si no hay datos en el rango, devolvemos
 * arrays vacíos. El frontend muestra "sin datos suficientes" en ese caso.
 */
import type { Pool } from 'pg';
import type { Database } from '../../core/database.js';
import type { Cache } from '../../core/cache.js';
import type { Logger } from '../../core/logger.js';

export type Granularity = 'day' | 'week' | 'month';

export interface TimeSeriesPoint {
  bucket: string;          // ISO
  totalAnalyses: number;
  avgScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  stddevScore?: number | null;
  avgConfidence?: number | null;
  totalGrains: number | null;
}

export interface QualityDistributionRow {
  category: string;
  count: number;
  percentage: number;
}

const VIEW_BY_GRAN: Record<Granularity, string> = {
  day: 'daily_quality_stats',
  week: 'weekly_quality_stats',
  month: 'monthly_quality_stats',
};

const TTL_MS = 5 * 60_000;

export class MetricsService {
  constructor(private db: Database, private cache: Cache, private log: Logger) {}

  private pool(): Pool { return this.db.pool_(); }

  async timeSeries(
    userId: string,
    granularity: Granularity,
    farmId: string | null,
    rangeFrom: string,
    rangeTo: string,
  ): Promise<TimeSeriesPoint[]> {
    const cacheKey = `metrics:ts:${userId}:${granularity}:${farmId ?? '-'}:${rangeFrom}:${rangeTo}`;
    const cached = await this.cache.get<TimeSeriesPoint[]>(cacheKey);
    if (cached) return cached;

    const view = VIEW_BY_GRAN[granularity];
    const params: unknown[] = [userId, rangeFrom, rangeTo];
    let farmClause = '';
    if (farmId) {
      params.push(farmId);
      farmClause = ` AND farm_id = $${params.length}`;
    }
    // La vista diaria tiene stddev/avg_confidence; las superiores no.
    const extraCols = granularity === 'day'
      ? 'stddev_score, avg_confidence,'
      : 'NULL::numeric AS stddev_score, NULL::numeric AS avg_confidence,';
    const sql = `
      SELECT bucket, total_analyses, avg_score, min_score, max_score,
             ${extraCols} total_grains
        FROM ${view}
       WHERE user_id = $1 AND bucket >= $2 AND bucket < $3${farmClause}
       ORDER BY bucket ASC
    `;
    const r = await this.pool().query(sql, params);
    const points: TimeSeriesPoint[] = r.rows.map((row) => ({
      bucket: (row.bucket as Date).toISOString(),
      totalAnalyses: Number(row.total_analyses),
      avgScore: numOrNull(row.avg_score),
      minScore: numOrNull(row.min_score),
      maxScore: numOrNull(row.max_score),
      stddevScore: numOrNull(row.stddev_score),
      avgConfidence: numOrNull(row.avg_confidence),
      totalGrains: row.total_grains === null ? null : Number(row.total_grains),
    }));
    await this.cache.set(cacheKey, points, { ttlMs: TTL_MS });
    return points;
  }

  /**
   * Distribución actual de calidad agregada en un rango — leída del raw
   * image_analyses para mayor frescura (los continuous aggregates son
   * eventually-consistent).
   */
  async qualityDistribution(
    userId: string,
    farmId: string | null,
    rangeFrom: string,
    rangeTo: string,
  ): Promise<QualityDistributionRow[]> {
    const cacheKey = `metrics:quality:${userId}:${farmId ?? '-'}:${rangeFrom}:${rangeTo}`;
    const cached = await this.cache.get<QualityDistributionRow[]>(cacheKey);
    if (cached) return cached;

    const params: unknown[] = [userId, rangeFrom, rangeTo];
    let farmClause = '';
    if (farmId) {
      params.push(farmId);
      farmClause = ` AND farm_id = $${params.length}`;
    }
    // jsonb_each_text por cada análisis completado, sumamos counts y agrupamos.
    const r = await this.pool().query(
      `SELECT key AS category, SUM(value::int) AS count
         FROM image_analyses,
              LATERAL jsonb_each_text(quality_distribution)
        WHERE user_id = $1 AND captured_at >= $2 AND captured_at < $3
          AND processing_status = 'completed' AND deleted_at IS NULL
          AND quality_distribution IS NOT NULL${farmClause}
        GROUP BY key
        ORDER BY count DESC`,
      params,
    );
    const total = r.rows.reduce((s: number, row) => s + Number(row.count), 0);
    const rows: QualityDistributionRow[] = r.rows.map((row) => ({
      category: row.category,
      count: Number(row.count),
      percentage: total > 0 ? Number(((Number(row.count) / total) * 100).toFixed(2)) : 0,
    }));
    await this.cache.set(cacheKey, rows, { ttlMs: TTL_MS });
    return rows;
  }

  /** Resumen general del productor: análisis totales, score promedio, última actividad. */
  async summary(userId: string, farmId: string | null) {
    const cacheKey = `metrics:summary:${userId}:${farmId ?? '-'}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const params: unknown[] = [userId];
    let farmClause = '';
    if (farmId) {
      params.push(farmId);
      farmClause = ` AND farm_id = $${params.length}`;
    }
    const r = await this.pool().query(
      `SELECT COUNT(*) FILTER (WHERE processing_status = 'completed') AS completed,
              COUNT(*) FILTER (WHERE processing_status = 'queued')     AS pending,
              COUNT(*) FILTER (WHERE processing_status = 'processing') AS processing,
              COUNT(*) FILTER (WHERE processing_status = 'failed')     AS failed,
              AVG(overall_score) FILTER (WHERE processing_status = 'completed') AS avg_score,
              MAX(captured_at)                                          AS last_capture
         FROM image_analyses
        WHERE user_id = $1 AND deleted_at IS NULL${farmClause}`,
      params,
    );
    const row = r.rows[0]!;
    const out = {
      completed: Number(row.completed),
      pending: Number(row.pending),
      processing: Number(row.processing),
      failed: Number(row.failed),
      avgScore: numOrNull(row.avg_score),
      lastCaptureAt: row.last_capture ? (row.last_capture as Date).toISOString() : null,
    };
    await this.cache.set(cacheKey, out, { ttlMs: TTL_MS });
    return out;
  }

  /** Indica si hay datos suficientes para mostrar series; sin esto, frontend evita gráficos. */
  async dataAvailability(userId: string): Promise<{ hasData: boolean; firstCaptureAt: string | null; lastCaptureAt: string | null }> {
    const r = await this.pool().query(
      `SELECT MIN(captured_at) AS first, MAX(captured_at) AS last
         FROM image_analyses
        WHERE user_id = $1 AND processing_status = 'completed' AND deleted_at IS NULL`,
      [userId],
    );
    const row = r.rows[0]!;
    return {
      hasData: row.first !== null,
      firstCaptureAt: row.first ? (row.first as Date).toISOString() : null,
      lastCaptureAt: row.last ? (row.last as Date).toISOString() : null,
    };
  }
}

function numOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
