/**
 * auth/service.ts — Lógica de dominio (sin Express).
 *
 * Responsabilidades:
 *  - register/login/logout
 *  - refresh con rotation + theft detection
 *  - email verification
 *  - password reset
 *  - bloqueo por intentos fallidos
 *  - audit log
 *
 * Inyectado en index.ts vía constructor de AuthService.
 */
import { randomBytes } from 'node:crypto';
import type { Database } from '../../core/database.js';
import type { Logger } from '../../core/logger.js';
import type { AppConfig } from '../../core/config.js';
import type { NotifyService } from '../notify/index.js';
import { errors } from '../../core/errors.js';
import {
  generateRefreshToken,
  parseDurationMs,
  rotateRefreshToken,
  sha256Hex,
  signAccessToken,
} from './tokens.js';
import { hashPassword, validatePasswordStrength, verifyPassword } from './passwords.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60_000; // 15 min

export interface RegisterInput {
  email: string;
  password: string;
  role?: 'producer' | 'buyer';
  nombre: string;
  nit?: string;
  nombreEmpresa?: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface LoginInput {
  email: string;
  password: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number; // segundos
  refreshExpiresIn: number;
}

export interface PublicUser {
  id: string;
  email: string;
  role: 'admin' | 'producer' | 'buyer';
  verified: boolean;
}

export class AuthService {
  constructor(
    private db: Database,
    private cfg: AppConfig,
    private log: Logger,
    private notify: NotifyService,
    private baseUrl: string,
  ) {}

  // ---------- register ----------
  async register(input: RegisterInput): Promise<{ user: PublicUser }> {
    validatePasswordStrength(input.password);
    const role = input.role ?? 'producer';

    return this.db.tx(async (client) => {
      const existing = await client.query(`SELECT 1 FROM users WHERE email = $1`, [input.email]);
      if ((existing.rowCount ?? 0) > 0) throw errors.conflict('email_already_registered');

      const hash = await hashPassword(input.password);
      const ins = await client.query<{ id: string; email: string; role: 'admin' | 'producer' | 'buyer' }>(
        `INSERT INTO users (email, password_hash, role, verified) VALUES ($1, $2, $3, FALSE)
         RETURNING id, email, role`,
        [input.email, hash, role],
      );
      const user = ins.rows[0]!;

      if (role === 'producer') {
        await client.query(
          `INSERT INTO producer_profiles (user_id, nombre) VALUES ($1, $2)`,
          [user.id, input.nombre],
        );
      } else {
        if (!input.nombreEmpresa) throw errors.badRequest('buyer_requires_nombreEmpresa');
        await client.query(
          `INSERT INTO buyer_profiles (user_id, nombre_empresa, nit) VALUES ($1, $2, $3)`,
          [user.id, input.nombreEmpresa, input.nit ?? null],
        );
      }

      // Email verification token (UPSERT por el PK = user_id)
      const verifyRaw = randomBytes(32).toString('base64url');
      const verifyHash = sha256Hex(verifyRaw);
      const verifyExpires = new Date(Date.now() + 24 * 3_600_000);
      await client.query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at`,
        [user.id, verifyHash, verifyExpires],
      );

      // Encolar email de verificación (fuera del lock principal — sigue en tx por consistencia)
      const verifyLink = `${this.baseUrl}/auth/verify?token=${verifyRaw}&uid=${user.id}`;
      await this.notify.queueEmail(input.email, 'verifyEmail', [input.nombre, verifyLink]);

      await this.audit(client, user.id, 'register', input.ip, input.userAgent, true);

      return { user: { id: user.id, email: user.email, role: user.role, verified: false } };
    });
  }

  // ---------- login ----------
  async login(input: LoginInput): Promise<{ user: PublicUser; tokens: TokenPair }> {
    return this.db.tx(async (client) => {
      const r = await client.query<{
        id: string; email: string; password_hash: string; role: 'admin' | 'producer' | 'buyer';
        verified: boolean; is_active: boolean; failed_login_attempts: number; locked_until: Date | null;
      }>(
        `SELECT id, email, password_hash, role, verified, is_active, failed_login_attempts, locked_until
           FROM users WHERE email = $1 FOR UPDATE`,
        [input.email],
      );

      if (r.rowCount === 0) {
        // Comparación dummy para evitar timing leak entre "usuario no existe" y "password mala"
        await verifyPassword(
          '$argon2id$v=19$m=65536,t=3,p=4$dummy$dummy', // hash inválido — solo consume tiempo
          input.password,
        ).catch(() => false);
        throw errors.unauthorized('invalid_credentials');
      }

      const u = r.rows[0]!;
      if (!u.is_active) throw errors.forbidden('account_disabled');
      if (u.locked_until && u.locked_until > new Date()) {
        throw errors.forbidden('account_locked');
      }

      const ok = await verifyPassword(u.password_hash, input.password);
      if (!ok) {
        const newAttempts = u.failed_login_attempts + 1;
        const shouldLock = newAttempts >= MAX_FAILED_LOGINS;
        await client.query(
          `UPDATE users SET failed_login_attempts = $2,
                            locked_until = CASE WHEN $3 THEN NOW() + ($4 * INTERVAL '1 millisecond') ELSE locked_until END
             WHERE id = $1`,
          [u.id, newAttempts, shouldLock, LOCK_DURATION_MS],
        );
        await this.audit(client, u.id, 'login_failed', input.ip, input.userAgent, false);
        throw errors.unauthorized('invalid_credentials');
      }

      // Login exitoso: reset contador, last_login
      await client.query(
        `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1`,
        [u.id],
      );

      const tokens = await this.issueTokens(client, {
        sub: u.id, email: u.email, role: u.role, jti: '',
      }, input.ip, input.userAgent);

      await this.audit(client, u.id, 'login', input.ip, input.userAgent, true);

      return {
        user: { id: u.id, email: u.email, role: u.role, verified: u.verified },
        tokens,
      };
    });
  }

  // ---------- refresh ----------
  async refresh(rawRefreshToken: string, ip?: string, userAgent?: string): Promise<TokenPair> {
    return this.db.tx(async (client) => {
      const rotated = await rotateRefreshToken(client, rawRefreshToken);
      if (!rotated) throw errors.unauthorized('invalid_refresh_token');

      const u = await client.query<{ id: string; email: string; role: 'admin' | 'producer' | 'buyer' }>(
        `SELECT id, email, role FROM users WHERE id = $1 AND is_active = TRUE`,
        [rotated.userId],
      );
      if (u.rowCount === 0) throw errors.unauthorized('user_inactive');

      const tokens = await this.issueTokens(
        client,
        { sub: u.rows[0]!.id, email: u.rows[0]!.email, role: u.rows[0]!.role, jti: '' },
        ip,
        userAgent,
        rotated.previousHash,
      );
      return tokens;
    });
  }

  // ---------- logout (revoca refresh) ----------
  async logout(rawRefreshToken: string): Promise<void> {
    const hash = sha256Hex(rawRefreshToken);
    await this.db.pool_().query(
      `UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW(), revoked_reason = 'logout'
         WHERE token_hash = $1 AND revoked = FALSE`,
      [hash],
    );
  }

  // ---------- verify email ----------
  async verifyEmail(userId: string, rawToken: string): Promise<void> {
    const hash = sha256Hex(rawToken);
    await this.db.tx(async (client) => {
      const r = await client.query<{ expires_at: Date }>(
        `SELECT expires_at FROM email_verification_tokens WHERE user_id = $1 AND token_hash = $2`,
        [userId, hash],
      );
      if (r.rowCount === 0) throw errors.badRequest('invalid_verification_token');
      if (r.rows[0]!.expires_at < new Date()) throw errors.badRequest('expired_verification_token');
      await client.query(`UPDATE users SET verified = TRUE WHERE id = $1`, [userId]);
      await client.query(`DELETE FROM email_verification_tokens WHERE user_id = $1`, [userId]);
      await this.audit(client, userId, 'email_verified', undefined, undefined, true);
    });
  }

  // ---------- password reset ----------
  async requestPasswordReset(email: string, ip?: string): Promise<void> {
    // Siempre devolvemos OK al cliente (no leak de existencia de email).
    await this.db.tx(async (client) => {
      const u = await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
      if (u.rowCount === 0) return;
      const userId = u.rows[0]!.id;
      const raw = randomBytes(32).toString('base64url');
      const hash = sha256Hex(raw);
      const expires = new Date(Date.now() + 60 * 60_000);
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [userId, hash, expires],
      );
      const link = `${this.baseUrl}/auth/reset?token=${raw}`;
      // El nombre del usuario podría obtenerse del perfil; usamos 'usuario' como fallback simple.
      await this.notify.queueEmail(email, 'resetPassword', ['usuario', link]);
      await this.audit(client, userId, 'password_reset_requested', ip, undefined, true);
    });
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    validatePasswordStrength(newPassword);
    const hash = sha256Hex(rawToken);
    await this.db.tx(async (client) => {
      const r = await client.query<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
        `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE`,
        [hash],
      );
      if (r.rowCount === 0) throw errors.badRequest('invalid_reset_token');
      const row = r.rows[0]!;
      if (row.used_at) throw errors.badRequest('reset_token_used');
      if (row.expires_at < new Date()) throw errors.badRequest('reset_token_expired');

      const newHash = await hashPassword(newPassword);
      await client.query(`UPDATE users SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL WHERE id = $2`, [newHash, row.user_id]);
      await client.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);
      // Por seguridad, revoca todos los refresh tokens del usuario
      await client.query(
        `UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW(), revoked_reason = 'password_reset'
           WHERE user_id = $1 AND revoked = FALSE`,
        [row.user_id],
      );
      await this.audit(client, row.user_id, 'password_reset', undefined, undefined, true);
    });
  }

  // ---------- helpers ----------
  private async issueTokens(
    client: import('pg').PoolClient,
    claims: { sub: string; email: string; role: 'admin' | 'producer' | 'buyer'; jti: string },
    ip?: string,
    userAgent?: string,
    parentHash?: string,
  ): Promise<TokenPair> {
    const refreshMs = parseDurationMs(this.cfg.jwt.refreshExpires, 7 * 86_400_000);
    const accessMs = parseDurationMs(this.cfg.jwt.accessExpires, 15 * 60_000);
    const refresh = generateRefreshToken(Date.now() + refreshMs);

    const ins = await client.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, token_hash, parent_token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [claims.sub, refresh.hash, parentHash ?? null, refresh.expiresAt, ip ?? null, userAgent ?? null],
    );

    const access = signAccessToken(this.cfg.jwt, { ...claims, jti: ins.rows[0]!.id });
    return {
      accessToken: access,
      refreshToken: refresh.raw,
      accessExpiresIn: Math.floor(accessMs / 1000),
      refreshExpiresIn: Math.floor(refreshMs / 1000),
    };
  }

  private async audit(
    client: import('pg').PoolClient,
    userId: string | null,
    action: string,
    ip?: string,
    userAgent?: string,
    success = true,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (user_id, action, ip_address, user_agent, success) VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, ip ?? null, userAgent ?? null, success],
    );
  }
}
