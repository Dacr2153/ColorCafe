/**
 * auth/tokens.ts — Helpers de generación/verificación de JWT y refresh tokens.
 *
 * - Access token: JWT RS256, vida corta (15m por defecto)
 * - Refresh token: opaco (32 bytes random base64url), hash SHA256 en DB
 * - Rotation con detección de robo: si se usa un refresh token ya rotado,
 *   se revoca toda la cadena (parent_token_hash).
 */
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { PoolClient } from 'pg';
import type { AppConfig } from '../../core/config.js';

export interface AccessTokenClaims {
  sub: string;
  role: 'admin' | 'producer' | 'buyer';
  email: string;
  jti: string;
}

export function signAccessToken(cfg: AppConfig['jwt'], claims: AccessTokenClaims): string {
  return jwt.sign(claims, cfg.privateKey, {
    algorithm: 'RS256',
    issuer: cfg.issuer,
    expiresIn: cfg.accessExpires as `${number}${'s' | 'm' | 'h' | 'd'}`,
  });
}

export interface RefreshTokenIssued {
  raw: string;          // se entrega al cliente UNA SOLA VEZ
  hash: string;         // se guarda en DB
  expiresAt: Date;
}

export function generateRefreshToken(expiresAtMs: number): RefreshTokenIssued {
  const raw = randomBytes(32).toString('base64url');
  const hash = sha256Hex(raw);
  return { raw, hash, expiresAt: new Date(expiresAtMs) };
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseDurationMs(s: string, fallbackMs: number): number {
  const m = s.match(/^(\d+)([smhd])$/);
  if (!m) return fallbackMs;
  const n = parseInt(m[1]!, 10);
  const unit = m[2]!;
  const mult: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (mult[unit] ?? 1000);
}

/**
 * Detección de robo: el cliente envía un refresh token. Buscamos:
 *  - Si es válido, no revocado, no expirado → emitimos par nuevo y revocamos éste.
 *  - Si ya está revocado pero existe → ALGUIEN lo reusó → revocamos TODA la cadena
 *    descendiente (parent_token_hash points back).
 *  - Si no existe → unauthorized.
 *
 * Devuelve `null` si debe rechazarse.
 */
export async function rotateRefreshToken(
  client: PoolClient,
  rawToken: string,
): Promise<{ userId: string; previousHash: string } | null> {
  const hash = sha256Hex(rawToken);
  const sel = await client.query<{
    id: string;
    user_id: string;
    revoked: boolean;
    expires_at: Date;
  }>(
    `SELECT id, user_id, revoked, expires_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
    [hash],
  );
  if (sel.rowCount === 0) return null;
  const row = sel.rows[0]!;
  if (row.revoked) {
    // ¡reuso de token rotado! Revocamos TODOS los tokens del usuario por seguridad.
    await client.query(
      `UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW(), revoked_reason = 'theft_detected'
         WHERE user_id = $1 AND revoked = FALSE`,
      [row.user_id],
    );
    return null;
  }
  if (row.expires_at < new Date()) return null;
  // Marcamos este token como rotado (revoked con razón 'rotated'), el nuevo se inserta arriba.
  await client.query(
    `UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW(), revoked_reason = 'rotated' WHERE id = $1`,
    [row.id],
  );
  return { userId: row.user_id, previousHash: hash };
}
