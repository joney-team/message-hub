import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client';

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: path.join(/*turbopackIgnore: true*/ process.cwd(), 'drizzle') });
}
