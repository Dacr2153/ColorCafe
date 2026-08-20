/**
 * upload.ts middleware — Multer en memoria + validación por magic bytes.
 *
 * NO confía en Content-Type del cliente: usa `file-type` para detectar el
 * formato real desde los bytes. Rechaza cualquier mismatch.
 */
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import type { RequestHandler } from 'express';
import { errors } from '../errors.js';

export interface UploadOptions {
  field: string;
  maxBytes: number;
  allowedMime: string[];   // ej: ['image/jpeg', 'image/png', 'image/webp']
}

export function uploadSingle(opts: UploadOptions): RequestHandler[] {
  const m = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: opts.maxBytes, files: 1 },
  });

  const validate: RequestHandler = async (req, _res, next) => {
    if (!req.file) return next(errors.badRequest('file_required'));
    const detected = await fileTypeFromBuffer(req.file.buffer);
    if (!detected) return next(errors.unprocessable('unknown_file_type'));
    if (!opts.allowedMime.includes(detected.mime)) {
      return next(errors.unprocessable('disallowed_file_type', { detected: detected.mime }));
    }
    // Sobrescribe el mimetype con el detectado por bytes (no el del cliente).
    req.file.mimetype = detected.mime;
    return next();
  };

  return [m.single(opts.field), validate];
}
