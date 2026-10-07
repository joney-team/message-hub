import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export interface Holder {
  sqlite: Database.Database;
  db: Db;
}

// Singleton on globalThis: HMR and `next build` import this module many times.
const g = globalThis as unknown as { __hub_db?: Holder };

export function dataDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? './data');
}

export function openDatabase(file: string): Holder {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function holder(): Holder {
  if (!g.__hub_db) {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    g.__hub_db = openDatabase(path.join(dir, 'hub.db'));
  }
  return g.__hub_db;
}

/** Opened lazily on first use, so `next build` never touches the database. */
export function getDb(): Db {
  return holder().db;
}

export function getSqlite(): Database.Database {
  return holder().sqlite;
}

/** Test hook: swap in an in-memory database. */
export function installDatabase(h: Holder): void {
  g.__hub_db = h;
}

export function closeDb(): void {
  if (g.__hub_db) {
    g.__hub_db.sqlite.close();
    g.__hub_db = undefined;
  }
}
