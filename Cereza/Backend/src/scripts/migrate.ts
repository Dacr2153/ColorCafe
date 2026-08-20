/**
 * scripts/migrate.ts — CLI standalone para correr migraciones manualmente.
 *
 * Uso:
 *   tsx src/scripts/migrate.ts up      # aplica pendientes
 *   tsx src/scripts/migrate.ts down 1  # rollback 1 paso
 */
import path from 'node:path';
import { loadConfig } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { Database } from '../core/database.js';
import { migrateDown, migrateUp } from '../core/migrations.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger(cfg.logLevel, cfg.nodeEnv);
  const db = new Database(cfg.databaseUrl, log);
  const dir = path.resolve(process.cwd(), 'migrations');
  const cmd = process.argv[2] ?? 'up';

  try {
    if (cmd === 'up') {
      const r = await migrateUp(db, dir, log);
      log.info({ applied: r.applied }, 'migrate_up_done');
    } else if (cmd === 'down') {
      const steps = parseInt(process.argv[3] ?? '1', 10);
      const r = await migrateDown(db, dir, log, steps);
      log.info({ rolledBack: r.rolledBack }, 'migrate_down_done');
    } else {
      console.error(`unknown command: ${cmd}`);
      process.exit(2);
    }
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
