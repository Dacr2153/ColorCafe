/**
 * migrations.ts — Runner de migraciones SQL idempotente.
 *
 * Lee `migrations/NNNNNN_*.up.sql` en orden, aplica los que aún no estén
 * registrados en la tabla `schema_migrations`. Cada migración corre en su
 * propia transacción.
 *
 * Equivalente conceptual a `migrate.New()` + `m.Up()` del FinalStore (go-migrate),
 * pero implementado de forma nativa para evitar dependencias binarias en runtime.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Database } from './database.js';
import type { Logger } from './logger.js';

const MIGRATIONS_TABLE = 'schema_migrations';

interface Migration {
  version: number;
  name: string;
  path: string;
}

async function ensureMigrationsTable(db: Database): Promise<void> {
  await db.pool_().query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version BIGINT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadMigrations(dir: string, direction: 'up' | 'down'): Promise<Migration[]> {
  const files = await readdir(dir);
  const suffix = `.${direction}.sql`;
  return files
    .filter((f) => f.endsWith(suffix))
    .map((f) => {
      const match = f.match(/^(\d+)_(.+)\.(up|down)\.sql$/);
      if (!match) throw new Error(`Invalid migration filename: ${f}`);
      return {
        version: parseInt(match[1]!, 10),
        name: match[2]!,
        path: path.join(dir, f),
      };
    })
    .sort((a, b) => a.version - b.version);
}

async function appliedVersions(db: Database): Promise<Set<number>> {
  const res = await db.pool_().query<{ version: string }>(
    `SELECT version FROM ${MIGRATIONS_TABLE}`,
  );
  return new Set(res.rows.map((r) => Number(r.version)));
}

export async function migrateUp(
  db: Database,
  dir: string,
  log: Logger,
): Promise<{ applied: number[] }> {
  await ensureMigrationsTable(db);
  const all = await loadMigrations(dir, 'up');
  const applied = await appliedVersions(db);
  const pending = all.filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    log.info('migrations: schema up-to-date');
    return { applied: [] };
  }

  log.info({ count: pending.length }, 'migrations: applying pending');
  const result: number[] = [];
  for (const m of pending) {
    const sql = await readFile(m.path, 'utf8');
    const t0 = Date.now();
    await db.tx(async (client) => {
      await client.query(sql);
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE}(version, name) VALUES ($1, $2)`,
        [m.version, m.name],
      );
    });
    log.info({ version: m.version, name: m.name, duration_ms: Date.now() - t0 }, 'migration_applied');
    result.push(m.version);
  }
  return { applied: result };
}

export async function migrateDown(
  db: Database,
  dir: string,
  log: Logger,
  steps = 1,
): Promise<{ rolledBack: number[] }> {
  await ensureMigrationsTable(db);
  const all = await loadMigrations(dir, 'down');
  const applied = await appliedVersions(db);
  const toRollback = all
    .filter((m) => applied.has(m.version))
    .sort((a, b) => b.version - a.version)
    .slice(0, steps);

  const result: number[] = [];
  for (const m of toRollback) {
    const sql = await readFile(m.path, 'utf8');
    await db.tx(async (client) => {
      await client.query(sql);
      await client.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = $1`, [m.version]);
    });
    log.warn({ version: m.version, name: m.name }, 'migration_rolled_back');
    result.push(m.version);
  }
  return { rolledBack: result };
}
