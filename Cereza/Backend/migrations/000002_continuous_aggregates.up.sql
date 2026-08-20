-- =============================================================================
-- Migration 000002: Continuous aggregates para métricas temporales
-- =============================================================================

-- Vista diaria por finca: promedio, min, max, conteos
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_quality_stats
WITH (timescaledb.continuous) AS
SELECT
    farm_id,
    user_id,
    time_bucket(INTERVAL '1 day', captured_at) AS bucket,
    COUNT(*)                          AS total_analyses,
    AVG(overall_score)                AS avg_score,
    MIN(overall_score)                AS min_score,
    MAX(overall_score)                AS max_score,
    STDDEV_POP(overall_score)         AS stddev_score,
    AVG(confidence_score)             AS avg_confidence,
    SUM(total_grains_detected)        AS total_grains
FROM image_analyses
WHERE processing_status = 'completed'
  AND deleted_at IS NULL
GROUP BY farm_id, user_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('daily_quality_stats',
    start_offset => INTERVAL '30 days',
    end_offset   => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE);

-- Vista semanal (agregando desde la diaria)
CREATE MATERIALIZED VIEW IF NOT EXISTS weekly_quality_stats
WITH (timescaledb.continuous) AS
SELECT
    farm_id,
    user_id,
    time_bucket(INTERVAL '7 days', bucket) AS bucket,
    SUM(total_analyses)            AS total_analyses,
    AVG(avg_score)                 AS avg_score,
    MIN(min_score)                 AS min_score,
    MAX(max_score)                 AS max_score,
    SUM(total_grains)              AS total_grains
FROM daily_quality_stats
GROUP BY farm_id, user_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('weekly_quality_stats',
    start_offset => INTERVAL '90 days',
    end_offset   => INTERVAL '1 day',
    schedule_interval => INTERVAL '6 hours',
    if_not_exists => TRUE);

-- Vista mensual
CREATE MATERIALIZED VIEW IF NOT EXISTS monthly_quality_stats
WITH (timescaledb.continuous) AS
SELECT
    farm_id,
    user_id,
    time_bucket(INTERVAL '30 days', bucket) AS bucket,
    SUM(total_analyses)            AS total_analyses,
    AVG(avg_score)                 AS avg_score,
    MIN(min_score)                 AS min_score,
    MAX(max_score)                 AS max_score,
    SUM(total_grains)              AS total_grains
FROM daily_quality_stats
GROUP BY farm_id, user_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('monthly_quality_stats',
    start_offset => INTERVAL '365 days',
    end_offset   => INTERVAL '7 days',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE);
