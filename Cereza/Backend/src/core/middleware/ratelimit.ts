/**
 * ratelimit.ts — Rate limiter en memoria (token bucket por (key, ruta)).
 *
 * Para producción multi-instancia, sustituible por Redis-based limiter
 * (la interfaz se mantiene). Por defecto los buckets viven 1h sin uso.
 */
import { LRUCache } from 'lru-cache';
import type { Request, RequestHandler } from 'express';
import { errors } from '../errors.js';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitOptions {
  /** Capacidad máxima del bucket. */
  capacity: number;
  /** Tokens repuestos por segundo. */
  refillPerSec: number;
  /** Función para derivar la clave (default: IP + ruta). */
  keyFn?: (req: Request) => string;
}

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const cache = new LRUCache<string, Bucket>({ max: 50_000, ttl: 60 * 60_000 });
  const keyFn = opts.keyFn ?? ((req) => {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      || req.socket.remoteAddress || 'unknown';
    return `${ip}:${req.method}:${req.baseUrl}${req.path}`;
  });

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = cache.get(key);
    if (!bucket) {
      bucket = { tokens: opts.capacity, updatedAt: now };
      cache.set(key, bucket);
    } else {
      const elapsed = (now - bucket.updatedAt) / 1000;
      bucket.tokens = Math.min(opts.capacity, bucket.tokens + elapsed * opts.refillPerSec);
      bucket.updatedAt = now;
    }
    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / opts.refillPerSec);
      res.setHeader('Retry-After', String(retryAfter));
      return next(errors.tooManyRequests());
    }
    bucket.tokens -= 1;
    return next();
  };
}
