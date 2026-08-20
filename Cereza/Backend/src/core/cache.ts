/**
 * cache.ts — Caché en dos niveles: lru-cache (L1, in-process) + Redis (L2, compartido).
 *
 * Estrategia:
 * - L1 lru-cache para hot paths (lecturas más frecuentes, expiración corta)
 * - L2 Redis con TTL configurable por dominio (precios FNC 24h, búsquedas 5min, tips 1h, news 30min)
 * - read-through: get() consulta L1, luego L2, no recarga origen (eso es responsabilidad de la feature)
 */
import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';
import type { Logger } from './logger.js';

export interface CacheGetSetOptions {
  ttlMs: number;
  /** Si true, usa solo L1 (memoria local). Útil para datos no compartibles. */
  localOnly?: boolean;
}

export class Cache {
  private l1: LRUCache<string, string>;
  private l2: Redis;

  constructor(redisUrl: string, private log: Logger, l1MaxItems = 5_000) {
    this.l1 = new LRUCache({ max: l1MaxItems, ttl: 5 * 60_000 });
    this.l2 = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.l2.on('error', (err) => this.log.error({ err: err.message }, 'redis_error'));
  }

  async get<T = unknown>(key: string, opts?: { localOnly?: boolean }): Promise<T | null> {
    const fromL1 = this.l1.get(key);
    if (fromL1 !== undefined) {
      try { return JSON.parse(fromL1) as T; } catch { return null; }
    }
    if (opts?.localOnly) return null;
    try {
      const v = await this.l2.get(key);
      if (v === null) return null;
      this.l1.set(key, v);
      return JSON.parse(v) as T;
    } catch (e) {
      this.log.warn({ key, err: (e as Error).message }, 'cache_l2_get_failed');
      return null;
    }
  }

  async set<T>(key: string, value: T, opts: CacheGetSetOptions): Promise<void> {
    const serialized = JSON.stringify(value);
    this.l1.set(key, serialized, { ttl: Math.min(opts.ttlMs, 10 * 60_000) });
    if (opts.localOnly) return;
    try {
      await this.l2.set(key, serialized, 'PX', opts.ttlMs);
    } catch (e) {
      this.log.warn({ key, err: (e as Error).message }, 'cache_l2_set_failed');
    }
  }

  async del(key: string): Promise<void> {
    this.l1.delete(key);
    try { await this.l2.del(key); } catch { /* ignore */ }
  }

  async invalidatePrefix(prefix: string): Promise<void> {
    for (const k of this.l1.keys()) if (k.startsWith(prefix)) this.l1.delete(k);
    try {
      const stream = this.l2.scanStream({ match: `${prefix}*`, count: 200 });
      for await (const keys of stream) {
        if ((keys as string[]).length) await this.l2.del(...(keys as string[]));
      }
    } catch (e) {
      this.log.warn({ prefix, err: (e as Error).message }, 'cache_invalidate_failed');
    }
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const t0 = Date.now();
    try {
      const reply = await this.l2.ping();
      return { ok: reply === 'PONG', latency_ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, latency_ms: Date.now() - t0, error: (e as Error).message };
    }
  }

  async close(): Promise<void> {
    this.l1.clear();
    await this.l2.quit().catch(() => { /* ignore */ });
  }

  raw(): Redis {
    return this.l2;
  }
}
