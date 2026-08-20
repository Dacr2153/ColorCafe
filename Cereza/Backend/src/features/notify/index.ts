/**
 * notify/index.ts — Feature notify: encola emails y los procesa con un worker.
 */
import { z } from 'zod';
import type { FeatureContext, FeatureHandles, FeatureWire } from '../../core/server.js';
import type { Sender } from './sender.js';
import { templates } from './templates.js';
import { errors } from '../../core/errors.js';
import { EMAIL_QUEUE_SCHEMA } from '../../core/queue.js';

export interface NotifyService {
  queueEmail(to: string, kind: keyof typeof templates, args: unknown[]): Promise<string | number>;
}

export type NotifyFeatureHandles = FeatureHandles & { service: NotifyService };

export function makeNotifyFeature(sender: Sender): FeatureWire {
  return async (ctx: FeatureContext): Promise<NotifyFeatureHandles> => {
    const { db, queue, log, router, guard } = ctx;

    const service: NotifyService = {
      async queueEmail(to, kind, args) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw errors.badRequest('invalid_email');
        return queue.enqueue(EMAIL_QUEUE_SCHEMA, {
          to_email: to,
          template: kind,
          data: JSON.stringify({ args }),
        });
      },
    };

    const stopWorker = queue.startWorker<{
      to_email: string;
      template: keyof typeof templates;
      data: { args: unknown[] } | string;
    }>({
      schema: EMAIL_QUEUE_SCHEMA,
      concurrency: 2,
      pollIntervalMs: 3_000,
      maxAttempts: 5,
      handler: async (job) => {
        const tpl = templates[job.payload.template];
        if (!tpl) throw new Error(`unknown_template:${job.payload.template}`);
        const data: { args: unknown[] } = typeof job.payload.data === 'string'
          ? JSON.parse(job.payload.data) as { args: unknown[] }
          : job.payload.data;
        // @ts-expect-error firma variádica controlada por kind en runtime
        const rendered = tpl(...(data.args ?? []));
        await sender.send({
          to: job.payload.to_email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tag: job.payload.template,
        });
      },
    });

    log.info({ provider: sender.name() }, 'notify_feature_started');

    const reenqueueSchema = z.object({ id: z.string().uuid() });

    router.post('/admin/reenqueue', ...guard({ auth: true, roles: ['admin'] }), async (req, res, next) => {
      try {
        const { id } = reenqueueSchema.parse(req.body);
        const r = await db.pool_().query(
          `UPDATE email_queue SET status='queued', attempts=0, error_message=NULL, next_attempt_at=NOW() WHERE id=$1 RETURNING id`,
          [id],
        );
        if (r.rowCount === 0) return next(errors.notFound());
        res.json({ id, requeued: true });
      } catch (e) { next(e); }
    });

    router.get('/admin/queue', ...guard({ auth: true, roles: ['admin'] }), async (req, res, next) => {
      try {
        const status = (req.query.status as string) || 'queued';
        const r = await db.pool_().query(
          `SELECT id, to_email, template, status, attempts, error_message, created_at, sent_at
             FROM email_queue WHERE status = $1 ORDER BY created_at DESC LIMIT 100`,
          [status],
        );
        res.json({ items: r.rows });
      } catch (e) { next(e); }
    });

    return {
      mountPath: '/notify',
      stop: async () => { await stopWorker(); },
      exports: { notify: service },
      service,
    };
  };
}
