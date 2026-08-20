/**
 * logger.ts — Pino structured JSON logger (equivalente a slog en FinalStore).
 *
 * Reglas:
 * - NUNCA loggear: passwords, tokens JWT completos, secret keys, coordenadas exactas.
 * - Campos estándar: time, level, service, feature, action, duration_ms, error.
 */
import pino, { type Logger } from 'pino';

let rootLogger: Logger | null = null;

export function createLogger(level: string, env: string): Logger {
  if (rootLogger) return rootLogger;

  rootLogger = pino({
    name: 'cafevision',
    level,
    base: { service: 'cafevision', env },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'password',
        'password_hash',
        '*.password',
        '*.password_hash',
        'authorization',
        'req.headers.authorization',
        'req.headers.cookie',
        'token',
        '*.token',
        'refreshToken',
        'accessToken',
        'jwt',
        'secret',
        '*.secretKey',
      ],
      remove: true,
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(env === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', singleLine: false },
          },
        }
      : {}),
  });

  return rootLogger;
}

export type { Logger };
