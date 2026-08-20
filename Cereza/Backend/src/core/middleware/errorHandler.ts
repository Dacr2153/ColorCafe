/**
 * errorHandler.ts — Captura AppError y errores no controlados.
 * Debe registrarse como ÚLTIMO middleware en app.ts.
 */
import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors.js';
import type { Logger } from '../logger.js';

export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.status).json({
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      });
      return;
    }
    // Errores de zod
    if (err && typeof err === 'object' && 'issues' in err) {
      res.status(422).json({
        error: { code: 'UNPROCESSABLE', message: 'validation_error', details: { issues: (err as { issues: unknown }).issues } },
      });
      return;
    }
    log.error({
      err: (err as Error).message,
      stack: (err as Error).stack,
      method: req.method,
      path: req.originalUrl,
    }, 'unhandled_error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'internal_error' } });
  };
}
