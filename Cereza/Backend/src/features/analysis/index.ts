/**
 * features/analysis/index.ts — HTTP wire del feature análisis.
 *
 * Rutas bajo /api/v1/analysis (auth required):
 *   POST   /          (multipart: image) — submit nuevo análisis
 *   GET    /          — listado paginado del usuario
 *   GET    /:id       — detalle (con grain_detections + presigned URLs)
 *   POST   /:id/retry — re-encolar un análisis fallido
 *   DELETE /:id       — soft-delete
 *
 * Lanza un worker que consume `analysis_queue` y llama al servicio Python.
 */
import { z } from 'zod';
import type { FeatureContext, FeatureHandles, FeatureWire } from '../../core/server.js';
import { AnalysisService } from './service.js';
import { startAnalysisWorker } from './worker.js';
import { uploadSingle } from '../../core/middleware/upload.js';
import { errors } from '../../core/errors.js';
import type { NotifyService } from '../notify/index.js';

const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;  // 15 MB

const uuidParam = z.string().uuid();

const submitBodySchema = z.object({
  farmId: z.string().uuid().nullable().optional(),
  grainType: z.enum(['cereza', 'pergamino', 'trilla']).optional(),
  sampleWeightG: z.coerce.number().min(0).max(100000).nullable().optional(),
  captureConditions: z.string().optional(),  // JSON string from multipart
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.string().datetime().optional(),
  farmId: z.string().uuid().nullable().optional(),
});

export interface AnalysisFeatureDeps {
  publicBaseUrl: string;
}

export function makeAnalysisFeature(deps: AnalysisFeatureDeps): FeatureWire {
  return (ctx: FeatureContext): FeatureHandles => {
    const { router, guard, db, storage, cache, queue, hub, log, config, services } = ctx;
    const notify = services.notify as NotifyService | undefined;
    if (!notify) throw new Error('analysis feature requires notify service — wire notify first');

    const svc = new AnalysisService(db, storage, cache, queue, log);

    const requireAuth = { auth: true as const };
    const requireProducer = { auth: true as const, roles: ['producer' as const] };

    // ────── submit ──────
    router.post(
      '/',
      ...guard(requireProducer),
      ...uploadSingle({ field: 'image', maxBytes: MAX_IMAGE_BYTES, allowedMime: ALLOWED_IMAGE_MIME }),
      async (req, res, next) => {
        try {
          if (!req.auth) return next(errors.unauthorized());
          if (!req.file) return next(errors.badRequest('image_required'));
          const body = submitBodySchema.parse(req.body);
          let captureConditions: SubmitCC = null;
          if (body.captureConditions) {
            try {
              captureConditions = JSON.parse(body.captureConditions) as SubmitCC;
            } catch {
              return next(errors.badRequest('capture_conditions_invalid_json'));
            }
          }
          const summary = await svc.submit(req.auth.sub, {
            image: {
              buffer: req.file.buffer,
              filename: req.file.originalname,
              mimetype: req.file.mimetype,
              size: req.file.size,
            },
            farmId: body.farmId ?? null,
            ...(body.grainType !== undefined ? { grainType: body.grainType } : {}),
            sampleWeightG: body.sampleWeightG ?? null,
            captureConditions,
          });
          res.status(202).json({ analysis: summary });
        } catch (e) { next(e); }
      },
    );

    // ────── listar ──────
    router.get('/', ...guard(requireAuth), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const q = listQuerySchema.parse(req.query);
        const result = await svc.list(req.auth.sub, {
          ...(q.limit !== undefined ? { limit: q.limit } : {}),
          ...(q.before !== undefined ? { before: q.before } : {}),
          farmId: q.farmId ?? null,
        });
        res.json(result);
      } catch (e) { next(e); }
    });

    // ────── detalle ──────
    router.get('/:id', ...guard(requireAuth), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const id = uuidParam.parse(req.params.id);
        const detail = await svc.getDetail(req.auth.sub, id);
        res.json(detail);
      } catch (e) { next(e); }
    });

    // ────── retry ──────
    router.post('/:id/retry', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const id = uuidParam.parse(req.params.id);
        const r = await svc.retry(req.auth.sub, id);
        res.json(r);
      } catch (e) { next(e); }
    });

    // ────── soft-delete ──────
    router.delete('/:id', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const id = uuidParam.parse(req.params.id);
        const r = await svc.softDelete(req.auth.sub, id);
        res.json(r);
      } catch (e) { next(e); }
    });

    // ────── arranca el worker ──────
    const stopWorker = startAnalysisWorker({
      db, storage, queue, hub, log, notify,
      pythonAnalysisUrl: config.pythonAnalysisUrl,
      publicBaseUrl: deps.publicBaseUrl,
      concurrency: 2,
    });

    return {
      mountPath: '/analysis',
      stop: async () => { await stopWorker(); },
      exports: { analysis: svc },
    };
  };
}

type SubmitCC = {
  luz?: string;
  distanciaCm?: number;
  angulo?: string;
  temperatura?: number;
  humedad?: number;
} | null;

export type AnalysisFeatureService = AnalysisService;
