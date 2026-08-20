/**
 * features/market/index.ts — HTTP wire de marketplace.
 *
 * Rutas bajo /api/v1/market:
 *   POST   /listings                       (producer)
 *   GET    /listings/mine                  (producer)
 *   GET    /listings/:id                   (auth)
 *   PATCH  /listings/:id                   (producer, owner)
 *   DELETE /listings/:id                   (producer, owner)
 *   POST   /listings/:id/pause             (producer, owner) body:{pause:bool}
 *   POST   /listings/:id/review            (admin) body:{decision, reason?}
 *
 *   GET    /search                         (público — listings activos)
 *
 *   POST   /orders                         (buyer)  body:{listingId, cantidadKg, notas?}
 *   GET    /orders/mine?role=buyer|producer (auth)
 *   GET    /orders/:id                     (auth, party)
 *   POST   /orders/:id/transition          (auth, party) body:{status}
 *   GET    /orders/:id/messages            (auth, party)
 *   POST   /orders/:id/messages            (auth, party) body:{mensaje}
 *
 * Registra autorizador WebSocket para `order:{id}`.
 */
import { z } from 'zod';
import type { FeatureContext, FeatureHandles, FeatureWire } from '../../core/server.js';
import { MarketService } from './service.js';
import { errors } from '../../core/errors.js';

const uuidParam = z.string().uuid();

const listingCreateSchema = z.object({
  titulo: z.string().min(5).max(200),
  descripcion: z.string().max(5000).nullable().optional(),
  variedad: z.string().min(2).max(60),
  proceso: z.enum(['lavado', 'natural', 'honey', 'anaerobic']),
  puntuacionTaza: z.number().min(0).max(100).nullable().optional(),
  cantidadKg: z.number().positive().max(1_000_000),
  precioKgCop: z.number().positive().max(10_000_000),
  analysisId: z.string().uuid().nullable().optional(),
  analysisCapturedAt: z.string().datetime().nullable().optional(),
  farmId: z.string().uuid().nullable().optional(),
  fechaCosecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  disponibleDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  disponibleHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  fotos: z.array(z.string().url()).max(10).nullable().optional(),
});
const listingPatchSchema = listingCreateSchema.partial();

const searchSchema = z.object({
  q: z.string().min(2).max(120).optional(),
  proceso: z.enum(['lavado', 'natural', 'honey', 'anaerobic']).optional(),
  variedad: z.string().min(2).max(60).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  maxPrice: z.coerce.number().min(0).max(10_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
});

const reviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(1000).optional(),
});

const orderCreateSchema = z.object({
  listingId: z.string().uuid(),
  cantidadKg: z.number().positive().max(1_000_000),
  notas: z.string().max(2000).optional(),
});

const transitionSchema = z.object({
  status: z.enum(['accepted', 'rejected', 'in_transit', 'delivered', 'cancelled']),
});

const messageSchema = z.object({
  mensaje: z.string().min(1).max(4000),
});

export function makeMarketFeature(): FeatureWire {
  return (ctx: FeatureContext): FeatureHandles => {
    const { router, guard, db, cache, hub, log } = ctx;
    const svc = new MarketService(db, cache, hub, log);

    const producerOnly = { auth: true as const, roles: ['producer' as const] };
    const buyerOnly    = { auth: true as const, roles: ['buyer' as const] };
    const adminOnly    = { auth: true as const, roles: ['admin' as const] };
    const anyAuth      = { auth: true as const };
    const publicRoute  = { auth: false as const };

    // ────── listings ──────
    router.post('/listings', ...guard(producerOnly), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const input = listingCreateSchema.parse(req.body);
        const listing = await svc.createListing(req.auth.sub, input);
        res.status(201).json({ listing });
      } catch (e) { next(e); }
    });

    router.get('/listings/mine', ...guard(producerOnly), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const items = await svc.listMyListings(req.auth.sub);
        res.json({ items });
      } catch (e) { next(e); }
    });

    router.get('/listings/:id', ...guard(anyAuth), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const id = uuidParam.parse(req.params.id);
        const listing = await svc.getListing(id, req.auth.sub);
        res.json({ listing });
      } catch (e) { next(e); }
    });

    router.patch('/listings/:id', ...guard(producerOnly), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const id = uuidParam.parse(req.params.id);
        const patch = listingPatchSchema.parse(req.body);
        const listing = await svc.updateListing(req.auth.sub, id, patch);
        res.json({ listing });
      } catch (e) { next(e); }
    });

    router.delete('/listings/:id', ...guard(producerOnly), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const id = uuidParam.parse(req.params.id);
        const r = await svc.deleteListing(req.auth.sub, id);
        res.json(r);
      } catch (e) { next(e); }
    });

    router.post('/listings/:id/pause', ...guard(producerOnly), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const id = uuidParam.parse(req.params.id);
        const { pause } = z.object({ pause: z.boolean() }).parse(req.body);
        const r = await svc.pauseListing(req.auth.sub, id, pause);
        res.json(r);
      } catch (e) { next(e); }
    });

    router.post('/listings/:id/review', ...guard(adminOnly), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const id = uuidParam.parse(req.params.id);
        const body = reviewSchema.parse(req.body);
        const r = await svc.reviewListing(req.auth.sub, id, body.decision, body.reason);
        res.json(r);
      } catch (e) { next(e); }
    });

    // ────── search ──────
    router.get('/search', ...guard(publicRoute), async (req, res, next) => {
      try {
        const q = searchSchema.parse(req.query);
        const result = await svc.search(q);
        res.json(result);
      } catch (e) { next(e); }
    });

    // ────── orders ──────
    router.post('/orders', ...guard(buyerOnly), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const body = orderCreateSchema.parse(req.body);
        const order = await svc.createOrder(req.auth.sub, body.listingId, body.cantidadKg, body.notas);
        res.status(201).json({ order });
      } catch (e) { next(e); }
    });

    router.get('/orders/mine', ...guard(anyAuth), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const role = z.enum(['buyer', 'producer']).parse(req.query.role ?? 'buyer');
        const items = await svc.listOrdersForUser(req.auth.sub, role);
        res.json({ items });
      } catch (e) { next(e); }
    });

    router.get('/orders/:id', ...guard(anyAuth), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const id = uuidParam.parse(req.params.id);
        const order = await svc.getOrder(req.auth.sub, id);
        res.json({ order });
      } catch (e) { next(e); }
    });

    router.post('/orders/:id/transition', ...guard(anyAuth), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const id = uuidParam.parse(req.params.id);
        const body = transitionSchema.parse(req.body);
        const r = await svc.transitionOrder(req.auth.sub, id, body.status);
        res.json(r);
      } catch (e) { next(e); }
    });

    router.get('/orders/:id/messages', ...guard(anyAuth), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const id = uuidParam.parse(req.params.id);
        const q = z.object({
          limit: z.coerce.number().int().min(1).max(200).optional(),
          before: z.string().datetime().optional(),
        }).parse(req.query);
        const messages = await svc.listMessages(req.auth.sub, id, q);
        res.json({ messages });
      } catch (e) { next(e); }
    });

    router.post('/orders/:id/messages', ...guard({ ...anyAuth, rateLimit: 60 }), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const id = uuidParam.parse(req.params.id);
        const body = messageSchema.parse(req.body);
        const r = await svc.postMessage(req.auth.sub, id, body.mensaje);
        res.status(201).json({ message: r });
      } catch (e) { next(e); }
    });

    // ────── WebSocket: autoriza order:{id} dinámicamente ──────
    hub.registerTopicAuthorizer('order:', async (auth, topic) => {
      const orderId = topic.slice('order:'.length);
      if (!/^[0-9a-f-]{36}$/i.test(orderId)) return false;
      return svc.canAccessOrder(auth.userId, orderId);
    });

    return { mountPath: '/market', exports: { market: svc } };
  };
}

export type MarketFeatureService = MarketService;
