/**
 * features/content/index.ts — HTTP wire de noticias + tips.
 *
 * Rutas bajo /api/v1/content:
 *   GET    /news                       (público — sólo publicadas)
 *   GET    /news/:id                   (público)
 *   POST   /news/:id/ai-summary        (auth)
 *   POST   /news                       (admin)
 *   PATCH  /news/:id                   (admin)
 *   DELETE /news/:id                   (admin)
 *
 *   GET    /tips                       (auth)
 *   GET    /tips/:id                   (auth)
 *   POST   /tips                       (admin)
 *   DELETE /tips/:id                   (admin)
 */
import { z } from 'zod';
import type { FeatureContext, FeatureHandles, FeatureWire } from '../../core/server.js';
import { ContentService } from './service.js';
import { OllamaClient } from './ollama.js';
import { errors } from '../../core/errors.js';

const newsCreateSchema = z.object({
  titulo: z.string().min(3).max(300),
  resumen: z.string().max(1000).nullable().optional(),
  contenidoHtml: z.string().max(200000).nullable().optional(),
  fuente: z.string().min(2).max(120),
  urlOriginal: z.string().url().max(2000).nullable().optional(),
  imagenPortada: z.string().url().max(2000).nullable().optional(),
  categorias: z.array(z.string().max(40)).max(15).nullable().optional(),
  tags: z.array(z.string().max(40)).max(30).nullable().optional(),
  publicadoAt: z.string().datetime().nullable().optional(),
  isPublished: z.boolean().optional(),
  isVerified: z.boolean().optional(),
});
const newsPatchSchema = newsCreateSchema.partial();

const tipCreateSchema = z.object({
  titulo: z.string().min(3).max(200),
  contenido: z.string().min(10).max(20000),
  nivelDificultad: z.enum(['basico', 'intermedio', 'avanzado']).optional(),
  categoria: z.enum(['fertilizacion', 'plagas', 'cosecha', 'beneficio', 'calidad', 'clima', 'comercializacion']),
  fuenteCientifica: z.string().min(3).max(500),
  aplicableVariedades: z.array(z.string().max(60)).max(30).nullable().optional(),
  aplicableAltitudesMin: z.number().int().min(0).max(5000).nullable().optional(),
  aplicableAltitudesMax: z.number().int().min(0).max(5000).nullable().optional(),
  validadoPor: z.string().max(200).nullable().optional(),
});

const uuidParam = z.string().uuid();

export function makeContentFeature(): FeatureWire {
  return (ctx: FeatureContext): FeatureHandles => {
    const { router, guard, db, cache, log, config } = ctx;
    const ollama = new OllamaClient(
      { baseUrl: config.ollama.baseUrl, model: config.ollama.model, timeoutMs: config.ollama.timeoutMs },
      log,
    );
    const svc = new ContentService(db, cache, log, ollama);

    const publicRoute = { auth: false as const };
    const authRoute   = { auth: true as const };
    const adminRoute  = { auth: true as const, roles: ['admin' as const] };

    // ───────── news ─────────
    router.get('/news', ...guard(publicRoute), async (req, res, next) => {
      try {
        const q = z.object({
          search: z.string().min(2).max(120).optional(),
          categoria: z.string().min(2).max(60).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
          offset: z.coerce.number().int().min(0).max(10000).optional(),
        }).parse(req.query);
        const result = await svc.listNews(q);
        res.json(result);
      } catch (e) { next(e); }
    });

    router.get('/news/:id', ...guard(publicRoute), async (req, res, next) => {
      try {
        const id = uuidParam.parse(req.params.id);
        const article = await svc.getNews(id);
        res.json({ article });
      } catch (e) { next(e); }
    });

    router.post('/news/:id/ai-summary', ...guard({ ...authRoute, rateLimit: 20 }), async (req, res, next) => {
      try {
        const id = uuidParam.parse(req.params.id);
        const r = await svc.aiSummary(id);
        res.json(r);
      } catch (e) { next(e); }
    });

    router.post('/news', ...guard(adminRoute), async (req, res, next) => {
      try {
        const input = newsCreateSchema.parse(req.body);
        const r = await svc.createNews(input);
        res.status(201).json(r);
      } catch (e) { next(e); }
    });

    router.patch('/news/:id', ...guard(adminRoute), async (req, res, next) => {
      try {
        const id = uuidParam.parse(req.params.id);
        const input = newsPatchSchema.parse(req.body);
        const article = await svc.updateNews(id, input);
        res.json({ article });
      } catch (e) { next(e); }
    });

    router.delete('/news/:id', ...guard(adminRoute), async (req, res, next) => {
      try {
        const id = uuidParam.parse(req.params.id);
        const r = await svc.deleteNews(id);
        res.json(r);
      } catch (e) { next(e); }
    });

    // ───────── comments (foro) ─────────
    router.get('/news/:id/comments', ...guard(publicRoute), async (req, res, next) => {
      try {
        const id = uuidParam.parse(req.params.id);
        const r = await svc.listComments(id);
        res.json(r);
      } catch (e) { next(e); }
    });

    router.post('/news/:id/comments', ...guard({ ...authRoute, rateLimit: 30 }), async (req, res, next) => {
      try {
        const id = uuidParam.parse(req.params.id);
        const body = z.object({
          body: z.string().min(1).max(4000),
          parentId: z.string().uuid().optional().nullable(),
        }).parse(req.body);
        const userId = req.auth!.sub;
        const r = await svc.createComment(id, userId, body.body, body.parentId ?? null);
        res.status(201).json(r);
      } catch (e) { next(e); }
    });

    router.delete('/news/comments/:commentId', ...guard(authRoute), async (req, res, next) => {
      try {
        const commentId = uuidParam.parse(req.params.commentId);
        const userId = req.auth!.sub;
        const isAdmin = req.auth!.role === 'admin';
        const r = await svc.deleteComment(commentId, userId, isAdmin);
        res.json(r);
      } catch (e) { next(e); }
    });

    // ───────── tips ─────────
    router.get('/tips', ...guard(authRoute), async (req, res, next) => {
      try {
        const q = z.object({
          categoria: z.string().max(40).optional(),
          variedad: z.string().max(60).optional(),
          nivelDificultad: z.enum(['basico', 'intermedio', 'avanzado']).optional(),
          altitudMsnm: z.coerce.number().int().min(0).max(5000).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          offset: z.coerce.number().int().min(0).max(10000).optional(),
        }).parse(req.query);
        const result = await svc.listTips(q);
        res.json(result);
      } catch (e) { next(e); }
    });

    router.get('/tips/:id', ...guard(authRoute), async (req, res, next) => {
      try {
        const id = uuidParam.parse(req.params.id);
        const tip = await svc.getTip(id);
        res.json({ tip });
      } catch (e) { next(e); }
    });

    router.post('/tips', ...guard(adminRoute), async (req, res, next) => {
      try {
        const input = tipCreateSchema.parse(req.body);
        const r = await svc.createTip(input);
        res.status(201).json(r);
      } catch (e) { next(e); }
    });

    router.delete('/tips/:id', ...guard(adminRoute), async (req, res, next) => {
      try {
        const id = uuidParam.parse(req.params.id);
        const r = await svc.deleteTip(id);
        res.json(r);
      } catch (e) { next(e); }
    });

    void errors;  // imported for future use in custom error mapping
    return { mountPath: '/content', exports: { content: svc } };
  };
}

export type ContentFeatureService = ContentService;
