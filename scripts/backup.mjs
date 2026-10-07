/**
 * Hot backup: consistent snapshot of hub.db through SQLite's backup API (safe while the
 * app is running) plus a copy of files/. Plain JS so it also runs inside the image:
 *   pnpm db:backup [target-dir]
 *   docker exec <container> node scripts/backup.mjs /data/backups/<name>
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

async function main() {
  const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
  const source = path.join(dataDir, 'hub.db');
  if (!fs.existsSync(source)) throw new Error(`No database at ${source}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.resolve(process.argv[2] ?? path.join('backups', stamp));
  fs.mkdirSync(target, { recursive: true });

  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(path.join(target, 'hub.db'));
  } finally {
    db.close();
  }
  const files = path.join(dataDir, 'files');
  if (fs.existsSync(files)) fs.cpSync(files, path.join(target, 'files'), { recursive: true });
  console.log(`Backup written to ${target}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
