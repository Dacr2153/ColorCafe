/**
 * features/metrics/index.ts — HTTP wire de métricas.
 *
 * Rutas bajo /api/v1/metrics (auth required):
 *   GET /summary?farmId=...
 *   GET /timeseries?granularity=day|week|month&from=...&to=...&farmId=...
 *   GET /quality-distribution?from=...&to=...&farmId=...
 *   GET /availability
 */
import { z } from 'zod';
import type { FeatureContext, FeatureHandles, FeatureWire } from '../../core/server.js';
import { MetricsService } from './service.js';
import { errors } from '../../core/errors.js';

const isoDate = z.string().datetime();

const tsQuery = z.object({
  granularity: z.enum(['day', 'week', 'month']),
  from: isoDate,
  to: isoDate,
  farmId: z.string().uuid().optional(),
});

const rangeQuery = z.object({
  from: isoDate,
  to: isoDate,
  farmId: z.string().uuid().optional(),
});

export function makeMetricsFeature(): FeatureWire {
  return (ctx: FeatureContext): FeatureHandles => {
    const { router, guard, db, cache, log } = ctx;
    const svc = new MetricsService(db, cache, log);
    const requireAuth = { auth: true as const };

    router.get('/summary', ...guard(requireAuth), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const farmId = typeof req.query.farmId === 'string' ? req.query.farmId : null;
        if (farmId) z.string().uuid().parse(farmId);
        const summary = await svc.summary(req.auth.sub, farmId);
        res.json({ summary });
      } catch (e) { next(e); }
    });

    router.get('/timeseries', ...guard(requireAuth), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const q = tsQuery.parse(req.query);
        if (q.from >= q.to) return next(errors.badRequest('range_invalid'));
        const points = await svc.timeSeries(req.auth.sub, q.granularity, q.farmId ?? null, q.from, q.to);
        res.json({ granularity: q.granularity, points });
      } catch (e) { next(e); }
    });

    router.get('/quality-distribution', ...guard(requireAuth), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const q = rangeQuery.parse(req.query);
        if (q.from >= q.to) return next(errors.badRequest('range_invalid'));
        const distribution = await svc.qualityDistribution(req.auth.sub, q.farmId ?? null, q.from, q.to);
        res.json({ distribution });
      } catch (e) { next(e); }
    });

    router.get('/availability', ...guard(requireAuth), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const r = await svc.dataAvailability(req.auth.sub);
        res.json(r);
      } catch (e) { next(e); }
    });

    return { mountPath: '/metrics', exports: { metrics: svc } };
  };
}

export type MetricsFeatureService = MetricsService;
