/**
 * features/market/service.ts — Marketplace: listings + search + orders + chat.
 *
 * Roles:
 *  - producer: crea/edita listings propios (status='pending_review' al crear y
 *    al editar campos críticos). Acepta/rechaza órdenes que reciba.
 *  - buyer: busca listings activos, crea órdenes, manda mensajes.
 *  - admin: aprueba/rechaza listings (cambia a 'active' o 'rejected' con motivo).
 *
 * State machine de orders:
 *   pending → accepted (producer) | rejected (producer) | cancelled (buyer)
 *   accepted → in_transit (producer) | cancelled (buyer)
 *   in_transit → delivered (producer)
 *   delivered | rejected | cancelled: TERMINAL.
 */
import type { Pool, PoolClient } from 'pg';
import type { Database } from '../../core/database.js';
import type { Cache } from '../../core/cache.js';
import type { WebSocketHub } from '../../core/websocket.js';
import type { Logger } from '../../core/logger.js';
import { errors } from '../../core/errors.js';

export type ListingProcess = 'lavado' | 'natural' | 'honey' | 'anaerobic';
export type ListingStatus  = 'pending_review' | 'active' | 'paused' | 'sold' | 'rejected';
export type OrderStatus    = 'pending' | 'accepted' | 'rejected' | 'in_transit' | 'delivered' | 'cancelled';

export interface ListingInput {
  titulo: string;
  descripcion?: string | null;
  variedad: string;
  proceso: ListingProcess;
  puntuacionTaza?: number | null;
  cantidadKg: number;
  precioKgCop: number;
  analysisId?: string | null;
  analysisCapturedAt?: string | null;
  farmId?: string | null;
  fechaCosecha?: string | null;
  disponibleDesde?: string | null;
  disponibleHasta?: string | null;
  fotos?: string[] | null;
}

export interface SearchOpts {
  q?: string;
  proceso?: ListingProcess;
  variedad?: string;
  minScore?: number;
  maxPrice?: number;
  limit?: number;
  offset?: number;
}

const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending:     ['accepted', 'rejected', 'cancelled'],
  accepted:    ['in_transit', 'cancelled'],
  in_transit:  ['delivered'],
  rejected:    [],
  cancelled:   [],
  delivered:   [],
};

/** Útil para tests y para frontends que necesitan validar antes de pedir. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Quién puede ejecutar cada transición (sólo presentacional/validación). */
export function allowedActor(to: OrderStatus): 'buyer' | 'producer' | 'either' {
  if (to === 'cancelled') return 'buyer';
  if (to === 'rejected' || to === 'in_transit' || to === 'delivered') return 'producer';
  if (to === 'accepted') return 'producer';
  return 'either';
}

export class MarketService {
  constructor(
    private db: Database,
    private cache: Cache,
    private hub: WebSocketHub,
    private log: Logger,
  ) {}

  private pool(): Pool { return this.db.pool_(); }

  // ───────────────────────── LISTINGS ─────────────────────────

  async createListing(userId: string, input: ListingInput) {
    // Si referencia un análisis, verificar propiedad.
    if (input.analysisId) {
      const a = await this.pool().query(
        `SELECT 1 FROM image_analyses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [input.analysisId, userId],
      );
      if (a.rowCount === 0) throw errors.forbidden('analysis_not_owned');
    }
    if (input.farmId) {
      const f = await this.pool().query(
        `SELECT 1 FROM farms WHERE id = $1 AND producer_id = $2`,
        [input.farmId, userId],
      );
      if (f.rowCount === 0) throw errors.forbidden('farm_not_owned');
    }
    const r = await this.pool().query(
      `INSERT INTO product_listings (
          producer_id, farm_id, titulo, descripcion, variedad, proceso,
          puntuacion_taza, cantidad_kg, precio_kg_cop, analysis_id,
          analysis_captured_at, fecha_cosecha, disponible_desde,
          disponible_hasta, fotos, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending_review')
       RETURNING id`,
      [
        userId, input.farmId ?? null, input.titulo, input.descripcion ?? null,
        input.variedad, input.proceso, input.puntuacionTaza ?? null,
        input.cantidadKg, input.precioKgCop, input.analysisId ?? null,
        input.analysisCapturedAt ?? null, input.fechaCosecha ?? null,
        input.disponibleDesde ?? null, input.disponibleHasta ?? null,
        input.fotos ?? null,
      ],
    );
    await this.cache.invalidatePrefix('market:search:').catch(() => { /* ignore */ });
    return this.getListing(r.rows[0]!.id, userId);
  }

  async getListing(id: string, viewerUserId?: string) {
    const r = await this.pool().query(
      `SELECT l.*,
              u.email AS producer_email,
              p.nombre AS producer_nombre,
              p.departamento, p.municipio
         FROM product_listings l
         JOIN users u ON u.id = l.producer_id
         LEFT JOIN producer_profiles p ON p.user_id = l.producer_id
        WHERE l.id = $1`,
      [id],
    );
    if (r.rowCount === 0) throw errors.notFound('listing_not_found');
    const row = r.rows[0]!;
    // Si está en pending_review/rejected, solo el dueño o admin lo ven.
    if (row.status !== 'active' && row.status !== 'paused' && row.status !== 'sold') {
      if (!viewerUserId || viewerUserId !== row.producer_id) {
        throw errors.notFound('listing_not_found');
      }
    }
    // Best-effort: cuenta una vista si la ve alguien que no es el dueño.
    if (viewerUserId && viewerUserId !== row.producer_id) {
      void this.pool().query(`UPDATE product_listings SET views_count = views_count + 1 WHERE id = $1`, [id])
        .catch(() => { /* ignore */ });
    }
    return row;
  }

  async listMyListings(userId: string) {
    const r = await this.pool().query(
      `SELECT id, titulo, variedad, proceso, cantidad_kg, precio_kg_cop,
              status, quality_score, views_count, contacts_count, created_at, updated_at
         FROM product_listings
        WHERE producer_id = $1
        ORDER BY created_at DESC`,
      [userId],
    );
    return r.rows;
  }

  async updateListing(userId: string, id: string, input: Partial<ListingInput>) {
    return this.db.tx(async (c) => {
      const cur = await c.query(
        `SELECT producer_id, status FROM product_listings WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (cur.rowCount === 0) throw errors.notFound('listing_not_found');
      if (cur.rows[0]!.producer_id !== userId) throw errors.forbidden('not_owner');
      if (cur.rows[0]!.status === 'sold') throw errors.badRequest('listing_sold');

      const cols: string[] = [];
      const vals: unknown[] = [];
      const push = (col: string, val: unknown) => { vals.push(val); cols.push(`${col} = $${vals.length}`); };
      const significant: Array<keyof ListingInput> = ['titulo', 'descripcion', 'variedad', 'proceso', 'cantidadKg', 'precioKgCop'];
      let needsReReview = false;
      const map: Array<[keyof ListingInput, string]> = [
        ['titulo', 'titulo'], ['descripcion', 'descripcion'], ['variedad', 'variedad'],
        ['proceso', 'proceso'], ['puntuacionTaza', 'puntuacion_taza'],
        ['cantidadKg', 'cantidad_kg'], ['precioKgCop', 'precio_kg_cop'],
        ['fechaCosecha', 'fecha_cosecha'], ['disponibleDesde', 'disponible_desde'],
        ['disponibleHasta', 'disponible_hasta'], ['fotos', 'fotos'],
      ];
      for (const [k, col] of map) {
        if (input[k] !== undefined) {
          push(col, input[k]);
          if (significant.includes(k)) needsReReview = true;
        }
      }
      if (cols.length === 0) {
        const row = await c.query(`SELECT * FROM product_listings WHERE id = $1`, [id]);
        return row.rows[0]!;
      }
      if (needsReReview && cur.rows[0]!.status === 'active') {
        push('status', 'pending_review');
        push('rejection_reason', null);
      }
      vals.push(id);
      const r = await c.query(
        `UPDATE product_listings SET ${cols.join(', ')} WHERE id = $${vals.length} RETURNING *`,
        vals,
      );
      await this.cache.invalidatePrefix('market:search:').catch(() => { /* ignore */ });
      return r.rows[0]!;
    });
  }

  async deleteListing(userId: string, id: string) {
    const r = await this.pool().query(
      `DELETE FROM product_listings WHERE id = $1 AND producer_id = $2 RETURNING id`,
      [id, userId],
    );
    if (r.rowCount === 0) throw errors.notFound('listing_not_found');
    await this.cache.invalidatePrefix('market:search:').catch(() => { /* ignore */ });
    return { ok: true };
  }

  /** Admin aprueba/rechaza. Al aprobar, copia overall_score del análisis si existe. */
  async reviewListing(adminId: string, id: string, decision: 'approve' | 'reject', reason?: string) {
    return this.db.tx(async (c) => {
      const r = await c.query(`SELECT analysis_id, analysis_captured_at FROM product_listings WHERE id = $1 FOR UPDATE`, [id]);
      if (r.rowCount === 0) throw errors.notFound('listing_not_found');
      const { analysis_id, analysis_captured_at } = r.rows[0]! as { analysis_id: string | null; analysis_captured_at: Date | null };
      let qualityScore: number | null = null;
      if (decision === 'approve' && analysis_id && analysis_captured_at) {
        const a = await c.query(
          `SELECT overall_score FROM image_analyses
            WHERE id = $1 AND captured_at = $2 AND processing_status = 'completed'`,
          [analysis_id, analysis_captured_at],
        );
        if (a.rowCount && a.rowCount > 0 && a.rows[0]!.overall_score !== null) {
          qualityScore = Number(a.rows[0]!.overall_score);
        }
      }
      const newStatus: ListingStatus = decision === 'approve' ? 'active' : 'rejected';
      await c.query(
        `UPDATE product_listings
            SET status = $2, quality_score = $3,
                rejection_reason = $4
          WHERE id = $1`,
        [id, newStatus, qualityScore, decision === 'reject' ? reason ?? null : null],
      );
      await this.cache.invalidatePrefix('market:search:').catch(() => { /* ignore */ });
      this.log.info({ adminId, listingId: id, decision }, 'listing_reviewed');
      return { id, status: newStatus, qualityScore };
    });
  }

  async pauseListing(userId: string, id: string, pause: boolean) {
    const target: ListingStatus = pause ? 'paused' : 'active';
    const r = await this.pool().query(
      `UPDATE product_listings
          SET status = $3
        WHERE id = $1 AND producer_id = $2
          AND status IN ('active', 'paused')
        RETURNING id, status`,
      [id, userId, target],
    );
    if (r.rowCount === 0) throw errors.notFound('listing_not_found');
    await this.cache.invalidatePrefix('market:search:').catch(() => { /* ignore */ });
    return r.rows[0]!;
  }

  // ───────────────────────── SEARCH ─────────────────────────

  async search(opts: SearchOpts) {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const cacheKey = `market:search:${opts.q ?? ''}:${opts.proceso ?? ''}:${opts.variedad ?? ''}:${opts.minScore ?? ''}:${opts.maxPrice ?? ''}:${limit}:${offset}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const params: unknown[] = [];
    const wheres: string[] = [`status = 'active'`];
    let rankSel = '';
    let orderBy = 'created_at DESC';

    if (opts.q) {
      params.push(opts.q);
      // Estrategia multi: full-text + trigram fallback. Usamos OR para no perder coincidencias.
      wheres.push(
        `(search_tsv @@ plainto_tsquery('spanish', unaccent($${params.length}))
           OR similarity(titulo, $${params.length}) > 0.25
           OR similarity(variedad, $${params.length}) > 0.3)`,
      );
      rankSel = `, ts_rank(search_tsv, plainto_tsquery('spanish', unaccent($1)))
                  + GREATEST(similarity(titulo, $1), similarity(variedad, $1)) AS rank`;
      orderBy = 'rank DESC, created_at DESC';
    }
    if (opts.proceso) { params.push(opts.proceso); wheres.push(`proceso = $${params.length}`); }
    if (opts.variedad) { params.push(opts.variedad); wheres.push(`variedad = $${params.length}`); }
    if (typeof opts.minScore === 'number') { params.push(opts.minScore); wheres.push(`quality_score >= $${params.length}`); }
    if (typeof opts.maxPrice === 'number') { params.push(opts.maxPrice); wheres.push(`precio_kg_cop <= $${params.length}`); }
    params.push(limit, offset);

    const sql = `
      SELECT id, producer_id, titulo, descripcion, variedad, proceso,
             puntuacion_taza, cantidad_kg, precio_kg_cop, quality_score,
             fotos, fecha_cosecha, disponible_desde, disponible_hasta,
             views_count, created_at${rankSel}
        FROM product_listings
       WHERE ${wheres.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const r = await this.pool().query(sql, params);
    const out = { items: r.rows, limit, offset };
    await this.cache.set(cacheKey, out, { ttlMs: 60_000 });   // 1 min
    return out;
  }

  // ───────────────────────── ORDERS ─────────────────────────

  async createOrder(buyerId: string, listingId: string, cantidadKg: number, notas?: string) {
    if (cantidadKg <= 0) throw errors.badRequest('cantidad_invalid');
    return this.db.tx(async (c) => {
      const l = await c.query(
        `SELECT producer_id, status, cantidad_kg, precio_kg_cop
           FROM product_listings WHERE id = $1 FOR UPDATE`,
        [listingId],
      );
      if (l.rowCount === 0) throw errors.notFound('listing_not_found');
      const lr = l.rows[0]!;
      if (lr.status !== 'active') throw errors.badRequest('listing_not_active');
      if (lr.producer_id === buyerId) throw errors.badRequest('cannot_buy_own_listing');
      if (Number(cantidadKg) > Number(lr.cantidad_kg)) throw errors.badRequest('cantidad_exceeds_disponible');
      const total = Number(lr.precio_kg_cop) * Number(cantidadKg);
      const r = await c.query(
        `INSERT INTO orders (buyer_id, listing_id, cantidad_kg, precio_total, notas_negociacion, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING id, status, created_at`,
        [buyerId, listingId, cantidadKg, total, notas ?? null],
      );
      await c.query(
        `UPDATE product_listings SET contacts_count = contacts_count + 1 WHERE id = $1`,
        [listingId],
      );
      const orderId = r.rows[0]!.id as string;
      this.hub.publish(`user:${lr.producer_id}`, 'order.created', { orderId, listingId, buyerId, cantidadKg, total });
      this.hub.publish(`order:${orderId}`, 'order.created', { orderId, status: 'pending' });
      this.log.info({ orderId, buyerId, listingId }, 'order_created');
      return { id: orderId, status: 'pending', total, createdAt: r.rows[0]!.created_at };
    });
  }

  /** Devuelve la order si el usuario es buyer o producer; en otro caso 404. */
  async getOrder(userId: string, orderId: string) {
    const r = await this.pool().query(
      `SELECT o.*, l.producer_id, l.titulo AS listing_titulo
         FROM orders o
         JOIN product_listings l ON l.id = o.listing_id
        WHERE o.id = $1`,
      [orderId],
    );
    if (r.rowCount === 0) throw errors.notFound('order_not_found');
    const row = r.rows[0]!;
    if (row.buyer_id !== userId && row.producer_id !== userId) throw errors.notFound('order_not_found');
    return row;
  }

  async listOrdersForUser(userId: string, role: 'buyer' | 'producer') {
    const col = role === 'buyer' ? 'o.buyer_id' : 'l.producer_id';
    const r = await this.pool().query(
      `SELECT o.id, o.listing_id, o.cantidad_kg, o.precio_total, o.status,
              o.created_at, o.updated_at, l.titulo AS listing_titulo,
              o.buyer_id, l.producer_id
         FROM orders o
         JOIN product_listings l ON l.id = o.listing_id
        WHERE ${col} = $1
        ORDER BY o.updated_at DESC`,
      [userId],
    );
    return r.rows;
  }

  async transitionOrder(userId: string, orderId: string, next: OrderStatus) {
    return this.db.tx(async (c) => {
      const r = await c.query(
        `SELECT o.id, o.buyer_id, o.status, l.producer_id
           FROM orders o JOIN product_listings l ON l.id = o.listing_id
          WHERE o.id = $1 FOR UPDATE OF o`,
        [orderId],
      );
      if (r.rowCount === 0) throw errors.notFound('order_not_found');
      const row = r.rows[0]! as { id: string; buyer_id: string; status: OrderStatus; producer_id: string };
      if (row.buyer_id !== userId && row.producer_id !== userId) throw errors.notFound('order_not_found');

      const allowed = STATUS_TRANSITIONS[row.status];
      if (!allowed.includes(next)) throw errors.badRequest('invalid_transition', { from: row.status, to: next });

      // Reglas de quién puede ejecutar qué transición:
      const isProducer = userId === row.producer_id;
      const isBuyer    = userId === row.buyer_id;
      const producerTransitions: OrderStatus[] = ['accepted', 'rejected', 'in_transit', 'delivered'];
      const buyerTransitions: OrderStatus[]    = ['cancelled'];
      if (producerTransitions.includes(next) && !isProducer) throw errors.forbidden('only_producer');
      if (buyerTransitions.includes(next) && !isBuyer) throw errors.forbidden('only_buyer');

      await c.query(`UPDATE orders SET status = $2, updated_at = NOW() WHERE id = $1`, [orderId, next]);

      this.hub.publish(`order:${orderId}`, 'order.status_changed', { orderId, from: row.status, to: next });
      this.hub.publish(`user:${row.buyer_id}`, 'order.status_changed', { orderId, status: next });
      this.hub.publish(`user:${row.producer_id}`, 'order.status_changed', { orderId, status: next });

      this.log.info({ orderId, userId, from: row.status, to: next }, 'order_transitioned');
      return { id: orderId, status: next };
    });
  }

  // ───────────────────────── CHAT ─────────────────────────

  async postMessage(userId: string, orderId: string, mensaje: string) {
    return this.db.tx(async (c) => {
      const o = await c.query(
        `SELECT o.buyer_id, l.producer_id
           FROM orders o JOIN product_listings l ON l.id = o.listing_id
          WHERE o.id = $1`,
        [orderId],
      );
      if (o.rowCount === 0) throw errors.notFound('order_not_found');
      const { buyer_id, producer_id } = o.rows[0]! as { buyer_id: string; producer_id: string };
      if (userId !== buyer_id && userId !== producer_id) throw errors.forbidden('not_a_party');

      const r = await c.query(
        `INSERT INTO order_messages (order_id, sender_id, mensaje)
         VALUES ($1, $2, $3) RETURNING id, created_at`,
        [orderId, userId, mensaje],
      );
      const id = r.rows[0]!.id as string;
      const createdAt = (r.rows[0]!.created_at as Date).toISOString();
      const payload = { id, orderId, senderId: userId, mensaje, createdAt };
      this.hub.publish(`order:${orderId}`, 'order.message', payload);
      const otherUserId = userId === buyer_id ? producer_id : buyer_id;
      this.hub.publish(`user:${otherUserId}`, 'order.message', payload);
      return payload;
    });
  }

  async listMessages(userId: string, orderId: string, opts: { limit?: number; before?: string }) {
    // Reuse access check
    await this.getOrder(userId, orderId);
    const params: unknown[] = [orderId];
    let extra = '';
    if (opts.before) {
      params.push(opts.before);
      extra = ` AND created_at < $${params.length}`;
    }
    params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
    const r = await this.pool().query(
      `SELECT id, sender_id, mensaje, created_at
         FROM order_messages
        WHERE order_id = $1${extra}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    // Devolvemos en orden cronológico ascendente.
    return r.rows.reverse();
  }

  // ─────────── Helpers para WebSocket authorizer ───────────

  /** True si userId es buyer o producer de la order. Usado por el hub authorizer. */
  async canAccessOrder(userId: string, orderId: string): Promise<boolean> {
    const r = await this.pool().query(
      `SELECT 1 FROM orders o JOIN product_listings l ON l.id = o.listing_id
        WHERE o.id = $1 AND (o.buyer_id = $2 OR l.producer_id = $2) LIMIT 1`,
      [orderId, userId],
    );
    return r.rowCount !== null && r.rowCount > 0;
  }

  // ─────────── Misceláneos ───────────

  /** En caso de transacción larga futura: marcar listing como sold cuando una order pasa a delivered. */
  async markListingSoldIfApplicable(listingId: string, client: PoolClient): Promise<void> {
    void client;
    void listingId;
    // Reservado para evolución (multi-órdenes parciales). Por ahora no modifica.
  }
}
