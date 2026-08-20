/**
 * database.ts — Pool PostgreSQL + helpers transaccionales.
 *
 * Patrón FinalStore: pg directo, sin ORM. SQL explícito por feature.
 */
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { Logger } from './logger.js';

export interface DbHealth {
  ok: boolean;
  latency_ms: number;
  error?: string;
}

export class Database {
  private pool: Pool;

  constructor(url: string, private log: Logger, opts?: Partial<PoolConfig>) {
    this.pool = new Pool({
      connectionString: url,
      max: opts?.max ?? 20,
      idleTimeoutMillis: opts?.idleTimeoutMillis ?? 30_000,
      connectionTimeoutMillis: opts?.connectionTimeoutMillis ?? 5_000,
      application_name: 'cafevision-backend',
      ...opts,
    });

    this.pool.on('error', (err) => {
      this.log.error({ err: err.message }, 'pg_pool_error');
    });
  }

  pool_(): Pool {
    return this.pool;
  }

  /** Ejecuta callback con cliente dedicado y transacción BEGIN/COMMIT/ROLLBACK. */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  }

  async health(): Promise<DbHealth> {
    const start = Date.now();
    try {
      await this.pool.query('SELECT 1');
      return { ok: true, latency_ms: Date.now() - start };
    } catch (e) {
      return { ok: false, latency_ms: Date.now() - start, error: (e as Error).message };
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
