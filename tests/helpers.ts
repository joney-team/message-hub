import { eq } from 'drizzle-orm';
import { closeDb, installDatabase, openDatabase, getDb } from '@/server/db/client';
import { runMigrations } from '@/server/db/migrate';
import { channels, visitors } from '@/server/db/schema';
import { hashToken, newId, newVisitorToken, newWebhookSecret } from '@/server/ids';

/** Fresh in-memory SQLite with real migrations, installed as the app database. */
export function useTestDb(): void {
  closeDb();
  installDatabase(openDatabase(':memory:'));
  runMigrations(getDb());
}

export function insertChannel(owner = 'acme', over: Partial<typeof channels.$inferInsert> = {}) {
  const now = new Date();
  const row: typeof channels.$inferInsert = {
    id: newId('ch'),
    owner,
    name: 'Test channel',
    ref: null,
    webhookUrl: null,
    webhookSecret: newWebhookSecret(),
    settings: {},
    allowedOrigins: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
  getDb().insert(channels).values(row).run();
  return getDb().select().from(channels).where(eq(channels.id, row.id)).get()!;
}

export function insertVisitor(channelId: string) {
  const token = newVisitorToken();
  const now = new Date();
  const row: typeof visitors.$inferInsert = {
    id: newId('vis'),
    channelId,
    tokenHash: hashToken(token),
    profile: {},
    lastSeenAt: now,
    createdAt: now,
  };
  getDb().insert(visitors).values(row).run();
  return { visitor: getDb().select().from(visitors).where(eq(visitors.id, row.id)).get()!, token };
}

export function bearer(token: string, init: RequestInit = {}): Request {
  return new Request('http://hub.test/x', { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers as object) } });
}
