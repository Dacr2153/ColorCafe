/**
 * features/farmer/index.ts — HTTP wire del feature productor.
 *
 * Rutas bajo /api/v1/farmer (todas requieren auth role=producer salvo se note):
 *   GET    /profile
 *   PATCH  /profile
 *   GET    /farms
 *   POST   /farms
 *   GET    /farms/:farmId
 *   PATCH  /farms/:farmId
 *   DELETE /farms/:farmId                       (soft delete)
 *   GET    /farms/:farmId/documents
 *   POST   /farms/:farmId/documents             (multipart/form-data: file)
 *   GET    /farms/:farmId/documents/:docId/url  (presigned download)
 *   DELETE /farms/:farmId/documents/:docId
 *   GET    /farms/:farmId/harvests
 *   POST   /farms/:farmId/harvests
 *   PATCH  /farms/:farmId/harvests/:harvestId
 *   DELETE /farms/:farmId/harvests/:harvestId
 */
import { z } from 'zod';
import type { FeatureContext, FeatureHandles, FeatureWire } from '../../core/server.js';
import { FarmerService, type FarmDocumentType } from './service.js';
import { uploadSingle } from '../../core/middleware/upload.js';
import { errors } from '../../core/errors.js';

const profilePatchSchema = z.object({
  nombre: z.string().min(2).max(120).optional(),
  telefono: z.string().max(40).nullable().optional(),
  departamento: z.string().max(80).nullable().optional(),
  municipio: z.string().max(80).nullable().optional(),
  vereda: z.string().max(80).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  altitudMsnm: z.number().int().min(0).max(5000).nullable().optional(),
  areaHectareas: z.number().min(0).max(100000).nullable().optional(),
  variedadCafe: z.array(z.string().max(60)).max(20).nullable().optional(),
  programaCafetero: z.string().max(120).nullable().optional(),
  certificaciones: z.array(z.string().max(80)).max(20).nullable().optional(),
  anosExperiencia: z.number().int().min(0).max(120).nullable().optional(),
});

const farmInputSchema = z.object({
  nombreFinca: z.string().min(2).max(120),
  geometriaPoligono: z.unknown().optional(),
  tipoSuelo: z.string().max(80).nullable().optional(),
  phSuelo: z.number().min(3).max(10).nullable().optional(),
  altitudMsnm: z.number().int().min(0).max(5000).nullable().optional(),
  microclima: z.string().max(120).nullable().optional(),
  fechaUltimoAnalisisSuelo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
const farmPatchSchema = farmInputSchema.partial();

const docTypeSchema = z.enum(['analisis_suelo', 'diagnostico_planta', 'certificacion', 'otro']);

const harvestInputSchema = z.object({
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  periodo: z.enum(['primera', 'mitaca', 'traviesa']).nullable().optional(),
  cerezaKg: z.number().min(0).nullable().optional(),
  pergaminoSecoKg: z.number().min(0).nullable().optional(),
  precioBultoCop: z.number().min(0).nullable().optional(),
  observaciones: z.string().max(2000).nullable().optional(),
});
const harvestPatchSchema = harvestInputSchema.partial();

const uuidParam = z.string().uuid();

const ALLOWED_DOC_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];
const MAX_DOC_BYTES = 10 * 1024 * 1024;  // 10 MB

export function makeFarmerFeature(): FeatureWire {
  return (ctx: FeatureContext): FeatureHandles => {
    const { router, guard, db, storage, log } = ctx;
    const svc = new FarmerService(db, storage, log);

    const requireProducer = { auth: true as const, roles: ['producer' as const] };

    // ───────── perfil ─────────
    router.get('/profile', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const profile = await svc.getProfile(req.auth.sub);
        res.json({ profile });
      } catch (e) { next(e); }
    });

    router.patch('/profile', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const patch = profilePatchSchema.parse(req.body);
        const profile = await svc.updateProfile(req.auth.sub, patch);
        res.json({ profile });
      } catch (e) { next(e); }
    });

    // ───────── fincas ─────────
    router.get('/farms', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const farms = await svc.listFarms(req.auth.sub);
        res.json({ farms });
      } catch (e) { next(e); }
    });

    router.post('/farms', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const input = farmInputSchema.parse(req.body);
        const farm = await svc.createFarm(req.auth.sub, input);
        res.status(201).json({ farm });
      } catch (e) { next(e); }
    });

    router.get('/farms/:farmId', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const farmId = uuidParam.parse(req.params.farmId);
        const farm = await svc.getFarm(req.auth.sub, farmId);
        res.json({ farm });
      } catch (e) { next(e); }
    });

    router.patch('/farms/:farmId', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const farmId = uuidParam.parse(req.params.farmId);
        const input = farmPatchSchema.parse(req.body);
        const farm = await svc.updateFarm(req.auth.sub, farmId, input);
        res.json({ farm });
      } catch (e) { next(e); }
    });

    router.delete('/farms/:farmId', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const farmId = uuidParam.parse(req.params.farmId);
        const result = await svc.deactivateFarm(req.auth.sub, farmId);
        res.json(result);
      } catch (e) { next(e); }
    });

    // ───────── documentos ─────────
    router.get('/farms/:farmId/documents', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const farmId = uuidParam.parse(req.params.farmId);
        const documents = await svc.listDocuments(req.auth.sub, farmId);
        res.json({ documents });
      } catch (e) { next(e); }
    });

    router.post(
      '/farms/:farmId/documents',
      ...guard(requireProducer),
      ...uploadSingle({ field: 'file', maxBytes: MAX_DOC_BYTES, allowedMime: ALLOWED_DOC_MIME }),
      async (req, res, next) => {
        try {
          if (!req.auth) return next(errors.unauthorized());
          const farmId = uuidParam.parse(req.params.farmId);
          const tipo = docTypeSchema.parse(req.body.tipo) as FarmDocumentType;
          if (!req.file) return next(errors.badRequest('file_required'));
          const result = await svc.uploadDocument(req.auth.sub, farmId, tipo, {
            buffer: req.file.buffer,
            filename: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
          });
          res.status(result.deduped ? 200 : 201).json(result);
        } catch (e) { next(e); }
      },
    );

    router.get('/farms/:farmId/documents/:docId/url', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const farmId = uuidParam.parse(req.params.farmId);
        const docId = uuidParam.parse(req.params.docId);
        const out = await svc.getDocumentDownloadUrl(req.auth.sub, farmId, docId);
        res.json(out);
      } catch (e) { next(e); }
    });

    router.delete('/farms/:farmId/documents/:docId', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const farmId = uuidParam.parse(req.params.farmId);
        const docId = uuidParam.parse(req.params.docId);
        const r = await svc.deleteDocument(req.auth.sub, farmId, docId);
        res.json(r);
      } catch (e) { next(e); }
    });

    // ───────── cosechas ─────────
    router.get('/farms/:farmId/harvests', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const farmId = uuidParam.parse(req.params.farmId);
        const harvests = await svc.listHarvests(req.auth.sub, farmId);
        res.json({ harvests });
      } catch (e) { next(e); }
    });

    router.post('/farms/:farmId/harvests', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const farmId = uuidParam.parse(req.params.farmId);
        const input = harvestInputSchema.parse(req.body);
        const harvest = await svc.createHarvest(req.auth.sub, farmId, input);
        res.status(201).json({ harvest });
      } catch (e) { next(e); }
    });

    router.patch('/farms/:farmId/harvests/:harvestId', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const farmId = uuidParam.parse(req.params.farmId);
        const harvestId = uuidParam.parse(req.params.harvestId);
        const input = harvestPatchSchema.parse(req.body);
        const harvest = await svc.updateHarvest(req.auth.sub, farmId, harvestId, input);
        res.json({ harvest });
      } catch (e) { next(e); }
    });

    router.delete('/farms/:farmId/harvests/:harvestId', ...guard(requireProducer), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const farmId = uuidParam.parse(req.params.farmId);
        const harvestId = uuidParam.parse(req.params.harvestId);
        const r = await svc.deleteHarvest(req.auth.sub, farmId, harvestId);
        res.json(r);
      } catch (e) { next(e); }
    });

    return {
      mountPath: '/farmer',
      exports: { farmer: svc },
    };
  };
}

export type FarmerFeatureService = FarmerService;
