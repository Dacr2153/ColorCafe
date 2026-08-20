/**
 * observability.ts — Request logging, request-id, métricas básicas Prometheus.
 *
 * Métricas (sin dependencias externas):
 *  - http_requests_total{method,route,status}
 *  - http_request_duration_seconds (histograma simplificado)
 *
 * Endpoint `/metrics` expone en formato OpenMetrics text.
 */
import type { RequestHandler, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../logger.js';

const counters = new Map<string, number>();
const histBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const histograms = new Map<string, { counts: number[]; sum: number; total: number }>();

function inc(key: string, n = 1): void {
  counters.set(key, (counters.get(key) ?? 0) + n);
}

function observe(key: string, durSec: number): void {
  let h = histograms.get(key);
  if (!h) { h = { counts: new Array(histBuckets.length).fill(0), sum: 0, total: 0 }; histograms.set(key, h); }
  h.sum += durSec;
  h.total += 1;
  for (let i = 0; i < histBuckets.length; i++) {
    if (durSec <= histBuckets[i]!) h.counts[i]! += 1;
  }
}

export function requestId(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
    res.setHeader('X-Request-Id', id);
    (req as Request & { requestId: string }).requestId = id;
    next();
  };
}

export function accessLog(log: Logger): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const dur = Number(process.hrtime.bigint() - start) / 1e9;
      const route = (req.route?.path || req.path).slice(0, 80);
      const key = `${req.method}|${route}|${res.statusCode}`;
      inc(`http_requests_total{method="${req.method}",route="${route}",status="${res.statusCode}"}`);
      observe(`http_request_duration_seconds{method="${req.method}",route="${route}"}`, dur);
      log.info({
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        duration_ms: Math.round(dur * 1000),
        ip: req.ip,
        userId: req.auth?.sub,
        requestId: (req as Request & { requestId?: string }).requestId,
      }, 'http_request');
      void key;
    });
    next();
  };
}

export function metricsHandler(): RequestHandler {
  return (_req, res) => {
    const lines: string[] = [];
    lines.push('# TYPE http_requests_total counter');
    for (const [k, v] of counters) lines.push(`${k} ${v}`);
    lines.push('# TYPE http_request_duration_seconds histogram');
    for (const [k, h] of histograms) {
      const base = k.replace('http_request_duration_seconds', 'http_request_duration_seconds');
      for (let i = 0; i < histBuckets.length; i++) {
        const labelWithLe = base.replace('}', `,le="${histBuckets[i]}"}`);
        lines.push(`${labelWithLe} ${h.counts[i]}`);
      }
      const infLabel = base.replace('}', `,le="+Inf"}`);
      lines.push(`${infLabel} ${h.total}`);
      lines.push(`${base.replace('http_request_duration_seconds', 'http_request_duration_seconds_sum')} ${h.sum}`);
      lines.push(`${base.replace('http_request_duration_seconds', 'http_request_duration_seconds_count')} ${h.total}`);
    }
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(lines.join('\n') + '\n');
  };
}
