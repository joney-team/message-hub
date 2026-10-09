/**
 * Destructively resets all application data while preserving migrations and backups.
 *
 * Inside the production container:
 *   docker exec <container> node scripts/reset-data.mjs --confirm-reset
 *   docker restart <container>
 *
 * Stop incoming traffic before running this script. Restarting afterwards clears
 * process-local streams, rate limiters, and worker state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const CONFIRMATION = '--confirm-reset';
const APP_TABLES = ['studio_sessions', 'studio_credentials', 'webhook_deliveries', 'messages', 'files', 'visitors', 'channels'];
const SEQUENCE_TABLES = ['webhook_deliveries', 'messages'];

export function resetApplicationData(db, dataDir) {
  const existing = new Set(
    db
      .prepare("select name from sqlite_schema where type = 'table'")
      .all()
      .map((row) => row.name),
  );
  const missing = APP_TABLES.filter((table) => !existing.has(table));
  if (missing.length > 0) throw new Error(`Database is missing application tables: ${missing.join(', ')}`);

  const counts = Object.fromEntries(APP_TABLES.map((table) => [table, db.prepare(`select count(*) as count from "${table}"`).get().count]));
  const filesDir = path.join(dataDir, 'files');

  const reset = db.transaction(() => {
    for (const table of APP_TABLES) db.prepare(`delete from "${table}"`).run();
    if (existing.has('sqlite_sequence')) {
      const placeholders = SEQUENCE_TABLES.map(() => '?').join(', ');
      db.prepare(`delete from sqlite_sequence where name in (${placeholders})`).run(...SEQUENCE_TABLES);
    }
    fs.rmSync(filesDir, { recursive: true, force: true });
    fs.mkdirSync(filesDir, { recursive: true });
  });
  reset.immediate();

  return { counts, filesDir };
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.length !== 1 || args[0] !== CONFIRMATION) {
    console.error(`Refusing to reset data without ${CONFIRMATION}.`);
    console.error(`Usage: node scripts/reset-data.mjs ${CONFIRMATION}`);
    process.exitCode = 2;
    return;
  }

  const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
  const databaseFile = path.join(dataDir, 'hub.db');
  if (!fs.existsSync(databaseFile)) throw new Error(`No database at ${databaseFile}`);

  const db = new Database(databaseFile, { fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 10000');
    const { counts, filesDir } = resetApplicationData(db, dataDir);
    const summary = APP_TABLES.map((table) => `${table}=${counts[table]}`).join(', ');
    console.log(`Application data reset: ${summary}`);
    console.log(`Uploaded files cleared: ${filesDir}`);
    console.log('Migration state and backups were preserved. Restart the container now.');
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
