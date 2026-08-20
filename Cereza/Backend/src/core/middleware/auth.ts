/**
 * auth.ts middleware — Verifica JWT RS256, popula req.auth.
 *
 * El token puede venir en `Authorization: Bearer <jwt>` o cookie `at`.
 * Whitelist de rutas públicas: el router las marca con `auth: false`.
 */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { errors } from '../errors.js';

export interface AuthClaims {
  sub: string;       // user id (uuid)
  role: 'admin' | 'producer' | 'buyer';
  email: string;
  jti: string;       // refresh token id si access derivado
  iat: number;
  exp: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthClaims;
  }
}

export function extractBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (h && h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === 'at') return rest.join('=');
    }
  }
  return null;
}

export function verifyAccessToken(token: string, publicKey: string, issuer: string): AuthClaims {
  const payload = jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer,
  }) as AuthClaims;
  if (!payload.sub || !payload.role) throw new Error('invalid_claims');
  return payload;
}

export interface AuthMiddlewareDeps {
  publicKey: string;
  issuer: string;
}

export function authMiddleware(deps: AuthMiddlewareDeps): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = extractBearer(req);
    if (!token) return next(errors.unauthorized('missing_token'));
    try {
      req.auth = verifyAccessToken(token, deps.publicKey, deps.issuer);
      return next();
    } catch (e) {
      const msg = (e as Error).message;
      return next(errors.unauthorized(`invalid_token: ${msg}`));
    }
  };
}

export function requireRole(...roles: Array<AuthClaims['role']>): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(errors.unauthorized());
    if (roles.length && !roles.includes(req.auth.role)) {
      return next(errors.forbidden('insufficient_role'));
    }
    return next();
  };
}
