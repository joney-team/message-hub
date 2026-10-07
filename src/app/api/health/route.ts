import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { json } from '@/server/http/errors';
import pkg from '../../../../package.json';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    getDb().run(sql`select 1`);
    return json({ status: 'ok', version: pkg.version });
  } catch {
    return json({ status: 'error' }, { status: 503 });
  }
}
