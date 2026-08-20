/**
 * server.ts — AppServer interface + AppBroker (patrón FinalStore).
 *
 * Las features no acceden a Express directamente: reciben un `AppServer`
 * (interfaz pequeña) y exponen sus rutas vía `RegisterRoute`. Esto permite
 * testear features sin levantar HTTP.
 *
 *   AppServer (interface)
 *   ├── RegisterRoute(method, path, handler, opts)
 *   ├── RegisterPublicRoute(method, path, handler) — bypassa middleware auth
 *   ├── RegisterWorker(name, stopFn) — registra worker para graceful shutdown
 *   └── Hub() — accede al WebSocketHub para publicar eventos
 *
 *   AppBroker (impl)
 *   - se instancia en main.ts
 *   - composes app.ts (Express), database.ts, cache.ts, storage.ts, queue.ts, websocket.ts
 *   - expone hooks: `wire(broker)` se llama por cada feature module
 */
import type { Router, RequestHandler } from 'express';
import type { Database } from './database.js';
import type { Cache } from './cache.js';
import type { Storage } from './storage.js';
import type { JobQueue } from './queue.js';
import type { WebSocketHub } from './websocket.js';
import type { Logger } from './logger.js';
import type { AppConfig } from './config.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface RouteOptions {
  /** Si true, requiere JWT válido (default). Si false, ruta pública. */
  auth?: boolean;
  /** Roles permitidos (si auth=true). Vacío = cualquier rol autenticado. */
  roles?: Array<'admin' | 'producer' | 'buyer'>;
  /** Rate limit override por endpoint (req/min). */
  rateLimit?: number;
  /** Tag para métricas. */
  tag?: string;
}

export interface FeatureContext {
  /** Sub-router donde la feature registra sus endpoints. */
  router: Router;
  /** Función helper para envolver opts en middleware. */
  guard: (opts: RouteOptions) => RequestHandler[];
  config: AppConfig;
  db: Database;
  cache: Cache;
  storage: Storage;
  queue: JobQueue;
  hub: WebSocketHub;
  log: Logger;
  /** Registro de servicios cross-feature (populado por wires anteriores). */
  services: Record<string, unknown>;
}

/** Cada feature module exporta una función con esta firma. */
export type FeatureWire = (ctx: FeatureContext) => Promise<FeatureHandles> | FeatureHandles;

export interface FeatureHandles {
  /** Path montaje del router (ej: '/auth', '/farmer'). */
  mountPath: string;
  /** Función para detener workers/timers al shutdown. */
  stop?: () => Promise<void>;
  /** Servicios exportados al registry para que otras features los usen. */
  exports?: Record<string, unknown>;
}

/**
 * AppBroker compone los servicios singleton y coordina shutdown.
 */
export class AppBroker {
  private features: FeatureHandles[] = [];

  constructor(
    public readonly config: AppConfig,
    public readonly log: Logger,
    public readonly db: Database,
    public readonly cache: Cache,
    public readonly storage: Storage,
    public readonly queue: JobQueue,
    public readonly hub: WebSocketHub,
  ) {}

  registerFeature(h: FeatureHandles): void {
    this.features.push(h);
  }

  /** Detiene workers y cierra recursos en orden inverso. */
  async shutdown(): Promise<void> {
    this.log.info('shutdown: stopping features');
    for (const f of [...this.features].reverse()) {
      if (f.stop) await f.stop().catch((e) => this.log.warn({ err: (e as Error).message }, 'feature_stop_error'));
    }
    this.log.info('shutdown: closing websocket');
    await this.hub.close().catch(() => { /* ignore */ });
    this.log.info('shutdown: closing cache');
    await this.cache.close().catch(() => { /* ignore */ });
    this.log.info('shutdown: closing database');
    await this.db.close().catch(() => { /* ignore */ });
  }
}
