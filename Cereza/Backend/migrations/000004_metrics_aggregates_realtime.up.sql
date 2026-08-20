-- 000004_metrics_aggregates_realtime.up.sql
-- Las vistas materializadas se crearon WITH NO DATA y no estaban siendo
-- pobladas (la extensión TimescaleDB no está instalada en este entorno, así
-- que las "continuous aggregates" son en realidad materialized views normales
-- de Postgres). Las refrescamos aquí; las próximas refrescadas las hará la app
-- al arrancar (ver main.ts).

REFRESH MATERIALIZED VIEW daily_quality_stats;
REFRESH MATERIALIZED VIEW weekly_quality_stats;
REFRESH MATERIALIZED VIEW monthly_quality_stats;
