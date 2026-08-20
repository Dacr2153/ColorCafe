/**
 * queue.ts — Cola de trabajos backed by PostgreSQL.
 *
 * Patrón: `SELECT ... FOR UPDATE SKIP LOCKED` permite N workers concurrentes
 * sin coordinador externo. Cero dependencia de Redis/Bull/RabbitMQ.
 *
 * Como `analysis_queue` y `email_queue` tienen columnas y nombres de estados
 * distintos (analysis_status enum vs. text status), la configuración es por
 * tabla mediante `QueueSchema`.
 */
import type { PoolClient } from 'pg';
import type { Database } from './database.js';
import type { Logger } from './logger.js';

export interface QueueSchema {
  table: string;
  /** Columnas a SELECT para construir el payload (además de id, attempts, enqueuedCol). */
  payloadColumns: string[];
  /** Nombre de columna para timestamp de encolado. */
  enqueuedCol: string;
  /** Nombre de columna para timestamp de finalización. */
  completedCol: string;
  /** Nombre de columna para mensaje de error. */
  errorCol: string;
  /** Nombre de columna para timestamp de inicio (opcional). */
  startedCol?: string;
  /** Mapeo de estados lógicos a valores reales en DB. */
  statusValues: {
    pending: string;
    running: string;
    completed: string;
    failed: string;
  };
}

export interface QueueJob<Payload = unknown> {
  id: string | number;
  payload: Payload;
  attempts: number;
  enqueued_at: Date;
  /** Callbacks que se ejecutan después del COMMIT de la tx del worker.
   * Útil para WebSocket / emails: garantiza que cualquier `SELECT` que dispare
   * el cliente al recibir el evento ya vea los datos persistidos. */
  postCommit: Array<() => void | Promise<void>>;
}

export interface WorkerOptions<Payload> {
  schema: QueueSchema;
  concurrency?: number;
  pollIntervalMs?: number;
  maxAttempts?: number;
  handler: (job: QueueJob<Payload>, client: PoolClient) => Promise<void>;
}

export class JobQueue {
  constructor(private db: Database, private log: Logger) {}

  /** Inserta un trabajo. Devuelve el id del registro. */
  async enqueue(schema: QueueSchema, columns: Record<string, unknown>): Promise<string | number> {
    const keys = Object.keys(columns);
    const vals = Object.values(columns);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO ${schema.table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING id`;
    const res = await this.db.pool_().query<{ id: string | number }>(sql, vals);
    return res.rows[0]!.id;
  }

  startWorker<P>(opts: WorkerOptions<P>): () => Promise<void> {
    const {
      schema,
      concurrency = 1,
      pollIntervalMs = 2_000,
      maxAttempts = 5,
      handler,
    } = opts;

    let running = true;
    const workers: Promise<void>[] = [];

    const loop = async (workerId: number): Promise<void> => {
      while (running) {
        try {
          const picked = await this.db.tx(async (client) => {
            const sel = await client.query(
              `SELECT id, ${schema.payloadColumns.join(', ')}, attempts,
                      ${schema.enqueuedCol} AS enqueued_at
                 FROM ${schema.table}
                 WHERE status = $1 AND next_attempt_at <= NOW()
                 ORDER BY ${schema.enqueuedCol} ASC
                 FOR UPDATE SKIP LOCKED
                 LIMIT 1`,
              [schema.statusValues.pending],
            );
            if (sel.rowCount === 0) return null;
            const row = sel.rows[0];
            const startedSet = schema.startedCol ? `, ${schema.startedCol} = NOW()` : '';
            await client.query(
              `UPDATE ${schema.table} SET status = $1 ${startedSet} WHERE id = $2`,
              [schema.statusValues.running, row.id],
            );
            return row;
          });

          if (!picked) {
            await new Promise((r) => setTimeout(r, pollIntervalMs));
            continue;
          }

          const job: QueueJob<P> = {
            id: picked.id,
            payload: picked as P,
            attempts: picked.attempts,
            enqueued_at: picked.enqueued_at,
            postCommit: [],
          };

          const t0 = Date.now();
          try {
            await this.db.tx((client) => handler(job, client));
            await this.db.pool_().query(
              `UPDATE ${schema.table} SET status = $1, ${schema.completedCol} = NOW() WHERE id = $2`,
              [schema.statusValues.completed, job.id],
            );
            // Dispara hooks post-commit (WS, email, etc.). Errores aquí no marcan
            // el job como fallido — ya está persistido éxitosamente.
            for (const hook of job.postCommit) {
              try { await hook(); } catch (e) {
                this.log.warn({ jobId: job.id, err: (e as Error).message }, 'post_commit_hook_failed');
              }
            }
            this.log.info(
              { table: schema.table, jobId: job.id, duration_ms: Date.now() - t0, workerId },
              'job_completed',
            );
          } catch (err) {
            const attempts = job.attempts + 1;
            const failed = attempts >= maxAttempts;
            const backoff = Math.min(60_000 * 2 ** job.attempts, 30 * 60_000);
            await this.db.pool_().query(
              `UPDATE ${schema.table}
                 SET status = $2,
                     attempts = $3,
                     ${schema.errorCol} = $4,
                     next_attempt_at = NOW() + ($5 * INTERVAL '1 millisecond')
               WHERE id = $1`,
              [
                job.id,
                failed ? schema.statusValues.failed : schema.statusValues.pending,
                attempts,
                (err as Error).message,
                backoff,
              ],
            );
            this.log.error(
              { table: schema.table, jobId: job.id, attempts, failed, err: (err as Error).message, workerId },
              'job_error',
            );
          }
        } catch (loopErr) {
          this.log.error({ table: schema.table, err: (loopErr as Error).message, workerId }, 'worker_loop_error');
          await new Promise((r) => setTimeout(r, pollIntervalMs));
        }
      }
    };

    for (let i = 0; i < concurrency; i++) workers.push(loop(i));

    return async () => {
      running = false;
      await Promise.allSettled(workers);
    };
  }
}

// ---- Schemas pre-configurados de las dos colas del sistema ----
export const EMAIL_QUEUE_SCHEMA: QueueSchema = {
  table: 'email_queue',
  payloadColumns: ['to_email', 'template', 'data'],
  enqueuedCol: 'created_at',
  completedCol: 'sent_at',
  errorCol: 'error_message',
  statusValues: { pending: 'queued', running: 'sending', completed: 'sent', failed: 'failed' },
};

export const ANALYSIS_QUEUE_SCHEMA: QueueSchema = {
  table: 'analysis_queue',
  payloadColumns: ['analysis_id', 'captured_at', 'user_id', 'farm_id', 'storage_ref', 'metadata'],
  enqueuedCol: 'created_at',
  completedCol: 'completed_at',
  errorCol: 'error_message',
  startedCol: 'started_at',
  statusValues: { pending: 'queued', running: 'processing', completed: 'completed', failed: 'failed' },
};
