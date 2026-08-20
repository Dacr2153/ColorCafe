/**
 * errors.ts — Errores tipados de aplicación + helper de respuesta uniforme.
 *
 * Convención: las features lanzan `AppError` con código semántico; el
 * middleware global lo traduce a respuesta JSON `{ error: { code, message, details? } }`.
 */
export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL'
  | 'SERVICE_UNAVAILABLE';

const STATUS: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
};

export class AppError extends Error {
  public readonly status: number;
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}

export const errors = {
  badRequest: (m: string, d?: Record<string, unknown>) => new AppError('BAD_REQUEST', m, d),
  unauthorized: (m = 'unauthorized') => new AppError('UNAUTHORIZED', m),
  forbidden: (m = 'forbidden') => new AppError('FORBIDDEN', m),
  notFound: (m = 'not_found') => new AppError('NOT_FOUND', m),
  conflict: (m: string, d?: Record<string, unknown>) => new AppError('CONFLICT', m, d),
  unprocessable: (m: string, d?: Record<string, unknown>) => new AppError('UNPROCESSABLE', m, d),
  tooManyRequests: (m = 'rate_limited') => new AppError('TOO_MANY_REQUESTS', m),
  internal: (m = 'internal_error') => new AppError('INTERNAL', m),
  unavailable: (m = 'service_unavailable') => new AppError('SERVICE_UNAVAILABLE', m),
};
