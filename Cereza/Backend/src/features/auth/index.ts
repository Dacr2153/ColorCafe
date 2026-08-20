/**
 * auth/index.ts — Feature wire: rutas HTTP.
 *
 * Endpoints (todos bajo /api/v1/auth):
 *  POST /register                 (público, rate-limit 5/min/IP)
 *  POST /login                    (público, rate-limit 10/min/IP)
 *  POST /refresh                  (público, requiere cookie/body con refresh)
 *  POST /logout                   (público, requiere refresh)
 *  GET  /verify                   (público) — verifica email
 *  POST /password-reset/request   (público, rate-limit 3/min/IP)
 *  POST /password-reset/confirm   (público)
 *  GET  /me                       (auth required) — perfil mínimo
 */
import { z } from 'zod';
import type { FeatureContext, FeatureHandles, FeatureWire } from '../../core/server.js';
import { AuthService } from './service.js';
import type { NotifyService } from '../notify/index.js';
import { errors } from '../../core/errors.js';

const emailSchema = z.string().email().max(254).toLowerCase();
const passwordSchema = z.string().min(10).max(128);

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['producer', 'buyer']).optional(),
  nombre: z.string().min(2).max(120),
  nit: z.string().max(40).optional(),
  nombreEmpresa: z.string().max(200).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200),
});

const verifySchema = z.object({
  uid: z.string().uuid(),
  token: z.string().min(20).max(200),
});

const requestResetSchema = z.object({ email: emailSchema });

const confirmResetSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: passwordSchema,
});

export interface AuthFeatureDeps {
  baseUrl: string;
}

export function makeAuthFeature(deps: AuthFeatureDeps): FeatureWire {
  return async (ctx: FeatureContext): Promise<FeatureHandles> => {
    const { router, guard, db, cache, config, log, services } = ctx;
    const notify = services.notify as NotifyService | undefined;
    if (!notify) throw new Error('auth feature requires notify service — wire notify first');
    const svc = new AuthService(db, config, log, notify, deps.baseUrl);
    void cache;

    const ipFrom = (req: { ip?: string; socket?: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined> }): string | undefined => {
      const xff = req.headers['x-forwarded-for'];
      const first = Array.isArray(xff) ? xff[0] : xff;
      return first?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || undefined;
    };

    router.post('/register', ...guard({ auth: false, rateLimit: 5 }), async (req, res, next) => {
      try {
        const input = registerSchema.parse(req.body);
        const result = await svc.register({
          ...input,
          ip: ipFrom(req as never),
          userAgent: req.headers['user-agent'],
        });
        res.status(201).json(result);
      } catch (e) { next(e); }
    });

    router.post('/login', ...guard({ auth: false, rateLimit: 10 }), async (req, res, next) => {
      try {
        const input = loginSchema.parse(req.body);
        const result = await svc.login({
          ...input,
          ip: ipFrom(req as never),
          userAgent: req.headers['user-agent'],
        });
        res.json(result);
      } catch (e) { next(e); }
    });

    router.post('/refresh', ...guard({ auth: false, rateLimit: 30 }), async (req, res, next) => {
      try {
        const { refreshToken } = refreshSchema.parse(req.body);
        const tokens = await svc.refresh(refreshToken, ipFrom(req as never), req.headers['user-agent']);
        res.json({ tokens });
      } catch (e) { next(e); }
    });

    router.post('/logout', ...guard({ auth: false }), async (req, res, next) => {
      try {
        const { refreshToken } = refreshSchema.parse(req.body);
        await svc.logout(refreshToken);
        res.json({ ok: true });
      } catch (e) { next(e); }
    });

    router.get('/verify', ...guard({ auth: false }), async (req, res, next) => {
      try {
        const { uid, token } = verifySchema.parse(req.query);
        await svc.verifyEmail(uid, token);
        res.json({ verified: true });
      } catch (e) { next(e); }
    });

    router.post('/password-reset/request', ...guard({ auth: false, rateLimit: 3 }), async (req, res, next) => {
      try {
        const { email } = requestResetSchema.parse(req.body);
        await svc.requestPasswordReset(email, ipFrom(req as never));
        res.json({ ok: true });
      } catch (e) { next(e); }
    });

    router.post('/password-reset/confirm', ...guard({ auth: false, rateLimit: 5 }), async (req, res, next) => {
      try {
        const { token, newPassword } = confirmResetSchema.parse(req.body);
        await svc.resetPassword(token, newPassword);
        res.json({ ok: true });
      } catch (e) { next(e); }
    });

    router.get('/me', ...guard({ auth: true }), async (req, res, next) => {
      try {
        if (!req.auth) return next(errors.unauthorized());
        const r = await db.pool_().query(
          `SELECT id, email, role, verified, is_active, created_at, last_login FROM users WHERE id = $1`,
          [req.auth.sub],
        );
        if (r.rowCount === 0) return next(errors.notFound());
        res.json({ user: r.rows[0] });
      } catch (e) { next(e); }
    });

    return { mountPath: '/auth' };
  };
}
