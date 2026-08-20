/**
 * features/content/service.ts — Noticias agronómicas + tips científicos.
 *
 * Reglas:
 *  - Noticias: gestión admin (crear/aprobar). Sólo se sirven `is_published=TRUE`.
 *    El campo `is_verified` indica que un admin la revisó. Búsqueda con search_tsv.
 *    Resumen IA opcional vía Ollama (cacheado 30 min en L1+L2).
 *  - Tips: catálogo curado (sólo admin crea); fuente_cientifica obligatoria.
 *    Filtrado por categoría / variedad. Cache 1h.
 *
 * Política: NUNCA generamos noticias automáticas como hechos. Si pedimos a
 * Ollama un resumen, lo etiquetamos como `ai_summary` y referenciamos la fuente
 * original. Si Ollama falla, devolvemos solo el contenido humano.
 */
import type { Pool } from 'pg';
import type { Database } from '../../core/database.js';
import type { Cache } from '../../core/cache.js';
import type { Logger } from '../../core/logger.js';
import type { OllamaClient } from './ollama.js';
import { errors } from '../../core/errors.js';

const NEWS_TTL = 30 * 60_000;
const TIPS_TTL = 60 * 60_000;
const AI_TTL   = 24 * 60 * 60_000;

export interface NewsArticleInput {
  titulo: string;
  resumen?: string | null;
  contenidoHtml?: string | null;
  fuente: string;
  urlOriginal?: string | null;
  imagenPortada?: string | null;
  categorias?: string[] | null;
  tags?: string[] | null;
  publicadoAt?: string | null;
  isPublished?: boolean;
  isVerified?: boolean;
}

export interface TipInput {
  titulo: string;
  contenido: string;
  nivelDificultad?: 'basico' | 'intermedio' | 'avanzado';
  categoria: 'fertilizacion' | 'plagas' | 'cosecha' | 'beneficio' | 'calidad' | 'clima' | 'comercializacion';
  fuenteCientifica: string;
  aplicableVariedades?: string[] | null;
  aplicableAltitudesMin?: number | null;
  aplicableAltitudesMax?: number | null;
  validadoPor?: string | null;
}

export class ContentService {
  constructor(
    private db: Database,
    private cache: Cache,
    private log: Logger,
    private ollama: OllamaClient,
  ) {}

  private pool(): Pool { return this.db.pool_(); }

  // ───────────────────────── NOTICIAS ─────────────────────────

  async listNews(opts: { search?: string; categoria?: string; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const cacheKey = `news:list:${opts.search ?? ''}:${opts.categoria ?? ''}:${limit}:${offset}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const params: unknown[] = [];
    const wheres: string[] = ['is_published = TRUE'];
    if (opts.search) {
      params.push(opts.search);
      wheres.push(`search_tsv @@ plainto_tsquery('spanish', unaccent($${params.length}))`);
    }
    if (opts.categoria) {
      params.push(opts.categoria);
      wheres.push(`$${params.length} = ANY(categorias)`);
    }
    params.push(limit, offset);
    const rankExpr = opts.search
      ? `, ts_rank(search_tsv, plainto_tsquery('spanish', unaccent($1))) AS rank`
      : '';
    const orderBy = opts.search
      ? 'rank DESC, publicado_at DESC NULLS LAST'
      : 'publicado_at DESC NULLS LAST, created_at DESC';
    const r = await this.pool().query(
      `SELECT id, titulo, resumen, fuente, url_original, imagen_portada,
              categorias, tags, publicado_at, is_verified, views, created_at${rankExpr}
         FROM news_articles
        WHERE ${wheres.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const out = { items: r.rows, limit, offset };
    await this.cache.set(cacheKey, out, { ttlMs: NEWS_TTL });
    return out;
  }

  async getNews(id: string) {
    const r = await this.pool().query(
      `SELECT id, titulo, resumen, contenido_html, fuente, url_original,
              imagen_portada, categorias, tags, publicado_at, is_verified,
              is_published, views, created_at
         FROM news_articles
        WHERE id = $1 AND is_published = TRUE`,
      [id],
    );
    if (r.rowCount === 0) throw errors.notFound('news_not_found');
    // Increment view count (best-effort, no esperamos resultado para la respuesta).
    void this.pool().query(`UPDATE news_articles SET views = views + 1 WHERE id = $1`, [id])
      .catch(() => { /* ignore */ });
    return r.rows[0]!;
  }

  /** Resumen IA con Ollama. Cache 24h por noticia. */
  async aiSummary(id: string): Promise<{ summary: string; model: string; cached: boolean }> {
    const cacheKey = `news:ai-summary:${id}`;
    const cached = await this.cache.get<{ summary: string; model: string }>(cacheKey);
    if (cached) return { ...cached, cached: true };

    const r = await this.pool().query(
      `SELECT titulo, resumen, contenido_html FROM news_articles
        WHERE id = $1 AND is_published = TRUE`,
      [id],
    );
    if (r.rowCount === 0) throw errors.notFound('news_not_found');
    const row = r.rows[0]!;
    const source = [row.titulo, row.resumen, stripHtml(row.contenido_html ?? '')].filter(Boolean).join('\n\n');
    if (source.length < 50) throw errors.unprocessable('news_too_short_to_summarize');

    const prompt = [
      'Eres un asistente agronómico para caficultores colombianos.',
      'Resume en 3-4 frases en español neutro la siguiente noticia.',
      'No inventes datos: si algo no está en el texto, NO lo incluyas.',
      'Texto fuente:',
      source.slice(0, 4000),
    ].join('\n');

    const res = await this.ollama.generate(prompt, { temperature: 0.2, numPredict: 220 });
    const summary = res.text.trim();
    await this.cache.set(cacheKey, { summary, model: res.model }, { ttlMs: AI_TTL });
    return { summary, model: res.model, cached: false };
  }

  async createNews(input: NewsArticleInput) {
    const r = await this.pool().query(
      `INSERT INTO news_articles (
          titulo, resumen, contenido_html, fuente, url_original, imagen_portada,
          categorias, tags, publicado_at, is_verified, is_published
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        input.titulo, input.resumen ?? null, input.contenidoHtml ?? null,
        input.fuente, input.urlOriginal ?? null, input.imagenPortada ?? null,
        input.categorias ?? null, input.tags ?? null, input.publicadoAt ?? null,
        input.isVerified ?? false, input.isPublished ?? false,
      ],
    );
    await this.cache.invalidatePrefix('news:list:').catch(() => { /* ignore */ });
    this.log.info({ id: r.rows[0]!.id }, 'news_created');
    return { id: r.rows[0]!.id as string };
  }

  async updateNews(id: string, input: Partial<NewsArticleInput>) {
    const cols: string[] = [];
    const vals: unknown[] = [];
    const map: Array<[keyof NewsArticleInput, string]> = [
      ['titulo', 'titulo'], ['resumen', 'resumen'], ['contenidoHtml', 'contenido_html'],
      ['fuente', 'fuente'], ['urlOriginal', 'url_original'], ['imagenPortada', 'imagen_portada'],
      ['categorias', 'categorias'], ['tags', 'tags'], ['publicadoAt', 'publicado_at'],
      ['isVerified', 'is_verified'], ['isPublished', 'is_published'],
    ];
    for (const [k, col] of map) {
      if (input[k] !== undefined) {
        vals.push(input[k]);
        cols.push(`${col} = $${vals.length}`);
      }
    }
    if (cols.length === 0) return this.getNews(id);
    vals.push(id);
    const r = await this.pool().query(
      `UPDATE news_articles SET ${cols.join(', ')} WHERE id = $${vals.length} RETURNING id`,
      vals,
    );
    if (r.rowCount === 0) throw errors.notFound('news_not_found');
    await this.cache.invalidatePrefix('news:list:').catch(() => { /* ignore */ });
    await this.cache.del(`news:ai-summary:${id}`).catch(() => { /* ignore */ });
    return this.getNews(id);
  }

  async deleteNews(id: string) {
    const r = await this.pool().query(`DELETE FROM news_articles WHERE id = $1 RETURNING id`, [id]);
    if (r.rowCount === 0) throw errors.notFound('news_not_found');
    await this.cache.invalidatePrefix('news:list:').catch(() => { /* ignore */ });
    return { ok: true };
  }

  // ───────────────────────── COMENTARIOS ─────────────────────────

  /** Lista comentarios de una noticia (público). Incluye autor (nombre, rol). */
  async listComments(newsId: string) {
    // Confirma existencia / publicación
    const exists = await this.pool().query(
      `SELECT 1 FROM news_articles WHERE id = $1 AND is_published = TRUE`,
      [newsId],
    );
    if (exists.rowCount === 0) throw errors.notFound('news_not_found');

    const r = await this.pool().query(
      `SELECT c.id, c.news_id, c.parent_id, c.user_id, c.body, c.is_deleted,
              c.edited_at, c.created_at,
              u.nombre AS user_nombre, u.role AS user_role
         FROM news_comments c
         JOIN users u ON u.id = c.user_id
        WHERE c.news_id = $1
        ORDER BY c.created_at ASC`,
      [newsId],
    );
    return { items: r.rows };
  }

  /** Crea un comentario o respuesta. */
  async createComment(newsId: string, userId: string, body: string, parentId?: string | null) {
    const trimmed = body.trim();
    if (trimmed.length < 1) throw errors.badRequest('comment_empty');
    if (trimmed.length > 4000) throw errors.badRequest('comment_too_long');

    const exists = await this.pool().query(
      `SELECT 1 FROM news_articles WHERE id = $1 AND is_published = TRUE`,
      [newsId],
    );
    if (exists.rowCount === 0) throw errors.notFound('news_not_found');

    if (parentId) {
      const p = await this.pool().query(
        `SELECT 1 FROM news_comments WHERE id = $1 AND news_id = $2`,
        [parentId, newsId],
      );
      if (p.rowCount === 0) throw errors.badRequest('parent_comment_not_found');
    }

    const r = await this.pool().query(
      `INSERT INTO news_comments (news_id, user_id, parent_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, news_id, parent_id, user_id, body, is_deleted, edited_at, created_at`,
      [newsId, userId, parentId ?? null, trimmed],
    );
    const row = r.rows[0]!;
    const u = await this.pool().query(
      `SELECT nombre, role FROM users WHERE id = $1`, [userId],
    );
    return { comment: { ...row, user_nombre: u.rows[0]?.nombre ?? null, user_role: u.rows[0]?.role ?? null } };
  }

  /** Soft-delete: solo el autor o un admin. */
  async deleteComment(commentId: string, userId: string, isAdmin: boolean) {
    const r = await this.pool().query(
      `SELECT user_id FROM news_comments WHERE id = $1 AND is_deleted = FALSE`,
      [commentId],
    );
    if (r.rowCount === 0) throw errors.notFound('comment_not_found');
    if (!isAdmin && r.rows[0]!.user_id !== userId) throw errors.forbidden('not_comment_owner');

    await this.pool().query(
      `UPDATE news_comments SET is_deleted = TRUE, body = '[eliminado]', edited_at = NOW() WHERE id = $1`,
      [commentId],
    );
    return { ok: true };
  }

  // ───────────────────────── TIPS ─────────────────────────

  async listTips(opts: { categoria?: string; variedad?: string; nivelDificultad?: string; altitudMsnm?: number; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const cacheKey = `tips:list:${opts.categoria ?? ''}:${opts.variedad ?? ''}:${opts.nivelDificultad ?? ''}:${opts.altitudMsnm ?? ''}:${limit}:${offset}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const params: unknown[] = [];
    const wheres: string[] = [];
    if (opts.categoria)      { params.push(opts.categoria);      wheres.push(`categoria = $${params.length}`); }
    if (opts.nivelDificultad){ params.push(opts.nivelDificultad);wheres.push(`nivel_dificultad = $${params.length}`); }
    if (opts.variedad)       { params.push(opts.variedad);       wheres.push(`$${params.length} = ANY(aplicable_variedades) OR aplicable_variedades IS NULL`); }
    if (typeof opts.altitudMsnm === 'number') {
      params.push(opts.altitudMsnm);
      wheres.push(`(aplicable_altitudes_min IS NULL OR $${params.length} >= aplicable_altitudes_min)
                AND (aplicable_altitudes_max IS NULL OR $${params.length} <= aplicable_altitudes_max)`);
    }
    params.push(limit, offset);
    const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const r = await this.pool().query(
      `SELECT id, titulo, contenido, nivel_dificultad, categoria, fuente_cientifica,
              aplicable_variedades, aplicable_altitudes_min, aplicable_altitudes_max,
              validado_por, created_at
         FROM agronomic_tips
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const out = { items: r.rows, limit, offset };
    await this.cache.set(cacheKey, out, { ttlMs: TIPS_TTL });
    return out;
  }

  async getTip(id: string) {
    const r = await this.pool().query(`SELECT * FROM agronomic_tips WHERE id = $1`, [id]);
    if (r.rowCount === 0) throw errors.notFound('tip_not_found');
    return r.rows[0]!;
  }

  async createTip(input: TipInput) {
    const r = await this.pool().query(
      `INSERT INTO agronomic_tips (
          titulo, contenido, nivel_dificultad, categoria, fuente_cientifica,
          aplicable_variedades, aplicable_altitudes_min, aplicable_altitudes_max,
          validado_por
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        input.titulo, input.contenido,
        input.nivelDificultad ?? 'basico',
        input.categoria, input.fuenteCientifica,
        input.aplicableVariedades ?? null,
        input.aplicableAltitudesMin ?? null,
        input.aplicableAltitudesMax ?? null,
        input.validadoPor ?? null,
      ],
    );
    await this.cache.invalidatePrefix('tips:list:').catch(() => { /* ignore */ });
    return { id: r.rows[0]!.id as string };
  }

  async deleteTip(id: string) {
    const r = await this.pool().query(`DELETE FROM agronomic_tips WHERE id = $1 RETURNING id`, [id]);
    if (r.rowCount === 0) throw errors.notFound('tip_not_found');
    await this.cache.invalidatePrefix('tips:list:').catch(() => { /* ignore */ });
    return { ok: true };
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
