/**
 * app.ts — Construcción de la app Express y registro de features.
 *
 * Política: este archivo NO conoce las features individuales. Recibe la lista
 * de wires desde main.ts (composition root).
 */
import express, { Router, type Application, type RequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import type { AppBroker } from './server.js';
import type { FeatureContext, FeatureWire, RouteOptions } from './server.js';
import { authMiddleware, requireRole } from './middleware/auth.js';
import { rateLimit } from './middleware/ratelimit.js';
import { accessLog, metricsHandler, requestId } from './middleware/observability.js';
import { errorHandler } from './middleware/errorHandler.js';

export interface BuildAppDeps {
  broker: AppBroker;
  features: FeatureWire[];
}

export async function buildApp({ broker, features }: BuildAppDeps): Promise<Application> {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('trust proxy', 1);

  // ----- middlewares globales -----
  app.use(helmet({
    contentSecurityPolicy: false, // gestionado por nginx en producción
  }));
  app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(requestId());
  app.use(accessLog(broker.log));

  // ----- rate limit global suave -----
  const globalLimiter = rateLimit({ capacity: 120, refillPerSec: 2 });

  // ----- endpoints técnicos -----
  app.get('/health', async (_req, res) => {
    const [db, cache, storage] = await Promise.all([
      broker.db.health(),
      broker.cache.health(),
      broker.storage.health(),
    ]);
    const ok = db.ok && cache.ok && storage.ok;
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      checks: { db, cache, storage },
      uptime_s: Math.round(process.uptime()),
    });
  });

  app.get('/metrics', metricsHandler());

  // ----- helper para features: convierte RouteOptions en cadena de middlewares -----
  const guard = (opts: RouteOptions): RequestHandler[] => {
    const stack: RequestHandler[] = [];
    if (opts.rateLimit) {
      stack.push(rateLimit({ capacity: opts.rateLimit, refillPerSec: opts.rateLimit / 60 }));
    } else {
      stack.push(globalLimiter);
    }
    if (opts.auth !== false) {
      stack.push(authMiddleware({
        publicKey: broker.config.jwt.publicKey,
        issuer: broker.config.jwt.issuer,
      }));
      if (opts.roles && opts.roles.length) stack.push(requireRole(...opts.roles));
    }
    return stack;
  };

  // ----- monta features -----
  const services: Record<string, unknown> = {};
  for (const wire of features) {
    const featureRouter = Router();
    const ctx: FeatureContext = {
      router: featureRouter,
      guard,
      config: broker.config,
      db: broker.db,
      cache: broker.cache,
      storage: broker.storage,
      queue: broker.queue,
      hub: broker.hub,
      log: broker.log.child({}),
      services,
    };
    const handles = await wire(ctx);
    app.use(`/api/v1${handles.mountPath}`, featureRouter);
    broker.registerFeature(handles);
    if (handles.exports) Object.assign(services, handles.exports);
    broker.log.info({ mount: handles.mountPath, exports: handles.exports ? Object.keys(handles.exports) : [] }, 'feature_mounted');
  }

  // 404
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'route_not_found' } });
  });

  // error handler (ÚLTIMO)
  app.use(errorHandler(broker.log));

  return app;
}
