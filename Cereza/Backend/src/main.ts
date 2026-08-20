/**
 * main.ts — Composition root del backend CaféVision.
 *
 * Responsabilidades:
 *  1. Carga configuración (fail-fast)
 *  2. Inicializa singletons (db, cache, storage, queue, hub)
 *  3. Aplica migraciones (a menos que SKIP_MIGRATIONS=1)
 *  4. Wire features en orden de dependencia
 *  5. Levanta HTTP server + WebSocket
 *  6. Graceful shutdown (SIGTERM/SIGINT)
 */
import http from 'node:http';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { loadConfig } from './core/config.js';
import { createLogger } from './core/logger.js';
import { Database } from './core/database.js';
import { migrateUp } from './core/migrations.js';
import { Cache } from './core/cache.js';
import { Storage } from './core/storage.js';
import { JobQueue } from './core/queue.js';
import { WebSocketHub, type TokenVerifier } from './core/websocket.js';
import { AppBroker, type FeatureWire } from './core/server.js';
import { buildApp } from './core/app.js';
import { LogSender, ResendSender, type Sender } from './features/notify/sender.js';
import { makeNotifyFeature } from './features/notify/index.js';
import { makeAuthFeature } from './features/auth/index.js';
import { makeFarmerFeature } from './features/farmer/index.js';
import { makeAnalysisFeature } from './features/analysis/index.js';
import { makeMetricsFeature } from './features/metrics/index.js';
import { makeContentFeature } from './features/content/index.js';
import { makeMarketFeature } from './features/market/index.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger(cfg.logLevel, cfg.nodeEnv);

  log.info({ env: cfg.nodeEnv, port: cfg.port }, 'cafevision_backend_starting');

  // ---- Singletons de infraestructura ----
  const db = new Database(cfg.databaseUrl, log);
  const cache = new Cache(cfg.redisUrl, log);
  const storage = new Storage(
    {
      endpoint: cfg.minio.endpoint,
      port: cfg.minio.port,
      useSSL: cfg.minio.useSSL,
      accessKey: cfg.minio.accessKey,
      secretKey: cfg.minio.secretKey,
    },
    cfg.minio.buckets,
    log,
  );
  const queue = new JobQueue(db, log);

  // ---- WebSocket hub: verifica tokens contra el mismo issuer y RS256 ----
  const verifyToken: TokenVerifier = async (token) => {
    try {
      const claims = jwt.verify(token, cfg.jwt.publicKey, {
        algorithms: ['RS256'],
        issuer: cfg.jwt.issuer,
      }) as { sub: string; role: string };
      return { userId: claims.sub, role: claims.role };
    } catch {
      return null;
    }
  };
  const hub = new WebSocketHub(log, verifyToken);

  // ---- Validar dependencias críticas antes de migrar ----
  const dbHealth = await db.health();
  if (!dbHealth.ok) {
    log.fatal({ err: dbHealth.error }, 'cannot_connect_to_database');
    process.exit(1);
  }

  // ---- Migraciones (idempotente) ----
  if (!cfg.skipMigrations) {
    const migDir = path.resolve(process.cwd(), 'migrations');
    await migrateUp(db, migDir, log);
  } else {
    log.warn('SKIP_MIGRATIONS=1, migrations not applied');
  }

  // ---- Refresh inicial de materialized views (mantiene métricas al día sin TimescaleDB) ----
  for (const view of ['daily_quality_stats', 'weekly_quality_stats', 'monthly_quality_stats']) {
    try {
      await db.pool_().query(`REFRESH MATERIALIZED VIEW ${view}`);
    } catch (e) {
      log.warn({ view, err: (e as Error).message }, 'mv_refresh_failed');
    }
  }

  // ---- Asegurar buckets de MinIO ----
  await storage.ensureBuckets().catch((e) => {
    log.warn({ err: (e as Error).message }, 'minio_ensure_buckets_failed');
  });

  // ---- Sender pluggable: ResendSender si hay API key, LogSender si no ----
  const sender: Sender = cfg.email.resendApiKey
    ? new ResendSender(cfg.email.resendApiKey, cfg.email.from, log)
    : new LogSender(log);
  log.info({ sender: sender.name() }, 'sender_selected');

  // ---- Wiring del broker ----
  const broker = new AppBroker(cfg, log, db, cache, storage, queue, hub);

  // ---- Features en orden de dependencias ----
  // notify se monta primero porque otras features (auth, analysis) lo usan vía services registry.
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${cfg.port}`;
  const features: FeatureWire[] = [
    makeNotifyFeature(sender),
    makeAuthFeature({ baseUrl: publicBaseUrl }),
    makeFarmerFeature(),
    makeAnalysisFeature({ publicBaseUrl }),
    makeMetricsFeature(),
    makeContentFeature(),
    makeMarketFeature(),
    // ...
  ];

  const app = await buildApp({ broker, features });

  // ---- HTTP + WebSocket ----
  const server = http.createServer(app);
  hub.attach(server, '/ws');

  await new Promise<void>((resolve) => {
    server.listen(cfg.port, '0.0.0.0', () => {
      log.info({ port: cfg.port }, 'http_server_listening');
      resolve();
    });
  });

  // ---- Graceful shutdown ----
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutdown_initiated');
    const t0 = Date.now();
    server.close((err) => {
      if (err) log.warn({ err: err.message }, 'server_close_error');
    });
    try {
      await broker.shutdown();
    } catch (e) {
      log.error({ err: (e as Error).message }, 'shutdown_error');
    }
    log.info({ duration_ms: Date.now() - t0 }, 'shutdown_complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    log.fatal({ err: err.message, stack: err.stack }, 'uncaught_exception');
    void shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    log.error({ reason: String(reason) }, 'unhandled_rejection');
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
