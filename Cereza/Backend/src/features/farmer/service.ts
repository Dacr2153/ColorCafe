/**
 * features/farmer/service.ts — Lógica de negocio del productor.
 *
 * Responsable de:
 *  - Perfil de productor (producer_profiles) — el propio usuario lo edita.
 *  - Fincas (farms) — CRUD; cada finca pertenece a un productor.
 *  - Documentos de finca (farm_documents) — sube a MinIO `cafe-documents`,
 *    dedupe por SHA256 (UNIQUE farm_id+contenido_hash a nivel DB).
 *  - Cosechas (harvests) — registro histórico por finca.
 *
 * Reglas de propiedad: TODA mutación verifica que el `producer_id`/owner
 * coincida con `auth.sub` antes de proceder. No se confía en `farm_id` ni
 * `harvest_id` provenientes del cliente sin re-verificación.
 */
import crypto from 'node:crypto';
import type { Pool } from 'pg';
import type { Database } from '../../core/database.js';
import type { Storage } from '../../core/storage.js';
import type { Logger } from '../../core/logger.js';
import { errors } from '../../core/errors.js';

export type FarmDocumentType = 'analisis_suelo' | 'diagnostico_planta' | 'certificacion' | 'otro';
export type HarvestPeriod = 'primera' | 'mitaca' | 'traviesa';

export interface ProducerProfilePatch {
  nombre?: string;
  telefono?: string | null;
  departamento?: string | null;
  municipio?: string | null;
  vereda?: string | null;
  lat?: number | null;
  lng?: number | null;
  altitudMsnm?: number | null;
  areaHectareas?: number | null;
  variedadCafe?: string[] | null;
  programaCafetero?: string | null;
  certificaciones?: string[] | null;
  anosExperiencia?: number | null;
}

export interface FarmInput {
  nombreFinca: string;
  geometriaPoligono?: unknown;
  tipoSuelo?: string | null;
  phSuelo?: number | null;
  altitudMsnm?: number | null;
  microclima?: string | null;
  fechaUltimoAnalisisSuelo?: string | null;  // ISO date
}

export interface HarvestInput {
  fechaInicio: string;        // ISO date
  fechaFin?: string | null;
  periodo?: HarvestPeriod | null;
  cerezaKg?: number | null;
  pergaminoSecoKg?: number | null;
  precioBultoCop?: number | null;
  observaciones?: string | null;
}

export interface UploadedDocument {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  size: number;
}

export class FarmerService {
  constructor(
    private db: Database,
    private storage: Storage,
    private log: Logger,
  ) {}

  private pool(): Pool { return this.db.pool_(); }

  // ───────────────────────── perfil productor ─────────────────────────

  async getProfile(userId: string) {
    const r = await this.pool().query(
      `SELECT user_id, nombre, telefono, departamento, municipio, vereda,
              lat, lng, altitud_msnm, area_hectareas, variedad_cafe,
              programa_cafetero, certificaciones, anos_experiencia,
              created_at, updated_at
         FROM producer_profiles WHERE user_id = $1`,
      [userId],
    );
    if (r.rowCount === 0) throw errors.notFound('producer_profile_not_found');
    return r.rows[0];
  }

  async updateProfile(userId: string, patch: ProducerProfilePatch) {
    // Construye SET dinámico solo con campos provistos para no pisar con NULL.
    const cols: string[] = [];
    const vals: unknown[] = [];
    const map: Array<[keyof ProducerProfilePatch, string]> = [
      ['nombre', 'nombre'],
      ['telefono', 'telefono'],
      ['departamento', 'departamento'],
      ['municipio', 'municipio'],
      ['vereda', 'vereda'],
      ['lat', 'lat'],
      ['lng', 'lng'],
      ['altitudMsnm', 'altitud_msnm'],
      ['areaHectareas', 'area_hectareas'],
      ['variedadCafe', 'variedad_cafe'],
      ['programaCafetero', 'programa_cafetero'],
      ['certificaciones', 'certificaciones'],
      ['anosExperiencia', 'anos_experiencia'],
    ];
    for (const [k, col] of map) {
      if (patch[k] !== undefined) {
        vals.push(patch[k]);
        cols.push(`${col} = $${vals.length}`);
      }
    }
    if (cols.length === 0) return this.getProfile(userId);
    vals.push(userId);
    const r = await this.pool().query(
      `UPDATE producer_profiles
          SET ${cols.join(', ')}, updated_at = NOW()
        WHERE user_id = $${vals.length}
        RETURNING user_id`,
      vals,
    );
    if (r.rowCount === 0) throw errors.notFound('producer_profile_not_found');
    return this.getProfile(userId);
  }

  // ───────────────────────────── fincas ───────────────────────────────

  async listFarms(userId: string) {
    const r = await this.pool().query(
      `SELECT id, nombre_finca, geometria_poligono, tipo_suelo, ph_suelo,
              altitud_msnm, microclima, fecha_ultimo_analisis_suelo,
              is_active, created_at, updated_at
         FROM farms
        WHERE producer_id = $1 AND is_active = TRUE
        ORDER BY created_at DESC`,
      [userId],
    );
    return r.rows;
  }

  async getFarm(userId: string, farmId: string) {
    const r = await this.pool().query(
      `SELECT id, producer_id, nombre_finca, geometria_poligono, tipo_suelo, ph_suelo,
              altitud_msnm, microclima, fecha_ultimo_analisis_suelo,
              is_active, created_at, updated_at
         FROM farms
        WHERE id = $1 AND producer_id = $2`,
      [farmId, userId],
    );
    if (r.rowCount === 0) throw errors.notFound('farm_not_found');
    return r.rows[0]!;
  }

  async createFarm(userId: string, input: FarmInput) {
    const r = await this.pool().query(
      `INSERT INTO farms (
          producer_id, nombre_finca, geometria_poligono, tipo_suelo, ph_suelo,
          altitud_msnm, microclima, fecha_ultimo_analisis_suelo
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, nombre_finca, created_at`,
      [
        userId,
        input.nombreFinca,
        input.geometriaPoligono ? JSON.stringify(input.geometriaPoligono) : null,
        input.tipoSuelo ?? null,
        input.phSuelo ?? null,
        input.altitudMsnm ?? null,
        input.microclima ?? null,
        input.fechaUltimoAnalisisSuelo ?? null,
      ],
    );
    this.log.info({ userId, farmId: r.rows[0]!.id }, 'farm_created');
    return r.rows[0]!;
  }

  async updateFarm(userId: string, farmId: string, input: Partial<FarmInput>) {
    // Verificación de propiedad explícita.
    await this.getFarm(userId, farmId);
    const cols: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, val: unknown) => { vals.push(val); cols.push(`${col} = $${vals.length}`); };
    if (input.nombreFinca !== undefined) push('nombre_finca', input.nombreFinca);
    if (input.geometriaPoligono !== undefined) push('geometria_poligono', input.geometriaPoligono ? JSON.stringify(input.geometriaPoligono) : null);
    if (input.tipoSuelo !== undefined) push('tipo_suelo', input.tipoSuelo);
    if (input.phSuelo !== undefined) push('ph_suelo', input.phSuelo);
    if (input.altitudMsnm !== undefined) push('altitud_msnm', input.altitudMsnm);
    if (input.microclima !== undefined) push('microclima', input.microclima);
    if (input.fechaUltimoAnalisisSuelo !== undefined) push('fecha_ultimo_analisis_suelo', input.fechaUltimoAnalisisSuelo);
    if (cols.length === 0) return this.getFarm(userId, farmId);
    vals.push(farmId, userId);
    await this.pool().query(
      `UPDATE farms SET ${cols.join(', ')}, updated_at = NOW()
        WHERE id = $${vals.length - 1} AND producer_id = $${vals.length}`,
      vals,
    );
    return this.getFarm(userId, farmId);
  }

  /** Soft-delete (is_active = FALSE). No borra cosechas/documentos históricos. */
  async deactivateFarm(userId: string, farmId: string) {
    const r = await this.pool().query(
      `UPDATE farms SET is_active = FALSE, updated_at = NOW()
        WHERE id = $1 AND producer_id = $2 AND is_active = TRUE
        RETURNING id`,
      [farmId, userId],
    );
    if (r.rowCount === 0) throw errors.notFound('farm_not_found');
    this.log.info({ userId, farmId }, 'farm_deactivated');
    return { ok: true };
  }

  // ─────────────────────── documentos de finca ────────────────────────

  async listDocuments(userId: string, farmId: string) {
    await this.getFarm(userId, farmId);  // verifica propiedad
    const r = await this.pool().query(
      `SELECT id, tipo, nombre_archivo, mime_type, contenido_hash, tamano_bytes,
              storage_ref, created_at
         FROM farm_documents
        WHERE farm_id = $1
        ORDER BY created_at DESC`,
      [farmId],
    );
    return r.rows;
  }

  async uploadDocument(
    userId: string,
    farmId: string,
    tipo: FarmDocumentType,
    file: UploadedDocument,
  ) {
    await this.getFarm(userId, farmId);  // verifica propiedad

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // Dedupe: si ya existe el (farm_id, hash) devolvemos el registro existente.
    const existing = await this.pool().query(
      `SELECT id, tipo, nombre_archivo, mime_type, contenido_hash, tamano_bytes,
              storage_ref, created_at
         FROM farm_documents
        WHERE farm_id = $1 AND contenido_hash = $2`,
      [farmId, sha256],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      this.log.info({ userId, farmId, sha256 }, 'farm_document_deduped');
      return { document: existing.rows[0]!, deduped: true };
    }

    // Sube a MinIO. Convención de key: farms/{farmId}/{sha256}{ext}
    const ext = pickExtension(file.mimetype, file.filename);
    const key = `farms/${farmId}/${sha256}${ext}`;
    await this.storage.put(
      this.storage.buckets.documents,
      key,
      file.buffer,
      file.size,
      {
        'Content-Type': file.mimetype,
        'X-Amz-Meta-Sha256': sha256,
        'X-Amz-Meta-Uploaded-By': userId,
        'X-Amz-Meta-Original-Name': encodeURIComponent(file.filename),
      },
    );

    try {
      const r = await this.pool().query(
        `INSERT INTO farm_documents (
            farm_id, tipo, nombre_archivo, mime_type, contenido_hash,
            tamano_bytes, storage_ref
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, tipo, nombre_archivo, mime_type, contenido_hash,
                   tamano_bytes, storage_ref, created_at`,
        [farmId, tipo, file.filename, file.mimetype, sha256, file.size, key],
      );
      this.log.info({ userId, farmId, sha256, key }, 'farm_document_uploaded');
      return { document: r.rows[0]!, deduped: false };
    } catch (e) {
      // Si la inserción falla, intentar limpiar el objeto huérfano en MinIO.
      await this.storage.remove(this.storage.buckets.documents, key)
        .catch((err) => this.log.warn({ err: (err as Error).message, key }, 'orphan_object_cleanup_failed'));
      throw e;
    }
  }

  async getDocumentDownloadUrl(userId: string, farmId: string, docId: string) {
    await this.getFarm(userId, farmId);
    const r = await this.pool().query(
      `SELECT storage_ref, nombre_archivo, mime_type
         FROM farm_documents
        WHERE id = $1 AND farm_id = $2`,
      [docId, farmId],
    );
    if (r.rowCount === 0) throw errors.notFound('document_not_found');
    const row = r.rows[0]!;
    const url = await this.storage.presignedGet(this.storage.buckets.documents, row.storage_ref, 600);
    return { url, expiresInSeconds: 600, filename: row.nombre_archivo, mimeType: row.mime_type };
  }

  async deleteDocument(userId: string, farmId: string, docId: string) {
    await this.getFarm(userId, farmId);
    return this.db.tx(async (c) => {
      const r = await c.query(
        `DELETE FROM farm_documents WHERE id = $1 AND farm_id = $2 RETURNING storage_ref`,
        [docId, farmId],
      );
      if (r.rowCount === 0) throw errors.notFound('document_not_found');
      const key = r.rows[0]!.storage_ref as string;
      // Borra del bucket DESPUÉS del DELETE para que ROLLBACK no deje DB con ref viva
      // apuntando a objeto borrado. Si falla, log pero deja la DB consistente.
      await this.storage.remove(this.storage.buckets.documents, key)
        .catch((err) => this.log.warn({ err: (err as Error).message, key }, 'document_storage_remove_failed'));
      return { ok: true };
    });
  }

  // ──────────────────────────── cosechas ──────────────────────────────

  async listHarvests(userId: string, farmId: string) {
    await this.getFarm(userId, farmId);
    const r = await this.pool().query(
      `SELECT id, fecha_inicio, fecha_fin, periodo, cereza_kg, pergamino_seco_kg,
              precio_bulto_cop, observaciones, created_at
         FROM harvests
        WHERE farm_id = $1
        ORDER BY fecha_inicio DESC`,
      [farmId],
    );
    return r.rows;
  }

  async createHarvest(userId: string, farmId: string, input: HarvestInput) {
    await this.getFarm(userId, farmId);
    if (input.fechaFin && input.fechaFin < input.fechaInicio) {
      throw errors.badRequest('fecha_fin_before_inicio');
    }
    const r = await this.pool().query(
      `INSERT INTO harvests (
          farm_id, fecha_inicio, fecha_fin, periodo, cereza_kg,
          pergamino_seco_kg, precio_bulto_cop, observaciones
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, fecha_inicio, fecha_fin, periodo, cereza_kg,
                 pergamino_seco_kg, precio_bulto_cop, observaciones, created_at`,
      [
        farmId,
        input.fechaInicio,
        input.fechaFin ?? null,
        input.periodo ?? null,
        input.cerezaKg ?? null,
        input.pergaminoSecoKg ?? null,
        input.precioBultoCop ?? null,
        input.observaciones ?? null,
      ],
    );
    this.log.info({ userId, farmId, harvestId: r.rows[0]!.id }, 'harvest_created');
    return r.rows[0]!;
  }

  async updateHarvest(userId: string, farmId: string, harvestId: string, input: Partial<HarvestInput>) {
    await this.getFarm(userId, farmId);
    const cols: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, val: unknown) => { vals.push(val); cols.push(`${col} = $${vals.length}`); };
    if (input.fechaInicio !== undefined) push('fecha_inicio', input.fechaInicio);
    if (input.fechaFin !== undefined) push('fecha_fin', input.fechaFin);
    if (input.periodo !== undefined) push('periodo', input.periodo);
    if (input.cerezaKg !== undefined) push('cereza_kg', input.cerezaKg);
    if (input.pergaminoSecoKg !== undefined) push('pergamino_seco_kg', input.pergaminoSecoKg);
    if (input.precioBultoCop !== undefined) push('precio_bulto_cop', input.precioBultoCop);
    if (input.observaciones !== undefined) push('observaciones', input.observaciones);
    if (cols.length === 0) {
      const existing = await this.pool().query(`SELECT * FROM harvests WHERE id = $1 AND farm_id = $2`, [harvestId, farmId]);
      if (existing.rowCount === 0) throw errors.notFound('harvest_not_found');
      return existing.rows[0]!;
    }
    vals.push(harvestId, farmId);
    const r = await this.pool().query(
      `UPDATE harvests SET ${cols.join(', ')}
        WHERE id = $${vals.length - 1} AND farm_id = $${vals.length}
        RETURNING id, fecha_inicio, fecha_fin, periodo, cereza_kg,
                  pergamino_seco_kg, precio_bulto_cop, observaciones, created_at`,
      vals,
    );
    if (r.rowCount === 0) throw errors.notFound('harvest_not_found');
    return r.rows[0]!;
  }

  async deleteHarvest(userId: string, farmId: string, harvestId: string) {
    await this.getFarm(userId, farmId);
    const r = await this.pool().query(
      `DELETE FROM harvests WHERE id = $1 AND farm_id = $2 RETURNING id`,
      [harvestId, farmId],
    );
    if (r.rowCount === 0) throw errors.notFound('harvest_not_found');
    return { ok: true };
  }
}

// ──────────────────────────── helpers ────────────────────────────────

function pickExtension(mime: string, filename: string): string {
  const fromName = filename.match(/(\.[a-z0-9]{1,8})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  return map[mime] ?? '.bin';
}
